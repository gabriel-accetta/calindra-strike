/** Official brand artwork (served from /public/brand). Preloaded before any texture is built. */
export const BRAND = {
  bulldog: '/brand/bulldog-lime-512.png', // Calindra Strike logo (lime line art, transparent)
  eitri: '/brand/eitri-icon.png', // official Eitri app icon
  eitriSmall: '/brand/eitri-icon-64.png',
} as const;

const images = new Map<string, HTMLImageElement>();

function load(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      images.set(src, img);
      resolve();
    };
    img.onerror = () => resolve(); // textures fall back to plain surfaces
    img.src = src;
  });
}

let pending: Promise<void> | null = null;

export function loadBrand(): Promise<void> {
  pending ??= Promise.all([load(BRAND.bulldog), load(BRAND.eitri)]).then(() => undefined);
  return pending;
}

export function brandImage(key: 'bulldog' | 'eitri'): HTMLImageElement | null {
  return images.get(BRAND[key]) ?? null;
}
