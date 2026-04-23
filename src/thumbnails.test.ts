import { describe, expect, it } from 'vitest';
import { upgradeThumbnailUrl } from './thumbnails.js';

describe('upgradeThumbnailUrl', () => {
  it('upgrades _t.jpg to _y.jpg by default', () => {
    const url = 'https://images.trvl-media.com/lodging/12345678/abc123_t.jpg';
    expect(upgradeThumbnailUrl(url)).toBe(
      'https://images.trvl-media.com/lodging/12345678/abc123_y.jpg',
    );
  });

  it('upgrades _t.jpeg to _y.jpeg', () => {
    const url = 'https://images.trvl-media.com/lodging/12345678/abc123_t.jpeg';
    expect(upgradeThumbnailUrl(url)).toBe(
      'https://images.trvl-media.com/lodging/12345678/abc123_y.jpeg',
    );
  });

  it('upgrades _t.png to _y.png', () => {
    const url = 'https://images.trvl-media.com/lodging/12345678/abc123_t.png';
    expect(upgradeThumbnailUrl(url)).toBe(
      'https://images.trvl-media.com/lodging/12345678/abc123_y.png',
    );
  });

  it('upgrades _t.webp to _y.webp', () => {
    const url = 'https://images.trvl-media.com/lodging/12345678/abc123_t.webp';
    expect(upgradeThumbnailUrl(url)).toBe(
      'https://images.trvl-media.com/lodging/12345678/abc123_y.webp',
    );
  });

  it('accepts a custom target suffix', () => {
    const url = 'https://images.trvl-media.com/lodging/12345678/abc123_t.jpg';
    expect(upgradeThumbnailUrl(url, '_z')).toBe(
      'https://images.trvl-media.com/lodging/12345678/abc123_z.jpg',
    );
  });

  it('upgrades _s suffix as well', () => {
    const url = 'https://images.trvl-media.com/lodging/12345678/abc123_s.jpg';
    expect(upgradeThumbnailUrl(url)).toBe(
      'https://images.trvl-media.com/lodging/12345678/abc123_y.jpg',
    );
  });

  it('returns the URL unchanged if suffix does not match the pattern', () => {
    const url = 'https://images.trvl-media.com/lodging/12345678/abc123.jpg';
    expect(upgradeThumbnailUrl(url)).toBe(url);
  });

  it('returns a non-CDN URL unchanged', () => {
    const url = 'https://example.com/photo.jpg';
    expect(upgradeThumbnailUrl(url)).toBe(url);
  });

  it('is case-insensitive on the suffix', () => {
    const url = 'https://images.trvl-media.com/lodging/12345678/abc123_T.JPG';
    expect(upgradeThumbnailUrl(url)).toBe(
      'https://images.trvl-media.com/lodging/12345678/abc123_y.JPG',
    );
  });
});
