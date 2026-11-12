import { vec3 } from '../math.ts';
import type { Box, MapLight, Mat } from './types.ts';

export interface BoxOpts {
  solid?: boolean;
  shoot?: boolean;
  visible?: boolean;
}

export interface Opening {
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/**
 * Small authoring helper. All coordinates are world units, Y up.
 * `rotated()` replays a block of authoring code four times, rotating it by
 * 90 degrees around the origin each time, which gives fair FFA layouts.
 */
export class MapBuilder {
  readonly boxes: Box[] = [];
  readonly lights: MapLight[] = [];
  readonly points: { x: number; z: number }[] = [];
  private rot = 0;

  private rotXZ(x: number, z: number): [number, number] {
    let ax = x;
    let az = z;
    for (let i = 0; i < this.rot; i++) {
      const nx = -az;
      az = ax;
      ax = nx;
    }
    return [ax, az];
  }

  add(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, mat: Mat, o: BoxOpts = {}): void {
    const [ax1, az1] = this.rotXZ(x1, z1);
    const [ax2, az2] = this.rotXZ(x2, z2);
    this.boxes.push({
      min: vec3(Math.min(ax1, ax2), Math.min(y1, y2), Math.min(az1, az2)),
      max: vec3(Math.max(ax1, ax2), Math.max(y1, y2), Math.max(az1, az2)),
      mat,
      solid: o.solid ?? true,
      shootThrough: o.shoot ?? false,
      visible: o.visible ?? true,
    });
  }

  /** Box by footprint centre and size, standing on y0. */
  block(cx: number, cz: number, w: number, d: number, h: number, mat: Mat, y0 = 0, o?: BoxOpts): void {
    this.add(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, mat, o);
  }

  crate(cx: number, cz: number, s: number, y0 = 0, mat: Mat = 'crate'): void {
    this.block(cx, cz, s, s, s, mat, y0);
  }

  /** Non-solid decorative strip (neon trims etc). */
  deco(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, mat: Mat = 'lime'): void {
    this.add(x1, y1, z1, x2, y2, z2, mat, { solid: false, shoot: true });
  }

  light(x: number, y: number, z: number, color = '#b6ff4a'): void {
    const [ax, az] = this.rotXZ(x, z);
    this.lights.push({ x: ax, y, z: az, color });
  }

  point(x: number, z: number): void {
    const [ax, az] = this.rotXZ(x, z);
    this.points.push({ x: ax, z: az });
  }

  /** Wall running along X (from x1 to x2) centred on z, with openings measured along X. */
  wallX(x1: number, x2: number, z: number, thick: number, h: number, mat: Mat, openings: Opening[] = [], y0 = 0): void {
    this.wallSpan(x1, x2, h, openings, y0, (a, b, lo, hi) =>
      this.add(a, lo, z - thick / 2, b, hi, z + thick / 2, mat),
    );
  }

  /** Wall running along Z (from z1 to z2) centred on x, with openings measured along Z. */
  wallZ(z1: number, z2: number, x: number, thick: number, h: number, mat: Mat, openings: Opening[] = [], y0 = 0): void {
    this.wallSpan(z1, z2, h, openings, y0, (a, b, lo, hi) =>
      this.add(x - thick / 2, lo, a, x + thick / 2, hi, b, mat),
    );
  }

  private wallSpan(
    a: number,
    b: number,
    h: number,
    openings: Opening[],
    y0: number,
    emit: (a: number, b: number, lo: number, hi: number) => void,
  ): void {
    const ops = [...openings].sort((p, q) => p.from - q.from);
    let cursor = a;
    for (const op of ops) {
      if (op.from > cursor) emit(cursor, op.from, y0, y0 + h);
      if (op.bottom > 0) emit(op.from, op.to, y0, y0 + op.bottom);
      if (op.top < h) emit(op.from, op.to, y0 + op.top, y0 + h);
      cursor = op.to;
    }
    if (cursor < b) emit(cursor, b, y0, y0 + h);
  }

  /** Solid staircase filling a rectangle, rising toward `dir`. Steps never exceed 16 units. */
  stairs(x1: number, x2: number, z1: number, z2: number, dir: '+x' | '-x' | '+z' | '-z', height: number, mat: Mat, y0 = 0): void {
    const n = Math.ceil(height / 16);
    const stepH = height / n;
    for (let i = 0; i < n; i++) {
      const top = y0 + stepH * (i + 1);
      const t0 = i / n;
      const t1 = (i + 1) / n;
      // Each step is its own solid column from y0, so nothing can wedge underneath
      // and no faces overlap (no z-fighting on the sides).
      switch (dir) {
        case '+x':
          this.add(x1 + (x2 - x1) * t0, y0, z1, x1 + (x2 - x1) * t1, top, z2, mat);
          break;
        case '-x':
          this.add(x2 - (x2 - x1) * t1, y0, z1, x2 - (x2 - x1) * t0, top, z2, mat);
          break;
        case '+z':
          this.add(x1, y0, z1 + (z2 - z1) * t0, x2, top, z1 + (z2 - z1) * t1, mat);
          break;
        case '-z':
          this.add(x1, y0, z2 - (z2 - z1) * t1, x2, top, z2 - (z2 - z1) * t0, mat);
          break;
      }
    }
  }

  /** Replays the block twice: as authored and rotated 180 degrees. */
  mirrored(fn: () => void): void {
    this.rot = 0;
    fn();
    this.rot = 2;
    fn();
    this.rot = 0;
  }

  rotated(fn: () => void): void {
    for (let r = 0; r < 4; r++) {
      this.rot = r;
      fn();
    }
    this.rot = 0;
  }
}
