// ZIP geocoding (zippopotam.us, free, no key) + distance math + DFW coverage check.
import { fetchJson, DAY } from './http.ts';
import { config } from './config.ts';

export type Place = { zip: string; city: string; state: string; lat: number; lng: number };

const DALLAS = { lat: 32.7767, lng: -96.797 };

export class UserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function geocodeZip(zip: string): Promise<Place> {
  if (!/^\d{5}$/.test(zip)) throw new UserError('Enter a 5-digit US ZIP code.');
  let j: any;
  try {
    j = await fetchJson(`https://api.zippopotam.us/us/${zip}`, { ttlMs: 365 * DAY });
  } catch (e: any) {
    if (e.status === 404) throw new UserError(`ZIP ${zip} wasn't found. Check the number and try again.`, 404);
    throw new UserError(`Couldn't look up ZIP ${zip} right now (geocoder unavailable). Try again in a minute.`, 503);
  }
  const p = j.places?.[0];
  if (!p) throw new UserError(`ZIP ${zip} wasn't found.`, 404);
  const place = { zip, city: p['place name'], state: p['state abbreviation'], lat: Number(p.latitude), lng: Number(p.longitude) };
  const fromDallas = milesBetween(place, DALLAS);
  if (fromDallas > config.coverageMiles) {
    throw new UserError(
      `Ad Week only covers the Dallas–Fort Worth area right now. ZIP ${zip} is ${place.city}, ${place.state}, about ${Math.round(fromDallas)} miles from Dallas.`,
      422,
    );
  }
  return place;
}
