// A small, persistent cache of public Kroger product photos. No credentials, arbitrary hosts or redirects.
import { db } from './db.ts';
import { UserError } from './geo.ts';
import { DAY } from './http.ts';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const FRESH_MS = 7 * DAY;
type ProductImage = { body: Uint8Array; contentType: string; stale?: boolean };
type SavedImage = { body: Uint8Array; content_type: string; fetched_at: number };
const pending = new Map<string, Promise<ProductImage>>();
let active = 0;
const queue: (() => void)[] = [];

export function productImagePath(value: string): string {
  if (!/^(medium|small|large|xlarge|thumbnail)\/(front|back|left|right|top|bottom)\/\d{8,14}$/.test(value)) {
    throw new UserError('Invalid product image.', 400);
  }
  return value;
}

function imageType(body: Uint8Array): string | null {
  const bytes = Buffer.from(body);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function readImage(response: Response): Promise<ProductImage> {
  if (!response.ok) throw new Error(`Image service returned HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Image too large');
  if (!response.body) throw new Error('Empty product image');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('Image too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = Buffer.concat(chunks);
  const contentType = imageType(body);
  if (!contentType || response.headers.get('content-type')?.split(';')[0].trim() !== contentType) throw new Error('Invalid image response');
  return { body, contentType };
}

function saveImage(path: string, image: ProductImage) {
  db.prepare('INSERT OR REPLACE INTO product_images (path, body, content_type, fetched_at) VALUES (?, ?, ?, ?)')
    .run(path, image.body, image.contentType, Date.now());
  let size = (db.prepare('SELECT coalesce(sum(length(body)), 0) AS bytes FROM product_images').get() as { bytes: number }).bytes;
  if (size <= MAX_CACHE_BYTES) return;
  const oldest = db.prepare('SELECT path, length(body) AS bytes FROM product_images ORDER BY fetched_at').all() as { path: string; bytes: number }[];
  for (const row of oldest) {
    if (size <= MAX_CACHE_BYTES) break;
    db.prepare('DELETE FROM product_images WHERE path = ?').run(row.path);
    size -= row.bytes;
  }
}

export async function getProductImage(value: string, fetchImage: typeof fetch = fetch): Promise<ProductImage> {
  const path = productImagePath(value);
  const saved = db.prepare('SELECT body, content_type, fetched_at FROM product_images WHERE path = ?').get(path) as SavedImage | undefined;
  if (saved && Date.now() - saved.fetched_at < FRESH_MS) return { body: saved.body, contentType: saved.content_type };
  const existing = pending.get(path);
  if (existing) return existing;
  const request = (async () => {
    if (active >= 4) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const image = await readImage(await fetchImage(`https://www.kroger.com/product/images/${path}`, {
            redirect: 'error', credentials: 'omit', headers: { Accept: 'image/jpeg' }, signal: AbortSignal.timeout(10_000),
          }));
          saveImage(path, image);
          return image;
        } catch {
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (saved) return { body: saved.body, contentType: saved.content_type, stale: true };
      throw new UserError('Product photo is temporarily unavailable. Try opening this item again.', 502);
    } finally {
      const next = queue.shift();
      if (next) next(); else active--;
    }
  })();
  pending.set(path, request);
  try { return await request; } finally { pending.delete(path); }
}
