import {
  BTN,
  type Cmd,
  type CollisionWorld,
  DEG,
  type GameMode,
  WEAPON,
  clamp,
  eyeHeight,
  weaponDef,
  wrapAngle,
} from '@calindra-strike/shared';
import type { ServerPlayer } from './game.ts';
import type { NavGrid, NavNode } from './nav.ts';

export interface BotEnv {
  world: CollisionWorld;
  nav: NavGrid;
  tick: number;
  now: number;
  mode: GameMode;
  random: () => number;
  players: Iterable<ServerPlayer>;
  airdrops: { x: number; y: number; z: number; landed: boolean }[];
}

const SCAN_EVERY = 6; // ticks between target scans (100 ms)
const VIEW_RANGE = 2600;
const HEAR_RANGE = 420; // notices you behind it up close

function gauss(r: () => number): number {
  return (r() + r() + r() - 1.5) / 0.75;
}

/** Angle from eye to a point, in the game's yaw/pitch convention. */
function anglesTo(ex: number, ey: number, ez: number, x: number, y: number, z: number): [number, number] {
  const dx = x - ex;
  const dz = z - ez;
  return [Math.atan2(-dx, -dz), Math.atan2(y - ey, Math.hypot(dx, dz))];
}

/**
 * Server-side bot. Produces exactly one command per tick through the same
 * simulation as real players, so it moves and shoots under the same rules.
 */
export class BotBrain {
  private seq = 0;
  private yaw = 0;
  private pitch = 0;
  private aimInit = false;
  private errYaw = 0;
  private errPitch = 0;
  private targetId = -1;
  private reactAt = 0;
  private aimHead = false;
  private burstLeft = 0;
  private pauseUntil = 0;
  private strafeDir = 1;
  private strafeUntil = 0;
  private path: NavNode[] = [];
  private jumps: boolean[] = [];
  private pathIdx = 0;
  private goal: { x: number; y: number; z: number } | null = null;
  private repathAt = 0;
  private goalUntil = 0;
  private lastCheck = { x: 0, z: 0, tick: 0 };
  private stuck = 0;
  private prevButtons = 0;

  constructor(private readonly skill: number) {}

  /** Called when the bot (re)spawns so it forgets the previous life. */
  reset(): void {
    this.aimInit = false;
    this.targetId = -1;
    this.path = [];
    this.goal = null;
    this.stuck = 0;
  }

  private lerpSkill(lo: number, hi: number): number {
    return lo + (hi - lo) * this.skill;
  }

  private turnTo(yaw: number, pitch: number, dt: number, rateDeg: number): void {
    const max = rateDeg * DEG * dt;
    const dy = wrapAngle(yaw - this.yaw);
    this.yaw = wrapAngle(this.yaw + clamp(dy, -max, max));
    this.pitch += clamp(pitch - this.pitch, -max, max);
  }

  private isEnemy(self: ServerPlayer, q: ServerPlayer, mode: GameMode): boolean {
    return q !== self && q.alive && (mode === 'ffa' || q.team !== self.team);
  }

