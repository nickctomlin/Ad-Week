// Product photos use our own origin so phones do not depend on a direct Kroger CDN connection.
// This also repairs URLs in saved lists and playgrounds without a data refresh.
export function imageUrl(value) {
  if (!value) return '';
  const match = String(value).match(/^https:\/\/www\.kroger\.com\/product\/images\/((?:medium|small|large|xlarge|thumbnail)\/(?:front|back|left|right|top|bottom)\/\d{8,14})$/);
  return match ? `/api/product-image?path=${encodeURIComponent(match[1])}` : value;
}
