import { type CollisionWorld, type MapDef, STAND_HEIGHT } from '@calindra-strike/shared';

export interface NavEdge {
  to: number;
  cost: number;
  jump: boolean;
}

export interface NavNode {
  id: number;
  x: number;
  y: number;
  z: number;
  edges: NavEdge[];
}

const CELL = 48;
const MAX_STEP = 18; // walkable without jumping (stairs)
const MAX_JUMP = 40; // plain jump reaches 45
const MAX_DROP = 300; // roofs and perches: bots jump off
const MAX_SURFACE = 600; // ignore the sky clip

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/**
 * Layered navigation grid generated from the collision boxes: every column of
 * the map gets one node per standable surface (floor, crate tops, roofs...).
 * Edges walk, step, jump up or drop down between neighbouring columns.
 */
export class NavGrid {
  readonly nodes: NavNode[] = [];
  private readonly columns: number[][];
  private readonly minX: number;
  private readonly minZ: number;
  private readonly nx: number;
  private readonly nz: number;
  // scratch buffers for A*
  private readonly g: Float64Array;
  private readonly f: Float64Array;
  private readonly from: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private gen = 1;

  constructor(
    private readonly world: CollisionWorld,
    map: MapDef,
  ) {
    const b = map.bounds;
    this.minX = b.minX + 24;
    this.minZ = b.minZ + 24;
    this.nx = Math.floor((b.maxX - 24 - this.minX) / CELL) + 1;
    this.nz = Math.floor((b.maxZ - 24 - this.minZ) / CELL) + 1;
    this.columns = Array.from({ length: this.nx * this.nz }, () => []);

    const solids = map.boxes.filter((bx) => bx.solid && bx.max.y < MAX_SURFACE);
    for (let i = 0; i < this.nx; i++) {
      for (let j = 0; j < this.nz; j++) {
        const x = this.minX + i * CELL;
        const z = this.minZ + j * CELL;
        const tops = new Set<number>();
        for (const bx of solids) {
          // anything under the player's 32x32 footprint can be what they stand on (stair edges, narrow crates)
          if (x + 16 > bx.min.x && x - 16 < bx.max.x && z + 16 > bx.min.z && z - 16 < bx.max.z) tops.add(bx.max.y);
        }
        for (const y of [...tops].sort((a, c) => a - c)) {
          if (world.hullOverlaps(x, y + 0.1, z, STAND_HEIGHT)) continue;
          const id = this.nodes.length;
          this.nodes.push({ id, x, y, z, edges: [] });
          this.columns[i * this.nz + j].push(id);
        }
      }
    }

    for (let i = 0; i < this.nx; i++) {
      for (let j = 0; j < this.nz; j++) {
        for (const id of this.columns[i * this.nz + j]) {
          const n = this.nodes[id];
          for (const [di, dj] of DIRS) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) continue;
            for (const mid of this.columns[ii * this.nz + jj]) {
              const m = this.nodes[mid];
              const dy = m.y - n.y;
              if (dy > MAX_JUMP || dy < -MAX_DROP) continue;
              if (!this.clear(n, m)) continue;
              const dist = Math.hypot(m.x - n.x, m.z - n.z);
              const jump = dy > MAX_STEP;
              const drop = dy < -MAX_STEP;
              n.edges.push({ to: mid, cost: dist * (jump ? 1.8 : drop ? 1.3 : 1) + (jump ? 30 : 0), jump });
            }
          }
        }
      }
    }

    const n = this.nodes.length;
    this.g = new Float64Array(n);
    this.f = new Float64Array(n);
    this.from = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  /** A hull can travel between two neighbouring nodes at the higher of their heights. */
  private clear(a: NavNode, b: NavNode): boolean {
    const h = Math.max(a.y, b.y) + 0.5;
    for (const t of [0.25, 0.5, 0.75]) {
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (this.world.hullOverlaps(x, h, z, STAND_HEIGHT)) return false;
    }
    return true;
  }

  /** Closest node at or below the given point (within a couple of cells). */
  nearest(x: number, y: number, z: number): NavNode | null {
    const ci = Math.round((x - this.minX) / CELL);
    const cj = Math.round((z - this.minZ) / CELL);
    let best: NavNode | null = null;
    let bestD = Infinity;
    for (let r = 0; r <= 3 && !best; r++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) continue;
          for (const id of this.columns[i * this.nz + j]) {
            const n = this.nodes[id];
            if (n.y > y + 24) continue; // must be standing on or above it
            const d = Math.hypot(n.x - x, n.z - z) + Math.abs(y - n.y) * 2;
            if (d < bestD) {
              bestD = d;
              best = n;
            }
          }
        }
      }
    }
    return best;
  }

  randomNode(random: () => number): NavNode {
    return this.nodes[Math.floor(random() * this.nodes.length)];
  }

  /** A* over the grid. Returns the node sequence (excluding the start) or null. */
  findPath(start: NavNode, goal: NavNode, maxExpand = 6000): NavNode[] | null {
    if (start === goal) return [];
    const gen = ++this.gen;
    const open: number[] = [start.id];
    this.g[start.id] = 0;
    this.f[start.id] = this.h(start, goal);
    this.from[start.id] = -1;
    this.seen[start.id] = gen;
    let expanded = 0;
    while (open.length && expanded++ < maxExpand) {
      // small open sets: linear min is fast enough and keeps the code simple
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (this.f[open[k]] < this.f[open[bi]]) bi = k;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (cur === goal.id) return this.unwind(cur);
      this.closed[cur] = gen;
      for (const e of this.nodes[cur].edges) {
        if (this.closed[e.to] === gen) continue;
        const ng = this.g[cur] + e.cost;
        if (this.seen[e.to] === gen && ng >= this.g[e.to]) continue;
        if (this.seen[e.to] !== gen) open.push(e.to);
        this.seen[e.to] = gen;
        this.g[e.to] = ng;
        this.f[e.to] = ng + this.h(this.nodes[e.to], goal);
        this.from[e.to] = cur;
      }
    }
    return null;
  }

  private h(a: NavNode, b: NavNode): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  private unwind(id: number): NavNode[] {
    const out: NavNode[] = [];
    let cur = id;
    while (this.from[cur] !== -1) {
      out.push(this.nodes[cur]);
      cur = this.from[cur];
    }
    return out.reverse();
  }

  edgeBetween(a: NavNode, b: NavNode): NavEdge | undefined {
    return a.edges.find((e) => e.to === b.id);
  }
}
