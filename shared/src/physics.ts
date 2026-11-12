import { brushOverlaps, clipBrush } from './brush.ts';
import { PLAYER_RADIUS } from './constants.ts';
import { rayAabb } from './math.ts';
import type { MapDef } from './maps/types.ts';

const EPS = 0.03125;

export interface TraceHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Static collision world built from the map's boxes. Solids block movement;
 * bullet blockers stop hitscan (glass and foliage are see/shoot-through).
 */
export class CollisionWorld {
  readonly solids: Float64Array;
  readonly bullets: Float64Array;
  readonly map: MapDef;

  constructor(map: MapDef) {
    this.map = map;
    const solid = map.boxes.filter((b) => b.solid);
    const bullet = map.boxes.filter((b) => !b.shootThrough);
    this.solids = new Float64Array(solid.length * 6);
    this.bullets = new Float64Array(bullet.length * 6);
    solid.forEach((b, i) => this.solids.set([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z], i * 6));
    bullet.forEach((b, i) => this.bullets.set([b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z], i * 6));
  }

  overlaps(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    const s = this.solids;
    for (let i = 0; i < s.length; i += 6) {
      if (maxX > s[i] && minX < s[i + 3] && maxY > s[i + 1] && minY < s[i + 4] && maxZ > s[i + 2] && minZ < s[i + 5]) {
        return true;
      }
    }
    return (this.map.brushes ?? []).some((b) => b.solid && brushOverlaps(b, [minX, minY, minZ], [maxX, maxY, maxZ]));
  }

  hullOverlaps(x: number, y: number, z: number, height: number): boolean {
    const r = PLAYER_RADIUS;
    return this.overlaps(x - r, y, z - r, x + r, y + height, z + r);
  }

  /**
   * Moves a player hull along one axis and stops at the first solid face.
   * Boxes the hull already overlaps are ignored so a stuck player can walk out.
   * Returns the distance actually travelled.
   */
  clipAxis(x: number, y: number, z: number, height: number, axis: 0 | 1 | 2, delta: number): number {
    if (delta === 0) return 0;
    const r = PLAYER_RADIUS;
    const sMinX = x - r;
    const sMaxX = x + r;
    const sMinY = y;
    const sMaxY = y + height;
    const sMinZ = z - r;
    const sMaxZ = z + r;
    let minX = sMinX;
    let maxX = sMaxX;
    let minY = sMinY;
    let maxY = sMaxY;
    let minZ = sMinZ;
    let maxZ = sMaxZ;
    if (axis === 0) {
      if (delta > 0) maxX += delta;
      else minX += delta;
    } else if (axis === 1) {
      if (delta > 0) maxY += delta;
      else minY += delta;
    } else if (delta > 0) maxZ += delta;
    else minZ += delta;

    let allowed = delta;
    const s = this.solids;
    for (let i = 0; i < s.length; i += 6) {
      const bx0 = s[i];
      const by0 = s[i + 1];
      const bz0 = s[i + 2];
      const bx1 = s[i + 3];
      const by1 = s[i + 4];
      const bz1 = s[i + 5];
      if (!(maxX > bx0 && minX < bx1 && maxY > by0 && minY < by1 && maxZ > bz0 && minZ < bz1)) continue;
      // already inside this box at the start: ignore (lets players escape)
      if (sMaxX > bx0 && sMinX < bx1 && sMaxY > by0 && sMinY < by1 && sMaxZ > bz0 && sMinZ < bz1) continue;
      let limit: number;
      if (axis === 0) limit = delta > 0 ? bx0 - sMaxX - EPS : bx1 - sMinX + EPS;
      else if (axis === 1) limit = delta > 0 ? by0 - sMaxY - EPS : by1 - sMinY + EPS;
      else limit = delta > 0 ? bz0 - sMaxZ - EPS : bz1 - sMinZ + EPS;
      if (delta > 0) {
        if (limit < allowed) allowed = limit < 0 ? 0 : limit;
      } else if (limit > allowed) allowed = limit > 0 ? 0 : limit;
    }
    for (const b of this.map.brushes ?? []) {
      if (!b.solid || maxX <= b.min.x || minX >= b.max.x || maxY <= b.min.y || minY >= b.max.y || maxZ <= b.min.z || minZ >= b.max.z) continue;
      const movement = [0, 0, 0];
      movement[axis] = delta;
      const hit = clipBrush(b, [x, y + height / 2, z], movement, [r, height / 2, r]);
      if (!hit || hit.inside || hit.exit <= 0 || hit.enter < 0) continue;
      const limit = Math.sign(delta) * Math.max(0, Math.abs(delta) * hit.enter - EPS);
      allowed = delta > 0 ? Math.min(allowed, limit) : Math.max(allowed, limit);
    }
    return allowed;
  }

  /** Nearest bullet-blocking surface along a normalized ray. */
  trace(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): TraceHit | null {
    const s = this.bullets;
    let best = maxDist;
    let bi = -1;
    for (let i = 0; i < s.length; i += 6) {
      const t = rayAabb(ox, oy, oz, dx, dy, dz, s[i], s[i + 1], s[i + 2], s[i + 3], s[i + 4], s[i + 5], best);
      if (t >= 0 && t < best) {
        best = t;
        bi = i;
      }
    }
    let brushHit: TraceHit | null = null;
    for (const b of this.map.brushes ?? []) {
      if (!b.solid || rayAabb(ox, oy, oz, dx, dy, dz, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z, best) < 0) continue;
      const hit = clipBrush(b, [ox, oy, oz], [dx * best, dy * best, dz * best]);
      if (!hit || hit.inside || hit.enter * best >= best) continue;
      best *= hit.enter;
      brushHit = { t: best, nx: hit.normal[0], ny: hit.normal[1], nz: hit.normal[2] };
    }
    if (brushHit) return brushHit;
    if (bi < 0) return null;
    const hx = ox + dx * best;
    const hy = oy + dy * best;
    const hz = oz + dz * best;
    // pick the face the hit point lies on
    const faces = [
      [Math.abs(hx - s[bi]), -1, 0, 0],
      [Math.abs(hx - s[bi + 3]), 1, 0, 0],
      [Math.abs(hy - s[bi + 1]), 0, -1, 0],
      [Math.abs(hy - s[bi + 4]), 0, 1, 0],
      [Math.abs(hz - s[bi + 2]), 0, 0, -1],
      [Math.abs(hz - s[bi + 5]), 0, 0, 1],
    ];
    let f = faces[0];
    for (const c of faces) if (c[0] < f[0]) f = c;
    return { t: best, nx: f[1], ny: f[2], nz: f[3] };
  }

  /** Height of the first surface below (x, z) starting at y, or -Infinity. */
  groundBelow(x: number, y: number, z: number, halfSize: number): number {
    const s = this.solids;
    let best = -Infinity;
    for (let i = 0; i < s.length; i += 6) {
      if (x + halfSize > s[i] && x - halfSize < s[i + 3] && z + halfSize > s[i + 2] && z - halfSize < s[i + 5]) {
        const top = s[i + 4];
        if (top <= y + 0.001 && top > best) best = top;
      }
    }
    for (const b of this.map.brushes ?? []) {
      if (!b.solid || x + halfSize <= b.min.x || x - halfSize >= b.max.x || z + halfSize <= b.min.z || z - halfSize >= b.max.z) continue;
      const length = Math.max(1, y - b.min.y + 1);
      const hit = clipBrush(b, [x, y, z], [0, -length, 0], [halfSize, 0, halfSize]);
      if (hit && !hit.inside && hit.normal[1] > 0) best = Math.max(best, y - hit.enter * length);
    }
    return best;
  }
}
