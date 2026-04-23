/**
 * Thumbnail URL resolution upgrade for Expedia CDN images.
 *
 * The adapter returns thumbnail_url with the tiny (_t, 70x70) suffix from
 * Expedia's image CDN (images.trvl-media.com). For richer presentation
 * contexts (Notion canvases, web UIs, single-property views), the model
 * benefits from a higher-resolution image.
 *
 * Expedia's CDN uses a letter-based suffix convention before the file
 * extension:
 *   _t = tiny    (70x70)
 *   _s = small
 *   _y = medium  (~500x214, good for cards)
 *   _l = large
 *   _z = full-resolution
 *
 * This module upgrades _t to _y (medium) by default — large enough for
 * card layouts, small enough to be reasonable in bandwidth. The suffix
 * swap is a simple string replacement; the CDN handles the rest.
 */

type ImageSuffix = '_t' | '_s' | '_y' | '_l' | '_z';

const SUFFIX_PATTERN = /_(t|s|y|l|z)\.(jpe?g|png|webp)$/i;

/**
 * Upgrade an Expedia CDN thumbnail URL to a higher resolution.
 *
 * Returns the original URL unchanged if it doesn't match the expected
 * suffix pattern — defensive against non-Expedia URLs or future format
 * changes.
 */
export function upgradeThumbnailUrl(
  url: string,
  targetSuffix: ImageSuffix = '_y',
): string {
  return url.replace(SUFFIX_PATTERN, (_match, _letter, ext) => `${targetSuffix}.${ext}`);
}