  private visible(env: BotEnv, ex: number, ey: number, ez: number, q: ServerPlayer): boolean {
    const t = q.state;
    for (const h of [44, 64]) {
      const dx = t.x - ex;
      const dy = t.y + h - ey;
      const dz = t.z - ez;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1) return true;
      if (!env.world.trace(ex, ey, ez, dx / len, dy / len, dz / len, len)) return true;
    }
    return false;
  }

  private scan(self: ServerPlayer, env: BotEnv): ServerPlayer | null {
    const s = self.state;
    const ex = s.x;
    const ey = s.y + eyeHeight(s);
    const ez = s.z;
    let best: ServerPlayer | null = null;
    let bestD = Infinity;
    for (const q of env.players) {
      if (!this.isEnemy(self, q, env.mode) || q.state.dropping) continue;
      const d = Math.hypot(q.state.x - ex, q.state.z - ez);
      if (d > VIEW_RANGE) continue;
      // field of view ~140 degrees, but close enemies are heard anyway
      const [yaw] = anglesTo(ex, ey, ez, q.state.x, q.state.y + 44, q.state.z);
      if (d > HEAR_RANGE && Math.abs(wrapAngle(yaw - this.yaw)) > 70 * DEG) continue;
      if (!this.visible(env, ex, ey, ez, q)) continue;
      // prefer the current target slightly so bots don't flick between people
      const score = d * (q.id === this.targetId ? 0.7 : 1);
      if (score < bestD) {
        bestD = score;
        best = q;
      }
    }
    return best;
  }

  private nearestEnemy(self: ServerPlayer, env: BotEnv): ServerPlayer | null {
    let best: ServerPlayer | null = null;
    let bestD = Infinity;
    for (const q of env.players) {
      if (!this.isEnemy(self, q, env.mode) || q.state.dropping) continue;
      const d = Math.hypot(q.state.x - self.state.x, q.state.z - self.state.z);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  }

  private pickGoal(self: ServerPlayer, env: BotEnv): void {
    const s = self.state;
    const r = env.random();
    const drop = env.airdrops.find((d) => d.landed && Math.hypot(d.x - s.x, d.z - s.z) < 1600);
    const enemy = this.nearestEnemy(self, env);
    if (drop && r < 0.6) this.goal = { x: drop.x, y: drop.y, z: drop.z };
    else if (enemy && r < 0.85) this.goal = { x: enemy.state.x, y: enemy.state.y, z: enemy.state.z };
    else {
      const n = env.nav.randomNode(env.random);
      this.goal = { x: n.x, y: n.y, z: n.z };
    }
    this.goalUntil = env.tick + 180 + Math.floor(env.random() * 180);
    this.repathAt = 0;
  }

  private repath(self: ServerPlayer, env: BotEnv): void {
    const s = self.state;
    this.repathAt = env.tick + 90;
    if (!this.goal) return;
    const a = env.nav.nearest(s.x, s.y, s.z);
    const b = env.nav.nearest(this.goal.x, this.goal.y + 4, this.goal.z);
    if (!a || !b) {
      this.path = [];
      return;
    }
    const p = env.nav.findPath(a, b) ?? [];
    this.path = p;
    this.jumps = p.map((n, i) => {
      const prev = i === 0 ? a : p[i - 1];
      return env.nav.edgeBetween(prev, n)?.jump ?? false;
    });
    this.pathIdx = 0;
  }

  think(self: ServerPlayer, env: BotEnv): Cmd {
    const s = self.state;
    const dt = 1 / 60;
    if (!this.aimInit) {
      this.yaw = s.yaw;
      this.pitch = 0;
      this.aimInit = true;
    }
    let buttons = 0;
    let weapon = 0;

    // out of ammo on the primary: fall back like a player would
    const def = weaponDef(s.weapon);
    if (def.mag > 0 && s.mag[s.weapon] === 0 && s.reserve[s.weapon] === 0) weapon = s.weapon === WEAPON.PISTOL ? 3 : 2;

    if (s.dropping) {
      // glide toward the action and dive once roughly above it
      const enemy = this.nearestEnemy(self, env);
      const tx = enemy ? enemy.state.x : 0;
      const tz = enemy ? enemy.state.z : 0;
      const d = Math.hypot(tx - s.x, tz - s.z);
      const [yaw] = anglesTo(s.x, 0, s.z, tx, 0, tz);
      this.turnTo(yaw, -0.6, dt, 240);
      buttons = d > 200 ? BTN.FWD : BTN.DUCK;
      return this.cmd(buttons, weapon, env);
    }

    // --- perception
    if (env.tick % SCAN_EVERY === self.id % SCAN_EVERY) {
      const t = this.scan(self, env);
      const id = t ? t.id : -1;
      if (id !== this.targetId) {
        this.targetId = id;
        if (t) {
          this.reactAt = env.tick + Math.round(this.lerpSkill(24, 9) + env.random() * 8);
          const e = this.lerpSkill(6, 2) * DEG;
          this.errYaw = gauss(env.random) * e;
          this.errPitch = gauss(env.random) * e * 0.6;
          this.aimHead = env.random() < this.lerpSkill(0.15, 0.5);
          this.burstLeft = 0;
        }
      }
    }
    let target: ServerPlayer | null = null;
    if (this.targetId >= 0) {
      for (const q of env.players) if (q.id === this.targetId) target = q;
      if (!target || !this.isEnemy(self, target, env.mode) || target.state.dropping) {
        this.targetId = -1;
        target = null;
      }
    }

    if (target) {
      // --- combat
      const t = target.state;
      const ex = s.x;
      const ey = s.y + eyeHeight(s);
      const ez = s.z;
      const aimY = t.y + (t.ducked ? (this.aimHead ? 30 : 20) : this.aimHead ? 64 : 44);
      const dist = Math.hypot(t.x - ex, t.z - ez);
      const [wantYaw, wantPitch] = anglesTo(ex, ey, ez, t.x, aimY, t.z);
      const settle = Math.max(0, 1 - this.lerpSkill(2.2, 5.5) * dt);
      this.errYaw *= settle;
      this.errPitch *= settle;
      const jitter = this.lerpSkill(0.9, 0.3) * DEG;
      this.turnTo(wantYaw + this.errYaw + gauss(env.random) * jitter * 0.3, wantPitch + this.errPitch, dt, this.lerpSkill(260, 620));
      const off = Math.hypot(wrapAngle(wantYaw - this.yaw), wantPitch - this.pitch);
      const tolerance = Math.atan2(this.aimHead ? 7 : 12, Math.max(1, dist)) + 0.6 * DEG;
      const ready = env.tick >= this.reactAt;
      const cur = weaponDef(s.weapon);

      if (cur.slot === 3) {
        buttons |= BTN.FWD;
        if (dist < 80 && ready) buttons |= BTN.ATTACK;
      } else if (cur.zoomFov.length && s.zoom === 0 && s.resumeZoom === 0 && dist > 350 && !(this.prevButtons & BTN.ATTACK2)) {
        buttons |= BTN.ATTACK2; // scope in before taking an AWP shot
      } else if (ready && off < tolerance && env.tick >= this.pauseUntil) {
        if (cur.auto) {
          if (this.burstLeft <= 0) this.burstLeft = 3 + Math.floor(env.random() * this.lerpSkill(3, 6));
          buttons |= BTN.ATTACK;
          if (s.tick + 1 >= s.nextFire && s.mag[s.weapon] > 0) {
            this.burstLeft--;
            if (this.burstLeft <= 0) this.pauseUntil = env.tick + 14 + Math.floor(env.random() * 16);
          }
        } else if (!(this.prevButtons & BTN.ATTACK)) {
          buttons |= BTN.ATTACK; // semi-auto: tap
        }
      }

      // counter-strafe: stand still while shooting, strafe between bursts
      if (!(buttons & BTN.ATTACK) && cur.slot !== 3) {
        if (env.tick >= this.strafeUntil) {
          this.strafeDir = env.random() < 0.5 ? -1 : 1;
          this.strafeUntil = env.tick + 20 + Math.floor(env.random() * 30);
        }
        buttons |= this.strafeDir > 0 ? BTN.RIGHT : BTN.LEFT;
        if (dist > 1100) buttons |= BTN.FWD;
      }
      this.path = []; // replan after the fight
      return this.cmd(buttons, weapon, env);
    }

    // --- navigation
    if (!this.goal || env.tick >= this.goalUntil) this.pickGoal(self, env);
    if (env.tick >= this.repathAt) this.repath(self, env);
    let node = this.path[this.pathIdx];
    while (node && Math.hypot(node.x - s.x, node.z - s.z) < 26 && Math.abs(node.y - s.y) < 40) {
      this.pathIdx++;
      node = this.path[this.pathIdx];
    }
    if (!node) {
      if (this.goal && Math.hypot(this.goal.x - s.x, this.goal.z - s.z) < 60) this.pickGoal(self, env);
      this.repathAt = Math.min(this.repathAt, env.tick + 10);
    } else {
      const [yaw] = anglesTo(s.x, 0, s.z, node.x, 0, node.z);
      this.turnTo(yaw, 0, dt, this.lerpSkill(300, 520));
      // walk once roughly facing the waypoint
      if (Math.abs(wrapAngle(yaw - this.yaw)) < 70 * DEG) buttons |= BTN.FWD;
      const near = Math.hypot(node.x - s.x, node.z - s.z) < 72;
      if (this.jumps[this.pathIdx] && near && s.onGround && !s.jumpHeld) buttons |= BTN.JUMP;
    }

    // unstick: jump, then pick somewhere else
    if (env.tick - this.lastCheck.tick >= 45) {
      const moved = Math.hypot(s.x - this.lastCheck.x, s.z - this.lastCheck.z);
      if (moved < 10 && node) {
        this.stuck++;
        if (this.stuck >= 3) {
          const n = env.nav.randomNode(env.random);
          this.goal = { x: n.x, y: n.y, z: n.z };
          this.repathAt = 0;
          this.stuck = 0;
        }
      } else this.stuck = 0;
      this.lastCheck = { x: s.x, z: s.z, tick: env.tick };
    }
    if (this.stuck > 0 && s.onGround && !s.jumpHeld) buttons |= BTN.JUMP;
    if (s.reload === 0 && def.mag > 0 && s.mag[s.weapon] < def.mag * 0.4 && s.reserve[s.weapon] > 0) buttons |= BTN.RELOAD;

    return this.cmd(buttons, weapon, env);
  }

  private cmd(buttons: number, weapon: number, env: BotEnv): Cmd {
    this.prevButtons = buttons;
    return { seq: ++this.seq, buttons, yaw: this.yaw, pitch: clamp(this.pitch, -1.5, 1.5), weapon, interp: env.now };
  }
}

export const BOT_NAMES = ['Brokkr', 'Sindri', 'Freya', 'Loki', 'Tyr', 'Skadi', 'Odin', 'Heimdall', 'Thor', 'Baldur', 'Frigg', 'Idun', 'Njord', 'Vidar', 'Sif', 'Bragi'];
