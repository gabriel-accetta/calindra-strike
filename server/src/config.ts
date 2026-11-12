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
  modes: 'mixed' | 'ffa' | 'tdm';
  tdmLimit: number;
  airdropFirstMs: number;
  trustProxy: boolean;
}

function int(name: string, def: number, lo: number, hi: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`Invalid ${name}: ${raw}`);
  return v;
}

function modeSetting(raw: string | undefined): 'mixed' | 'ffa' | 'tdm' {
  const v = (raw ?? 'mixed').trim().toLowerCase();
  if (v === 'mixed' || v === 'ffa' || v === 'tdm') return v;
  throw new Error(`Invalid GAME_MODE: ${raw} (use mixed, ffa or tdm)`);
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
    modes: modeSetting(process.env.GAME_MODE),
    tdmLimit: int('TDM_SCORE_LIMIT', 50, 0, 1000),
    airdropFirstMs: int('AIRDROP_FIRST_SECONDS', 25, 1, 600) * 1000,
    trustProxy: process.env.TRUST_PROXY === '1',
  };
}
