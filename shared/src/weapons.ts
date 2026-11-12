import { DEG, clamp } from './math.ts';

export const WEAPON = {
  HAMMER: 0,
  PISTOL: 1,
  RIFLE: 2,
  SMG: 3,
  SHOTGUN: 4,
  SNIPER: 5,
  LMG: 6,
} as const;
export type WeaponId = (typeof WEAPON)[keyof typeof WEAPON];
export const WEAPON_COUNT = 7;

export interface SpreadDef {
  base: number; // radians, standing still
  move: number; // added at full run speed
  air: number; // added while airborne
  duckMult: number;
  perShot: number; // added per consecutive shot (spray inaccuracy)
  perShotMax: number;
  scoped?: number; // replaces base while zoomed
}

export interface RecoilDef {
  climb: number; // degrees per shot at the start of a spray
  maxPitch: number; // degrees, asymptotic climb
  sway: number; // degrees of horizontal wander once the climb settles
  swayPeriod: number; // shots per full horizontal cycle
  swayStart: number; // shot index where the wander begins
  recovery: number; // recoil index recovered per second when not firing
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  tag: string; // short HUD label
  slot: 1 | 2 | 3;
  legendary: boolean;
  damage: number;
  pellets: number;
  headMult: number;
  rangeMod: number; // damage *= rangeMod ^ (distance / 500)
  range: number;
  armorPen: number; // CS "armor ratio": share of damage that goes through armor
  fireTicks: number;
  auto: boolean;
  mag: number;
  reserve: number;
  reloadTicks: number;
  deployTicks: number;
  speed: number;
  scopedSpeed: number;
  zoomFov: number[]; // vertical FOV per zoom level (degrees)
  spread: SpreadDef;
  recoil: RecoilDef;
  heavy?: { damage: number; ticks: number }; // melee alt attack
}

const W = (d: WeaponDef) => d;

