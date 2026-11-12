import { type GameMode, getMaps } from '@calindra-strike/shared';

export interface Config {
  port: number;
  host: string;
  allowedOrigins: Set<string>;
  maxPlayers: number;
  maxPerIp: number;
  joinCode: string;
  matchMs: number;
  podiumMs: number;
  warmupMinPlayers: number;
  modes: GameMode[];
  maps: string[]; // empty = every map
  defuseRoundsToWin: number;
  tdmLimit: number;
  airdropFirstMs: number;
  botFill: number;
  botSkill: number;
  trustProxy: boolean;
}

function int(name: string, def: number, lo: number, hi: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`Invalid ${name}: ${raw}`);
  return v;
}

const ALL_MODES: GameMode[] = ['tdm', 'ffa', 'defuse'];

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * GAME_MODES picks any set of modes (e.g. "tdm,defuse"). The older single GAME_MODE
 * still works: "mixed" = TDM + FFA, or one mode. Default: every mode.
 */
export function modeList(modesRaw: string | undefined, legacyRaw: string | undefined): GameMode[] {
  const items = list(modesRaw);
  if (items.length === 0) {
    const legacy = (legacyRaw ?? '').trim().toLowerCase();
    if (!legacy) return [...ALL_MODES];
    if (legacy === 'mixed') return ['tdm', 'ffa'];
    items.push(legacy);
  }
  if (items.includes('all')) return [...ALL_MODES];
  for (const m of items) {
    if (!(ALL_MODES as string[]).includes(m)) throw new Error(`Invalid game mode: ${m} (use ${ALL_MODES.join(', ')})`);
  }
  return [...new Set(items)] as GameMode[];
}

export function mapList(raw: string | undefined): string[] {
  const items = list(raw);
  if (items.includes('all')) return [];
  const known = getMaps().map((m) => m.id);
  for (const id of items) if (!known.includes(id)) throw new Error(`Invalid map: ${id} (use ${known.join(', ')})`);
  return [...new Set(items)];
}

export function loadConfig(): Config {
  const origins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of origins) {
    const u = new URL(o);
    if (u.origin !== o) throw new Error(`ALLOWED_ORIGINS entries must be bare origins, got ${o}`);
  }
  return {
    port: int('PORT', 7350, 1, 65535),
    host: process.env.HOST ?? '127.0.0.1',
    allowedOrigins: new Set(origins),
    maxPlayers: int('MAX_PLAYERS', 24, 1, 64),
    maxPerIp: int('MAX_PER_IP', 32, 1, 128),
    joinCode: (process.env.JOIN_CODE ?? '').trim(),
    matchMs: int('MATCH_SECONDS', 300, 20, 3600) * 1000,
    podiumMs: int('PODIUM_SECONDS', 15, 3, 120) * 1000,
    warmupMinPlayers: int('WARMUP_MIN_PLAYERS', 2, 1, 64),
    modes: modeList(process.env.GAME_MODES, process.env.GAME_MODE),
    maps: mapList(process.env.GAME_MAPS),
    defuseRoundsToWin: int('DEFUSE_ROUNDS_TO_WIN', 8, 1, 30),
    tdmLimit: int('TDM_SCORE_LIMIT', 50, 0, 1000),
    airdropFirstMs: int('AIRDROP_FIRST_SECONDS', 25, 1, 600) * 1000,
    botFill: int('BOT_FILL', 0, 0, 64),
    botSkill: int('BOT_SKILL', 50, 0, 100) / 100,
    trustProxy: process.env.TRUST_PROXY === '1',
  };
}
