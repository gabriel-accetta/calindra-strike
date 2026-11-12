/**
 * World units follow the GoldSrc convention (1 unit ~ 1 inch) so movement
 * numbers read like a CS 1.6 server config.
 */
export const PROTOCOL_VERSION = 6;

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_EVERY_TICKS = 3; // 20 Hz snapshots
export const CMDS_PER_PACKET_MAX = 12;

// --- movement (sv_* style) ---
export const GRAVITY = 800;
export const MAX_SPEED = 250;
export const ACCELERATE = 5.5;
export const AIR_ACCELERATE = 12;
export const AIR_WISHSPEED_CAP = 30;
export const FRICTION = 4;
export const STOP_SPEED = 100;
export const JUMP_SPEED = 268.3; // sqrt(2 * 800 * 45) -> 45 unit jump
export const BUNNYJUMP_MAX_FACTOR = 1.2;
export const STEP_SIZE = 18;
export const MAX_VELOCITY = 2000;

export const DUCK_SPEED_MULT = 0.34;
export const WALK_SPEED_MULT = 0.52;

// --- player hull ---
export const PLAYER_RADIUS = 16;
export const STAND_HEIGHT = 72;
export const DUCK_HEIGHT = 36;
export const STAND_EYE = 64;
export const DUCK_EYE = 30;

// --- skydive spawn ---
export const DROP_FALL_SPEED = 560;
export const DROP_DIVE_SPEED = 980;
export const DROP_AIR_SPEED = 520;
export const DROP_ACCEL = 4;
export const SPAWN_PROTECT_TICKS = 90; // 1.5s after landing

// --- match ---
export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;
export const RESPAWN_TICKS = 3 * TICK_RATE;
export const LAGCOMP_MAX_MS = 250;
export const INTERP_DELAY_MS = 100;

export const AIRDROP_FALL_SPEED = 140;
export const AIRDROP_PICKUP_RADIUS = 44;
export const AIRDROP_HALF = 22;

export const NAME_MAX_LEN = 16;

/** Team Deathmatch sides. Lime vs blue stays distinguishable for red-green colour blindness. */
export const TEAMS = [
  { name: 'Bulldogs', color: '#9de82b' },
  { name: 'Martelos', color: '#4a9dff' },
] as const;

export const ZOOM_SENSITIVITY_RATIO = 1.2; // CS 1.6 default
export const CHAT_MAX_LEN = 100;

/** Player colours: vivid, readable against the arena palette. Lime is reserved for UI. */
export const PLAYER_COLORS = [
  '#ff5a4e',
  '#ff9f1c',
  '#ffd23f',
  '#3ec1ff',
  '#4f6bff',
  '#a46bff',
  '#ff5fc4',
  '#2ee6c5',
  '#f0f0f0',
  '#ff7a59',
  '#7ce0ff',
  '#c8ff8a',
] as const;

export const BTN = {
  FWD: 1,
  BACK: 2,
  LEFT: 4,
  RIGHT: 8,
  JUMP: 16,
  DUCK: 32,
  WALK: 64,
  ATTACK: 128,
  ATTACK2: 256,
  RELOAD: 512,
  USE: 1024,
} as const;
export const BTN_MASK = 2047;