export const WEAPONS: readonly WeaponDef[] = [
  W({
    id: WEAPON.HAMMER,
    name: 'Martelo do Eitri',
    tag: 'MARTELO',
    slot: 3,
    legendary: false,
    damage: 55,
    pellets: 1,
    headMult: 1.4,
    rangeMod: 1,
    range: 72,
    armorPen: 0.85,
    fireTicks: 27,
    auto: true,
    mag: 0,
    reserve: 0,
    reloadTicks: 0,
    deployTicks: 30,
    speed: 250,
    scopedSpeed: 250,
    zoomFov: [],
    spread: { base: 0, move: 0, air: 0, duckMult: 1, perShot: 0, perShotMax: 0 },
    recoil: { climb: 0, maxPitch: 0, sway: 0, swayPeriod: 1, swayStart: 99, recovery: 10 },
    heavy: { damage: 95, ticks: 60 },
  }),
  W({
    id: WEAPON.PISTOL,
    name: 'Faísca P9',
    tag: 'FAÍSCA',
    slot: 2,
    legendary: false,
    damage: 34,
    pellets: 1,
    headMult: 4,
    rangeMod: 0.79,
    range: 4096,
    armorPen: 0.5,
    fireTicks: 9,
    auto: false,
    mag: 12,
    reserve: 48,
    reloadTicks: 130,
    deployTicks: 40,
    speed: 250,
    scopedSpeed: 250,
    zoomFov: [],
    spread: { base: 0.006, move: 0.05, air: 0.18, duckMult: 0.8, perShot: 0.018, perShotMax: 0.06 },
    recoil: { climb: 1.4, maxPitch: 6, sway: 0.6, swayPeriod: 6, swayStart: 2, recovery: 7 },
  }),
  W({
    id: WEAPON.RIFLE,
    name: 'Forja R7',
    tag: 'R7',
    slot: 1,
    legendary: false,
    damage: 36,
    pellets: 1,
    headMult: 4,
    rangeMod: 0.98,
    range: 8192,
    armorPen: 0.775,
    fireTicks: 6,
    auto: true,
    mag: 30,
    reserve: 90,
    reloadTicks: 150,
    deployTicks: 60,
    speed: 221,
    scopedSpeed: 221,
    zoomFov: [],
    spread: { base: 0.0035, move: 0.11, air: 0.25, duckMult: 0.75, perShot: 0.004, perShotMax: 0.035 },
    recoil: { climb: 0.75, maxPitch: 7, sway: 1.6, swayPeriod: 14, swayStart: 7, recovery: 8 },
  }),
  W({
    id: WEAPON.SMG,
    name: 'Brokkr SMG',
    tag: 'BROKKR',
    slot: 1,
    legendary: false,
    damage: 26,
    pellets: 1,
    headMult: 4,
    rangeMod: 0.84,
    range: 4096,
    armorPen: 0.6,
    fireTicks: 5,
    auto: true,
    mag: 30,
    reserve: 120,
    reloadTicks: 125,
    deployTicks: 45,
    speed: 240,
    scopedSpeed: 240,
    zoomFov: [],
    spread: { base: 0.009, move: 0.04, air: 0.15, duckMult: 0.8, perShot: 0.002, perShotMax: 0.02 },
    recoil: { climb: 0.45, maxPitch: 4, sway: 1, swayPeriod: 10, swayStart: 5, recovery: 9 },
  }),
  W({
    id: WEAPON.SHOTGUN,
    name: 'Trovão 12',
    tag: 'TROVÃO',
    slot: 1,
    legendary: false,
    damage: 22,
    pellets: 9,
    headMult: 2,
    rangeMod: 0.6,
    range: 3000,
    armorPen: 0.5,
    fireTicks: 50,
    auto: false,
    mag: 7,
    reserve: 28,
    reloadTicks: 180,
    deployTicks: 50,
    speed: 230,
    scopedSpeed: 230,
    zoomFov: [],
    spread: { base: 0.065, move: 0.02, air: 0.06, duckMult: 0.9, perShot: 0, perShotMax: 0 },
    recoil: { climb: 3, maxPitch: 6, sway: 0, swayPeriod: 1, swayStart: 99, recovery: 3 },
  }),
  W({
    id: WEAPON.SNIPER,
    name: 'Mjölnir',
    tag: 'MJÖLNIR',
    slot: 1,
    legendary: true,
    damage: 120,
    pellets: 1,
    headMult: 4,
    rangeMod: 0.99,
    range: 8192,
    armorPen: 0.97,
    fireTicks: 88,
    auto: false,
    mag: 5,
    reserve: 15,
    reloadTicks: 175,
    deployTicks: 70,
    speed: 210,
    scopedSpeed: 150,
    zoomFov: [36, 14],
    spread: { base: 0.08, move: 0.12, air: 0.3, duckMult: 1, perShot: 0, perShotMax: 0, scoped: 0.0008 },
    recoil: { climb: 4, maxPitch: 4, sway: 0, swayPeriod: 1, swayStart: 99, recovery: 2 },
  }),
  W({
    id: WEAPON.LMG,
    name: 'Ragnarök',
    tag: 'RAGNARÖK',
    slot: 1,
    legendary: true,
    damage: 33,
    pellets: 1,
    headMult: 4,
    rangeMod: 0.97,
    range: 8192,
    armorPen: 0.8,
    fireTicks: 5,
    auto: true,
    mag: 100,
    reserve: 100,
    reloadTicks: 280,
    deployTicks: 75,
    speed: 215,
    scopedSpeed: 215,
    zoomFov: [],
    spread: { base: 0.012, move: 0.08, air: 0.25, duckMult: 0.7, perShot: 0.001, perShotMax: 0.02 },
    recoil: { climb: 0.5, maxPitch: 5, sway: 2.2, swayPeriod: 18, swayStart: 8, recovery: 7 },
  }),
];

export const PRIMARY_CHOICES: readonly WeaponId[] = [WEAPON.RIFLE, WEAPON.SMG, WEAPON.SHOTGUN];
export const LEGENDARIES: readonly WeaponId[] = [WEAPON.SNIPER, WEAPON.LMG];

export function weaponDef(id: number): WeaponDef {
  return WEAPONS[id] ?? WEAPONS[WEAPON.HAMMER];
}

export function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < WEAPON_COUNT;
}

/**
 * Recoil as a smooth, learnable pattern: a fast vertical climb that settles,
 * then a slow horizontal wander, like a CS spray. Returns [pitch, yaw] in radians.
 */
export function recoilOffset(def: WeaponDef, index: number): [number, number] {
  if (index <= 0 || def.recoil.climb === 0) return [0, 0];
  const r = def.recoil;
  const pitch = r.maxPitch * (1 - Math.exp((-index * r.climb) / r.maxPitch));
  let yaw = 0;
  if (index > r.swayStart && r.sway > 0) {
    const k = index - r.swayStart;
    const ramp = clamp(k / 3, 0, 1);
    yaw = r.sway * ramp * Math.sin((k / r.swayPeriod) * Math.PI * 2);
  }
  return [pitch * DEG, yaw * DEG];
}

/** CS-style armour absorption. Returns health damage and armour consumed. */
export function absorbArmor(damage: number, armor: number, armorPen: number): { hp: number; armorLoss: number } {
  if (armor <= 0) return { hp: damage, armorLoss: 0 };
  let hp = damage * armorPen;
  let armorLoss = (damage - hp) * 0.5;
  if (armorLoss > armor) {
    armorLoss = armor;
    hp = damage - armor * 2;
  }
  return { hp, armorLoss };
}
