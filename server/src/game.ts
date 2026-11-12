import {
  AIRDROP_FALL_SPEED,
  AIRDROP_HALF,
  AIRDROP_PICKUP_RADIUS,
  type Cmd,
  CollisionWorld,
  type GameEvent,
  LAGCOMP_MAX_MS,
  LEGENDARIES,
  MAX_ARMOR,
  MAX_HEALTH,
  type MapDef,
  type MatchInfo,
  type MatchPhase,
  PLAYER_COLORS,
  type PlayerState,
  RESPAWN_TICKS,
  RF_ALIVE,
  RF_DROP,
  RF_DUCK,
  RF_GROUND,
  RF_PROTECT,
  RF_RELOAD,
  RF_ZOOM,
  type ResultRow,
  type RosterEntry,
  SNAPSHOT_EVERY_TICKS,
  type ShotInfo,
  TICK_DT,
  TICK_MS,
  WEAPON,
  type WeaponId,
  ZONE_HEAD,
  ZONE_LEGS,
  absorbArmor,
  applyCmd,
  clamp,
  createPlayerState,
  getMap,
  getMaps,
  giveWeapon,
  packState,
  rayHitbox,
  round,
  spawnState,
  weaponDef,
} from '@calindra-strike/shared';

const HISTORY = 64; // ~1s of positions for lag compensation
const MAX_QUEUE = 48;
const CMD_BURST = 24;
const MAX_CMDS_PER_TICK = 8;
const AIRDROP_FIRST_MS = 25_000;
const AIRDROP_EVERY_MS = 35_000;
const AIRDROP_MAX_ACTIVE = 2;

interface HistoryEntry {
  time: number;
  x: number;
  y: number;
  z: number;
  ducked: boolean;
  hittable: boolean;
}

export interface ServerPlayer {
  id: number;
  name: string;
  color: number;
  primaryChoice: WeaponId;
  state: PlayerState;
  alive: boolean;
  respawnAt: number;
  queue: Cmd[];
  lastSeq: number;
  tokens: number;
  kills: number;
  deaths: number;
  headshots: number;
  streak: number;
  bestStreak: number;
  joinedAt: number;
  ping: number;
  lastChat: number;
  history: HistoryEntry[];
  histHead: number;
  events: GameEvent[];
  send: (data: string) => void;
}

interface Airdrop {
  id: number;
  x: number;
  z: number;
  y: number;
  landY: number;
  w: WeaponId;
  landed: boolean;
}

export interface GameOptions {
  maxPlayers: number;
  matchMs: number;
  podiumMs: number;
  warmupMinPlayers: number;
  random?: () => number;
}

export class Game {
  tick = 0;
  readonly players = new Map<number, ServerPlayer>();
  private nextId = 1;
  mapIndex = 0;
  map: MapDef;
  world: CollisionWorld;
  phase: MatchPhase = 'warmup';
  phaseEnds = 0;
  private airdrops: Airdrop[] = [];
  private nextAirdropAt = 0;
  private airdropSeq = 1;
  private globalEvents: { ev: GameEvent; except: number }[] = [];
  private scoreDirty = true;
  private lastScoreSent = -Infinity;
  private results: ResultRow[] = [];
  private readonly random: () => number;
  private readonly worlds: CollisionWorld[];

  constructor(private readonly opts: GameOptions) {
    this.random = opts.random ?? Math.random;
    this.worlds = getMaps().map((m) => new CollisionWorld(m));
    this.map = getMap(0);
    this.world = this.worlds[0];
  }

  now(): number {
    return Math.round(this.tick * TICK_MS);
  }

  // ------------------------------------------------------------ lifecycle

  join(name: string, color: number, primary: WeaponId, send: (data: string) => void): ServerPlayer | string {
    if (this.players.size >= this.opts.maxPlayers) return 'Servidor cheio';
    const id = this.nextId++;
    const p: ServerPlayer = {
      id,
      name: this.uniqueName(name || `Jogador ${id}`),
      color: clamp(color, 0, PLAYER_COLORS.length - 1),
      primaryChoice: primary,
      state: createPlayerState(),
      alive: false,
      respawnAt: 0,
      queue: [],
      lastSeq: -1,
      tokens: CMD_BURST,
      kills: 0,
      deaths: 0,
      headshots: 0,
      streak: 0,
      bestStreak: 0,
      joinedAt: this.tick,
      ping: 0,
      lastChat: -Infinity,
      history: [],
      histHead: 0,
      events: [],
      send,
    };
    this.players.set(id, p);
    p.send(
      JSON.stringify({
        t: 'welcome',
        id,
        time: this.now(),
        roster: this.roster(),
        match: this.matchInfo(),
        maxPlayers: this.opts.maxPlayers,
      }),
    );
    this.broadcastRoster();
    this.emit({ k: 'join', id });
    this.scoreDirty = true;
    if (this.phase !== 'podium') this.spawn(p);
    if (this.phase === 'warmup' && this.players.size >= this.opts.warmupMinPlayers) this.startMatch();
    return p;
  }

