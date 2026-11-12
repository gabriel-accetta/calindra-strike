import { BTN_MASK, CHAT_MAX_LEN, CMDS_PER_PACKET_MAX, NAME_MAX_LEN, PLAYER_COLORS } from './constants.ts';
import type { Cmd, PlayerState } from './sim.ts';
import { PRIMARY_CHOICES, WEAPON_COUNT, type WeaponId } from './weapons.ts';

export const MAX_MESSAGE_BYTES = 4096;

// ------------------------------------------------------------ client -> server

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; color: number; primary: WeaponId; code: string; token: string }
  | { t: 'in'; c: Cmd[] }
  | { t: 'loadout'; primary: WeaponId }
  | { t: 'ping'; c: number }
  | { t: 'chat'; text: string }
  | { t: 'team'; team: number }
  | { t: 'vote'; option: number };

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isNum = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isPrimary = (v: unknown): v is WeaponId => typeof v === 'number' && (PRIMARY_CHOICES as readonly number[]).includes(v);

/**
 * Strict parser for everything a browser can send. Anything unexpected returns
 * null and the server drops (and eventually disconnects) the sender.
 */
export function parseClientMessage(raw: string): ClientMsg | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'in': {
      const c = o.c;
      if (!Array.isArray(c) || c.length < 1 || c.length > CMDS_PER_PACKET_MAX) return null;
      const cmds: Cmd[] = [];
      for (const e of c) {
        if (!Array.isArray(e) || e.length !== 6) return null;
        const [seq, buttons, yaw, pitch, weapon, interp] = e;
        if (!isInt(seq, 0, 2 ** 31) || !isInt(buttons, 0, BTN_MASK) || !isNum(yaw, -10, 10) || !isNum(pitch, -2, 2)) return null;
        if (!isInt(weapon, 0, 4) || !isNum(interp, 0, 1e13)) return null;
        cmds.push({ seq, buttons, yaw, pitch, weapon, interp });
      }
      return { t: 'in', c: cmds };
    }
    case 'ping':
      return isNum(o.c, 0, 1e13) ? { t: 'ping', c: o.c } : null;
    case 'hello': {
      if (!isInt(o.v, 0, 1000) || !isStr(o.name, 64) || !isInt(o.color, 0, PLAYER_COLORS.length - 1)) return null;
      if (!isPrimary(o.primary)) return null;
      const code = o.code === undefined ? '' : o.code;
      if (!isStr(code, 64)) return null;
      const token = o.token === undefined ? '' : o.token;
      if (!isStr(token, 64) || !/^[0-9a-f]*$/.test(token)) return null;
      return { t: 'hello', v: o.v, name: o.name, color: o.color, primary: o.primary, code, token };
    }
    case 'loadout':
      return isPrimary(o.primary) ? { t: 'loadout', primary: o.primary } : null;
    case 'chat':
      return isStr(o.text, 400) && o.text.length > 0 ? { t: 'chat', text: o.text } : null;
    case 'team':
      return isInt(o.team, 0, 1) ? { t: 'team', team: o.team } : null;
    case 'vote':
      return isInt(o.option, 0, 7) ? { t: 'vote', option: o.option } : null;
    default:
      return null;
  }
}

