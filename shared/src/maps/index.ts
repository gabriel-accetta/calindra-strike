import { buildDust2 } from './dust2.ts';
import { buildEscritorio } from './escritorio.ts';
import { buildForja } from './forja.ts';
import type { MapDef } from './types.ts';

export * from './types.ts';
export { MapBuilder } from './builder.ts';

let cache: MapDef[] | null = null;

/** Map rotation order. Built lazily and cached (both client and server need identical data). */
export function getMaps(): MapDef[] {
  if (!cache) cache = [buildForja(), buildEscritorio(), buildDust2()];
  return cache;
}

export function getMap(index: number): MapDef {
  const maps = getMaps();
  return maps[((index % maps.length) + maps.length) % maps.length];
}
