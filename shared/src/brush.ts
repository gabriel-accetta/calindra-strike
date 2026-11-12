import type { Brush } from './maps/types.ts';

const planeCache = new WeakMap<Brush, number[][]>();

/** Clip a segment against a convex brush, optionally expanded by a player hull. */
export function clipBrush(
  brush: Brush,
  origin: number[],
  delta: number[],
  half = [0, 0, 0],
): { enter: number; exit: number; normal: number[]; inside: boolean } | null {
  let enter = 0;
  let exit = 1;
  let inside = true;
  let normal = [0, 1, 0];
  // Axial bounds prevent expanded diagonal planes extending beyond the brush.
  let planes = planeCache.get(brush);
  if (!planes) {
    planes = [
      ...brush.planes,
      [1, 0, 0, brush.max.x],
      [-1, 0, 0, -brush.min.x],
      [0, 1, 0, brush.max.y],
      [0, -1, 0, -brush.min.y],
      [0, 0, 1, brush.max.z],
      [0, 0, -1, -brush.min.z],
    ];
    planeCache.set(brush, planes);
  }
  for (const p of planes) {
    const distance = p[3] + Math.abs(p[0]) * half[0] + Math.abs(p[1]) * half[1] + Math.abs(p[2]) * half[2];
    const start = p[0] * origin[0] + p[1] * origin[1] + p[2] * origin[2] - distance;
    const speed = p[0] * delta[0] + p[1] * delta[1] + p[2] * delta[2];
    if (start >= -1e-6) inside = false;
    if (Math.abs(speed) < 1e-10) {
      if (start > 0) return null;
      continue;
    }
    const t = -start / speed;
    if (speed < 0) {
      if (t >= enter) {
        enter = t;
        normal = p.slice(0, 3);
      }
    } else exit = Math.min(exit, t);
    if (enter > exit) return null;
  }
  if (exit < 0 || enter > 1) return null;
  return { enter, exit, normal, inside };
}

export function brushOverlaps(b: Brush, lo: number[], hi: number[]): boolean {
  if (hi[0] <= b.min.x || lo[0] >= b.max.x || hi[1] <= b.min.y || lo[1] >= b.max.y || hi[2] <= b.min.z || lo[2] >= b.max.z) return false;
  const center = lo.map((v, i) => (v + hi[i]) / 2);
  const half = lo.map((v, i) => (hi[i] - v) / 2);
  return clipBrush(b, center, [0, 0, 0], half)?.inside === true;
}