function cleanText(raw: string, max: number, allow: RegExp): string {
  return raw
    .normalize('NFKC')
    .replace(/[\p{C}\p{M}\p{Zl}\p{Zp}]/gu, '')
    .replace(allow, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** Allow-list: letters, numbers, spaces and a little punctuation. No control, bidi or combining chars. */
export function sanitizeName(raw: string): string {
  return cleanText(raw, NAME_MAX_LEN, /[^\p{L}\p{N} _\-.!?#*+]/gu);
}

export function sanitizeChat(raw: string): string {
  return cleanText(raw, CHAT_MAX_LEN, /[^\p{L}\p{N}\p{P}\p{S} ]/gu);
}

export function encodeCmd(c: Cmd): number[] {
  return [c.seq, c.buttons, round(c.yaw, 1e4), round(c.pitch, 1e4), c.weapon, Math.round(c.interp)];
}

// ------------------------------------------------------------ server -> client

export type MatchPhase = 'warmup' | 'live' | 'podium';
export type GameMode = 'ffa' | 'tdm' | 'defuse';
export const GAME_MODES: readonly GameMode[] = ['tdm', 'ffa', 'defuse'];

export const MODE_LABEL: Record<GameMode, string> = {
  ffa: 'todos contra todos',
  tdm: 'team deathmatch',
  defuse: 'defuse bomb',
};

export interface ResultRow {
  id: number;
  name: string;
  color: number;
  kills: number;
  deaths: number;
  hs: number;
  best: number; // best streak
  team: number; // -1 in free-for-all
  bot: number; // 1 for server bots
}

/** Bomb defusal round state (mode 'defuse'). Team 0 attacks with the C4, team 1 defends. */
export interface BombState {
  round: number;
  phase: 'playing' | 'ended';
  carrier: number | null;
  position: { x: number; y: number; z: number } | null;
  planted: boolean;
  explodesAt: number;
  winner: number;
  reason: string;
  action: { id: number; kind: 'plant' | 'defuse'; startedAt: number; endsAt: number } | null;
}

export interface MatchInfo {
  bomb?: BombState;
  phase: MatchPhase;
  mode: GameMode;
  map: number;
  endsAt: number; // server time ms
  teams: number[]; // team scores [bulldogs, martelos] (TDM)
  limit: number; // TDM kill limit or defuse rounds to win, 0 = timer only
  results?: ResultRow[];
  winner?: number; // TDM: winning team, -1 draw
  next?: { map: number; mode: GameMode }; // podium: upcoming match if nobody votes
  vote?: VoteInfo; // podium: map vote for the next match
}

export interface VoteOption {
  map: number;
  mode: GameMode;
}

export interface VoteInfo {
  options: VoteOption[];
  counts: number[];
}

export type GameEvent =
  | { k: 'shot'; id: number; w: number; o: number[]; e: number[]; h: number }
  | { k: 'hit'; by: number; to: number; dmg: number; zone: number; hp: number; from: number[] }
  | { k: 'kill'; by: number; to: number; w: number; hs: number; streak: number }
  | { k: 'drop'; id: number; x: number; z: number; w: number }
  | { k: 'loot'; id: number; drop: number; w: number }
  | { k: 'join'; id: number }
  | { k: 'leave'; id: number }
  | { k: 'team'; id: number; team: number; auto: number };

export type ServerMsg =
  | { t: 'welcome'; id: number; time: number; roster: RosterEntry[]; match: MatchInfo; maxPlayers: number; token: string }
  | { t: 'reject'; reason: string; code?: string }
  | { t: 'votes'; counts: number[] }
  | { t: 'snap'; time: number; ack: number; me: number[] | null; ps: number[][]; ad: number[][]; bomb?: BombState | null; look?: number[] }
  | { t: 'ev'; e: GameEvent[] }
  | { t: 'roster'; roster: RosterEntry[] }
  | { t: 'score'; s: number[][]; ts: number[] }
  | { t: 'match'; match: MatchInfo }
  | { t: 'pong'; c: number; s: number }
  | { t: 'chat'; id: number; text: string };

export type RosterEntry = [id: number, name: string, color: number, team: number, bot: number];

export const round = (v: number, k: number): number => Math.round(v * k) / k;

// flags for the local player's packed state
const F_GROUND = 1;
const F_DUCK = 2;
const F_JUMP = 4;
const F_DROP = 8;
const F_ATK = 16;
const F_ATK2 = 32;

export function packState(s: PlayerState): number[] {
  const flags =
    (s.onGround ? F_GROUND : 0) |
    (s.ducked ? F_DUCK : 0) |
    (s.jumpHeld ? F_JUMP : 0) |
    (s.dropping ? F_DROP : 0) |
    (s.attackHeld ? F_ATK : 0) |
    (s.attack2Held ? F_ATK2 : 0);
  return [
    round(s.x, 1e3),
    round(s.y, 1e3),
    round(s.z, 1e3),
    round(s.vx, 1e3),
    round(s.vy, 1e3),
    round(s.vz, 1e3),
    flags,
    Math.ceil(s.health),
    Math.ceil(s.armor),
    s.weapon,
    s.lastWeapon,
    s.primary,
    s.tick,
    s.nextFire,
    s.reload,
    s.deploy,
    round(s.recoil, 1e4),
    s.lastFire,
    s.zoom,
    s.protect,
    s.resumeZoom,
    ...s.mag,
    ...s.reserve,
  ];
}

export const PACKED_STATE_LEN = 21 + WEAPON_COUNT * 2;

export function unpackState(a: number[], s: PlayerState): void {
  s.x = a[0];
  s.y = a[1];
  s.z = a[2];
  s.vx = a[3];
  s.vy = a[4];
  s.vz = a[5];
  const f = a[6];
  s.onGround = (f & F_GROUND) !== 0;
  s.ducked = (f & F_DUCK) !== 0;
  s.jumpHeld = (f & F_JUMP) !== 0;
  s.dropping = (f & F_DROP) !== 0;
  s.attackHeld = (f & F_ATK) !== 0;
  s.attack2Held = (f & F_ATK2) !== 0;
  s.health = a[7];
  s.armor = a[8];
  s.weapon = a[9] as WeaponId;
  s.lastWeapon = a[10] as WeaponId;
  s.primary = a[11] as WeaponId;
  s.tick = a[12];
  s.nextFire = a[13];
  s.reload = a[14];
  s.deploy = a[15];
  s.recoil = a[16];
  s.lastFire = a[17];
  s.zoom = a[18];
  s.protect = a[19];
  s.resumeZoom = a[20];
  for (let i = 0; i < WEAPON_COUNT; i++) {
    s.mag[i] = a[21 + i];
    s.reserve[i] = a[21 + WEAPON_COUNT + i];
  }
}

// remote player flags
export const RF_DUCK = 1;
export const RF_DROP = 2;
export const RF_ALIVE = 4;
export const RF_PROTECT = 8;
export const RF_GROUND = 16;
export const RF_RELOAD = 32;
export const RF_ZOOM = 64;
