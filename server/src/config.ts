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
  trustProxy: boolean;
}

function int(name: string, def: number, lo: number, hi: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`Invalid ${name}: ${raw}`);
  return v;
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
    trustProxy: process.env.TRUST_PROXY === '1',
  };
}