  leave(id: number): void {
    if (!this.players.delete(id)) return;
    this.emit({ k: 'leave', id });
    this.broadcastRoster();
    this.scoreDirty = true;
    if (this.players.size === 0) this.resetToWarmup();
  }

  input(p: ServerPlayer, cmds: Cmd[]): void {
    for (const c of cmds) {
      if (c.seq <= p.lastSeq) continue;
      const tail = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
      if (c.seq <= tail) continue;
      p.queue.push(c);
    }
    if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE);
  }

  setLoadout(p: ServerPlayer, primary: WeaponId): void {
    p.primaryChoice = primary;
  }

  chat(p: ServerPlayer, text: string): void {
    if (!text || this.tick - p.lastChat < 60 * 1.2) return;
    p.lastChat = this.tick;
    const msg = JSON.stringify({ t: 'chat', id: p.id, text });
    for (const q of this.players.values()) q.send(msg);
  }

  private uniqueName(base: string): string {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; i < 100; i++) {
      const n = `${base.slice(0, 13)}#${i}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
    return `${base.slice(0, 10)}#${Math.floor(this.random() * 9999)}`;
  }

  // ------------------------------------------------------------ match flow

  private matchInfo(): MatchInfo {
    return {
      phase: this.phase,
      map: this.mapIndex,
      endsAt: this.phaseEnds,
      results: this.phase === 'podium' ? this.results : undefined,
    };
  }

  private broadcastMatch(): void {
    const msg = JSON.stringify({ t: 'match', match: this.matchInfo() });
    for (const p of this.players.values()) p.send(msg);
  }

  private resetScores(): void {
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.headshots = 0;
      p.streak = 0;
      p.bestStreak = 0;
    }
    this.scoreDirty = true;
  }

  startMatch(): void {
    this.phase = 'live';
    this.phaseEnds = this.now() + this.opts.matchMs;
    this.airdrops = [];
    this.nextAirdropAt = this.now() + AIRDROP_FIRST_MS;
    this.resetScores();
    for (const p of this.players.values()) this.spawn(p);
    this.broadcastMatch();
  }

  private endMatch(): void {
    this.phase = 'podium';
    this.phaseEnds = this.now() + this.opts.podiumMs;
    this.results = [...this.players.values()]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.headshots - a.headshots || a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        kills: p.kills,
        deaths: p.deaths,
        hs: p.headshots,
        best: p.bestStreak,
      }));
    for (const p of this.players.values()) {
      p.alive = false;
      p.queue.length = 0;
    }
    this.airdrops = [];
    this.broadcastMatch();
  }

  private nextMap(): void {
    this.mapIndex = (this.mapIndex + 1) % this.worlds.length;
    this.map = getMap(this.mapIndex);
    this.world = this.worlds[this.mapIndex];
    for (const p of this.players.values()) this.clearHistory(p);
    if (this.players.size >= this.opts.warmupMinPlayers) this.startMatch();
    else {
      this.phase = 'warmup';
      this.phaseEnds = 0;
      this.resetScores();
      for (const p of this.players.values()) this.spawn(p);
      this.broadcastMatch();
    }
  }

  private resetToWarmup(): void {
    this.phase = 'warmup';
    this.phaseEnds = 0;
    this.airdrops = [];
    this.results = [];
  }

  // ------------------------------------------------------------ spawning

  private spawn(p: ServerPlayer): void {
    const a = this.map.dropArea;
    let best = { x: 0, z: 0, score: -1 };
    for (let i = 0; i < 12; i++) {
      const x = a.minX + this.random() * (a.maxX - a.minX);
      const z = a.minZ + this.random() * (a.maxZ - a.minZ);
      let nearest = 1e9;
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        nearest = Math.min(nearest, Math.hypot(q.state.x - x, q.state.z - z));
      }
      if (nearest > best.score) best = { x, z, score: nearest };
    }
    const yaw = Math.atan2(best.x, best.z);
    spawnState(p.state, best.x, this.map.dropHeight, best.z, yaw, p.primaryChoice);
    p.alive = true;
    this.clearHistory(p);
  }

  private clearHistory(p: ServerPlayer): void {
    p.history.length = 0;
    p.histHead = 0;
  }

  // ------------------------------------------------------------ combat

  private historyAt(p: ServerPlayer, time: number): HistoryEntry | null {
    const h = p.history;
    if (h.length === 0) return null;
    // entries are stored in a ring; build ordered view lazily (small)
    const n = h.length;
    const start = n < HISTORY ? 0 : p.histHead;
    let prev: HistoryEntry | null = null;
    for (let i = 0; i < n; i++) {
      const e = h[(start + i) % n];
      if (e.time >= time) {
        if (!prev) return e;
        const t = (time - prev.time) / Math.max(1, e.time - prev.time);
        return {
          time,
          x: prev.x + (e.x - prev.x) * t,
          y: prev.y + (e.y - prev.y) * t,
          z: prev.z + (e.z - prev.z) * t,
          ducked: t < 0.5 ? prev.ducked : e.ducked,
          hittable: prev.hittable && e.hittable,
        };
      }
      prev = e;
    }
    return prev;
  }

  private recordHistory(): void {
    const time = this.now();
    for (const p of this.players.values()) {
      const s = p.state;
      const e: HistoryEntry = {
        time,
        x: s.x,
        y: s.y,
        z: s.z,
        ducked: s.ducked,
        hittable: p.alive && !s.dropping && s.protect === 0,
      };
      if (p.history.length < HISTORY) p.history.push(e);
      else {
        p.history[p.histHead] = e;
        p.histHead = (p.histHead + 1) % HISTORY;
      }
    }
  }

  private handleShot(p: ServerPlayer, shot: ShotInfo, interp: number): void {
    const def = weaponDef(shot.weapon);
    const now = this.now();
    const t = clamp(interp, now - LAGCOMP_MAX_MS, now);
    const targets: { q: ServerPlayer; x: number; y: number; z: number; ducked: boolean }[] = [];
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.state.dropping || q.state.protect > 0) continue;
      const h = this.historyAt(q, t);
      if (h && !h.hittable) continue;
      targets.push(h ? { q, x: h.x, y: h.y, z: h.z, ducked: h.ducked } : { q, x: q.state.x, y: q.state.y, z: q.state.z, ducked: q.state.ducked });
    }

    const damageBy = new Map<ServerPlayer, { dmg: number; head: boolean; zone: number }>();
    const ends: number[] = [];
    const { ox, oy, oz } = shot;
    for (let i = 0; i < shot.dirs.length; i += 3) {
      const dx = shot.dirs[i];
      const dy = shot.dirs[i + 1];
      const dz = shot.dirs[i + 2];
      const wall = this.world.trace(ox, oy, oz, dx, dy, dz, def.range);
      const limit = wall ? wall.t : def.range;
      let best: { t: number; zone: number; q: ServerPlayer } | null = null;
      for (const tg of targets) {
        const hit = rayHitbox(ox, oy, oz, dx, dy, dz, tg.x, tg.y, tg.z, tg.ducked, limit);
        if (hit && (!best || hit.t < best.t)) best = { ...hit, q: tg.q };
      }
      const dist = best ? best.t : limit;
      ends.push(round(ox + dx * dist, 10), round(oy + dy * dist, 10), round(oz + dz * dist, 10));
      if (best) {
        const zoneMult = best.zone === ZONE_HEAD ? def.headMult : best.zone === ZONE_LEGS ? 0.75 : 1;
        const base = shot.heavy && def.heavy ? def.heavy.damage : def.damage;
        const dmg = base * zoneMult * def.rangeMod ** (dist / 500);
        const acc = damageBy.get(best.q) ?? { dmg: 0, head: false, zone: best.zone };
        acc.dmg += dmg;
        if (best.zone === ZONE_HEAD) acc.head = true;
        acc.zone = Math.min(acc.zone, best.zone);
        damageBy.set(best.q, acc);
      }
    }
    this.emit({ k: 'shot', id: p.id, w: shot.weapon, o: [round(ox, 10), round(oy, 10), round(oz, 10)], e: ends, h: shot.heavy ? 1 : 0 }, p.id);
    for (const [victim, acc] of damageBy) this.damage(victim, p, acc.dmg, acc.head, acc.zone, shot.weapon);
  }

  private damage(victim: ServerPlayer, attacker: ServerPlayer, dmg: number, head: boolean, zone: number, weapon: WeaponId): void {
    if (!victim.alive) return;
    const def = weaponDef(weapon);
    const s = victim.state;
    const { hp, armorLoss } = absorbArmor(dmg, s.armor, def.armorPen);
    s.armor = Math.max(0, s.armor - armorLoss);
    s.health -= hp;
    const from = [round(attacker.state.x, 1), round(attacker.state.y, 1), round(attacker.state.z, 1)];
    const ev: GameEvent = { k: 'hit', by: attacker.id, to: victim.id, dmg: Math.round(hp), zone, hp: Math.max(0, Math.ceil(s.health)), from };
    attacker.events.push(ev);
    if (victim !== attacker) victim.events.push(ev);
    if (s.health <= 0) this.kill(victim, attacker, weapon, head);
  }

  private kill(victim: ServerPlayer, killer: ServerPlayer, weapon: WeaponId, head: boolean): void {
    victim.alive = false;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = this.tick + RESPAWN_TICKS;
    victim.state.health = 0;
    victim.queue.length = 0;
    killer.kills++;
    killer.streak++;
    killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
    if (head) killer.headshots++;
    this.emit({ k: 'kill', by: killer.id, to: victim.id, w: weapon, hs: head ? 1 : 0, streak: killer.streak });
    this.scoreDirty = true;
  }

  // ------------------------------------------------------------ airdrops

  private spawnAirdrop(): void {
    const pts = this.map.airdropPoints.filter((pt) => !this.airdrops.some((d) => Math.hypot(d.x - pt.x, d.z - pt.z) < 200));
    if (pts.length === 0) return;
    const pt = pts[Math.floor(this.random() * pts.length)];
    const startY = this.map.dropHeight + 250;
    const landY = Math.max(0, this.world.groundBelow(pt.x, startY, pt.z, AIRDROP_HALF));
    const w = LEGENDARIES[Math.floor(this.random() * LEGENDARIES.length)];
    const d: Airdrop = { id: this.airdropSeq++, x: pt.x, z: pt.z, y: startY, landY, w, landed: false };
    this.airdrops.push(d);
    this.emit({ k: 'drop', id: d.id, x: d.x, z: d.z, w });
  }

  private updateAirdrops(): void {
    const now = this.now();
    if (this.phase === 'live' && now >= this.nextAirdropAt) {
      this.nextAirdropAt = now + AIRDROP_EVERY_MS;
      if (this.airdrops.length < AIRDROP_MAX_ACTIVE) this.spawnAirdrop();
    }
    for (const d of this.airdrops) {
      if (!d.landed) {
        d.y -= AIRDROP_FALL_SPEED * TICK_DT;
        if (d.y <= d.landY) {
          d.y = d.landY;
          d.landed = true;
        }
      }
    }
    for (let i = this.airdrops.length - 1; i >= 0; i--) {
      const d = this.airdrops[i];
      for (const p of this.players.values()) {
        if (!p.alive || p.state.dropping) continue;
        const s = p.state;
        // claim from the ground next to it, or by standing on top
        const near = Math.hypot(s.x - d.x, s.z - d.z) < AIRDROP_PICKUP_RADIUS;
        const vertical = s.y > d.y - 60 && s.y < d.y + AIRDROP_HALF * 2 + 8;
        if (near && vertical && (d.landed || s.y >= d.y)) {
          giveWeapon(s, d.w);
          s.armor = MAX_ARMOR;
          s.health = MAX_HEALTH;
          this.emit({ k: 'loot', id: p.id, drop: d.id, w: d.w });
          this.airdrops.splice(i, 1);
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------ main tick

  update(): void {
    this.tick++;
    const now = this.now();

    // phase transitions
    if (this.phase === 'live' && now >= this.phaseEnds) this.endMatch();
    else if (this.phase === 'podium' && now >= this.phaseEnds) this.nextMap();

    // commands
    for (const p of this.players.values()) {
      p.tokens = Math.min(CMD_BURST, p.tokens + 1);
      let n = 0;
      while (p.queue.length > 0 && p.tokens >= 1 && n < MAX_CMDS_PER_TICK) {
        const cmd = p.queue.shift() as Cmd;
        p.tokens -= 1;
        n++;
        p.lastSeq = cmd.seq;
        if (p.alive && this.phase !== 'podium') {
          const shot = applyCmd(this.world, p.state, cmd, p.id);
          if (shot) this.handleShot(p, shot, cmd.interp);
          this.keepInBounds(p);
        } else {
          p.state.yaw = cmd.yaw;
          p.state.pitch = cmd.pitch;
        }
      }
    }

    // respawns
    if (this.phase !== 'podium') {
      for (const p of this.players.values()) {
        if (!p.alive && this.tick >= p.respawnAt) this.spawn(p);
      }
      this.updateAirdrops();
    }

    this.recordHistory();
    this.flushEvents();
    if (this.tick % SNAPSHOT_EVERY_TICKS === 0) this.sendSnapshots();
    if (this.scoreDirty ? now - this.lastScoreSent > 250 : now - this.lastScoreSent > 2000) this.sendScores();
  }

  /** Safety net: anyone who escapes the playable volume is put back in the sky. */
  private keepInBounds(p: ServerPlayer): void {
    const s = p.state;
    const b = this.map.bounds;
    if (s.y < -200 || s.x < b.minX - 64 || s.x > b.maxX + 64 || s.z < b.minZ - 64 || s.z > b.maxZ + 64) this.spawn(p);
  }

  // ------------------------------------------------------------ networking

  private emit(ev: GameEvent, except = -1): void {
    this.globalEvents.push({ ev, except });
  }

  private flushEvents(): void {
    const global = this.globalEvents;
    this.globalEvents = [];
    for (const p of this.players.values()) {
      const list: GameEvent[] = [];
      for (const g of global) if (g.except !== p.id) list.push(g.ev);
      if (p.events.length) {
        list.push(...p.events);
        p.events.length = 0;
      }
      if (list.length) p.send(JSON.stringify({ t: 'ev', e: list }));
    }
  }

  private sendSnapshots(): void {
    const ps: number[][] = [];
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      const s = p.state;
      const flags =
        (s.ducked ? RF_DUCK : 0) |
        (s.dropping ? RF_DROP : 0) |
        RF_ALIVE |
        (s.protect > 0 ? RF_PROTECT : 0) |
        (s.onGround ? RF_GROUND : 0) |
        (s.reload > 0 ? RF_RELOAD : 0) |
        (s.zoom > 0 ? RF_ZOOM : 0);
      ps.push([p.id, round(s.x, 10), round(s.y, 10), round(s.z, 10), round(s.yaw, 1000), round(s.pitch, 1000), flags, s.weapon]);
    }
    const ad = this.airdrops.map((d) => [d.id, d.x, round(d.y, 10), d.z, d.w, d.landed ? 1 : 0]);
    const shared = `,"ps":${JSON.stringify(ps)},"ad":${JSON.stringify(ad)}}`;
    const time = this.now();
    for (const p of this.players.values()) {
      const me = p.alive && this.phase !== 'podium' ? JSON.stringify(packState(p.state)) : 'null';
      p.send(`{"t":"snap","time":${time},"ack":${p.lastSeq},"me":${me}${shared}`);
    }
  }

  private sendScores(): void {
    this.scoreDirty = false;
    this.lastScoreSent = this.now();
    const s = [...this.players.values()].map((p) => [p.id, p.kills, p.deaths, p.ping, p.streak, p.headshots]);
    const msg = JSON.stringify({ t: 'score', s });
    for (const p of this.players.values()) p.send(msg);
  }

  private roster(): RosterEntry[] {
    return [...this.players.values()].map((p) => [p.id, p.name, p.color]);
  }

  private broadcastRoster(): void {
    const msg = JSON.stringify({ t: 'roster', roster: this.roster() });
    for (const p of this.players.values()) p.send(msg);
  }

  publicStatus(): Record<string, unknown> {
    const leaders = [...this.players.values()]
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 3)
      .map((p) => ({ name: p.name, kills: p.kills }));
    return {
      players: this.players.size,
      maxPlayers: this.opts.maxPlayers,
      map: this.map.name,
      phase: this.phase,
      endsInMs: this.phase === 'warmup' ? null : Math.max(0, this.phaseEnds - this.now()),
      leaders,
    };
  }
}

export { WEAPON };
