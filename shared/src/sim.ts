import {
  ACCELERATE,
  AIR_ACCELERATE,
  AIR_WISHSPEED_CAP,
  BTN,
  BUNNYJUMP_MAX_FACTOR,
  DROP_ACCEL,
  DROP_AIR_SPEED,
  DROP_DIVE_SPEED,
  DROP_FALL_SPEED,
  DUCK_EYE,
  DUCK_HEIGHT,
  DUCK_SPEED_MULT,
  FRICTION,
  GRAVITY,
  JUMP_SPEED,
  MAX_HEALTH,
  MAX_VELOCITY,
  SPAWN_PROTECT_TICKS,
  STAND_EYE,
  STAND_HEIGHT,
  STEP_SIZE,
  STOP_SPEED,
  TICK_DT,
  WALK_SPEED_MULT,
} from './constants.ts';
import { DEG, clamp, dirFromAngles, hashSeed, mulberry32, rayAabb, wrapAngle } from './math.ts';
import type { CollisionWorld } from './physics.ts';
import { WEAPON, WEAPON_COUNT, type WeaponDef, type WeaponId, recoilOffset, weaponDef } from './weapons.ts';

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  ducked: boolean;
  jumpHeld: boolean;
  dropping: boolean;
  attackHeld: boolean;
  attack2Held: boolean;
  health: number;
  armor: number;
  weapon: WeaponId;
  lastWeapon: WeaponId;
  primary: WeaponId;
  mag: number[];
  reserve: number[];
  tick: number;
  nextFire: number;
  reload: number;
  deploy: number;
  recoil: number;
  lastFire: number;
  zoom: number;
  protect: number;
}

export interface Cmd {
  seq: number;
  buttons: number;
  yaw: number;
  pitch: number;
  weapon: number; // 0 none, 1 primary, 2 pistol, 3 hammer, 4 last used
  interp: number; // server-time (ms) the client was rendering, for lag compensation
}

export interface ShotInfo {
  weapon: WeaponId;
  heavy: boolean;
  ox: number;
  oy: number;
  oz: number;
  dirs: number[]; // flattened xyz per pellet
  tick: number;
}

export const MAX_PITCH = 89 * DEG;

export function createPlayerState(): PlayerState {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    onGround: false,
    ducked: false,
    jumpHeld: false,
    dropping: false,
    attackHeld: false,
    attack2Held: false,
    health: MAX_HEALTH,
    armor: 0,
    weapon: WEAPON.RIFLE,
    lastWeapon: WEAPON.PISTOL,
    primary: WEAPON.RIFLE,
    mag: new Array(WEAPON_COUNT).fill(0),
    reserve: new Array(WEAPON_COUNT).fill(0),
    tick: 0,
    nextFire: 0,
    reload: 0,
    deploy: 0,
    recoil: 0,
    lastFire: -1000,
    zoom: 0,
    protect: 0,
  };
}

export function cloneState(s: PlayerState): PlayerState {
  return { ...s, mag: s.mag.slice(), reserve: s.reserve.slice() };
}

export function copyState(dst: PlayerState, s: PlayerState): void {
  Object.assign(dst, s);
  dst.mag = s.mag.slice();
  dst.reserve = s.reserve.slice();
}

export const hullHeight = (s: { ducked: boolean }): number => (s.ducked ? DUCK_HEIGHT : STAND_HEIGHT);
export const eyeHeight = (s: { ducked: boolean }): number => (s.ducked ? DUCK_EYE : STAND_EYE);

function fillAmmo(s: PlayerState, id: WeaponId): void {
  const d = weaponDef(id);
  s.mag[id] = d.mag;
  s.reserve[id] = d.reserve;
}

/** Puts a freshly (re)spawned player in the sky above (x, z). */
export function spawnState(s: PlayerState, x: number, y: number, z: number, yaw: number, primary: WeaponId): void {
  s.x = x;
  s.y = y;
  s.z = z;
  s.vx = 0;
  s.vy = 0;
  s.vz = 0;
  s.yaw = yaw;
  s.pitch = -0.6;
  s.onGround = false;
  s.ducked = false;
  s.dropping = true;
  s.health = MAX_HEALTH;
  s.armor = 0;
  s.mag.fill(0);
  s.reserve.fill(0);
  s.primary = primary;
  fillAmmo(s, primary);
  fillAmmo(s, WEAPON.PISTOL);
  s.weapon = primary;
  s.lastWeapon = WEAPON.PISTOL;
  s.reload = 0;
  s.deploy = 0;
  s.recoil = 0;
  s.zoom = 0;
  s.nextFire = s.tick;
  s.protect = 0;
}

/** Airdrop reward: legendary primary with full ammo. */
export function giveWeapon(s: PlayerState, id: WeaponId): void {
  s.primary = id;
  fillAmmo(s, id);
  if (s.weapon !== id) s.lastWeapon = s.weapon;
  s.weapon = id;
  s.deploy = weaponDef(id).deployTicks;
  s.reload = 0;
  s.zoom = 0;
}

// ---------------------------------------------------------------- movement

function accelerate(s: PlayerState, wx: number, wz: number, wishspeed: number, accel: number, dt: number): void {
  const current = s.vx * wx + s.vz * wz;
  const add = wishspeed - current;
  if (add <= 0) return;
  let accelSpeed = accel * dt * wishspeed;
  if (accelSpeed > add) accelSpeed = add;
  s.vx += accelSpeed * wx;
  s.vz += accelSpeed * wz;
}

function airAccelerate(s: PlayerState, wx: number, wz: number, wishspeed: number, dt: number): void {
  const wishspd = Math.min(wishspeed, AIR_WISHSPEED_CAP);
  const current = s.vx * wx + s.vz * wz;
  const add = wishspd - current;
  if (add <= 0) return;
  let accelSpeed = AIR_ACCELERATE * wishspeed * dt;
  if (accelSpeed > add) accelSpeed = add;
  s.vx += accelSpeed * wx;
  s.vz += accelSpeed * wz;
}

function friction(s: PlayerState, dt: number): void {
  const speed = Math.hypot(s.vx, s.vz);
  if (speed < 0.1) {
    s.vx = 0;
    s.vz = 0;
    return;
  }
  const control = speed < STOP_SPEED ? STOP_SPEED : speed;
  const drop = control * FRICTION * dt;
  const ns = Math.max(speed - drop, 0) / speed;
  s.vx *= ns;
  s.vz *= ns;
}

function checkGround(w: CollisionWorld, s: PlayerState): boolean {
  if (s.vy > 1) return false;
  const r = 16;
  return w.overlaps(s.x - r, s.y - 0.25, s.z - r, s.x + r, s.y + 0.01, s.z + r);
}

/** Horizontal move with stair stepping (only used while grounded). Returns blocked flags. */
function walkMove(w: CollisionWorld, s: PlayerState, dt: number): void {
  const h = hullHeight(s);
  const dx = s.vx * dt;
  const dz = s.vz * dt;
  const sx = s.x;
  const sy = s.y;
  const sz = s.z;

  const mx = w.clipAxis(s.x, s.y, s.z, h, 0, dx);
  s.x += mx;
  const mz = w.clipAxis(s.x, s.y, s.z, h, 2, dz);
  s.z += mz;
  const bx = mx !== dx;
  const bz = mz !== dz;
  if (!bx && !bz) return;

  const px = s.x;
  const pz = s.z;

  // try stepping up and over
  let tx = sx;
  let ty = sy;
  let tz = sz;
  ty += w.clipAxis(tx, ty, tz, h, 1, STEP_SIZE);
  const smx = w.clipAxis(tx, ty, tz, h, 0, dx);
  tx += smx;
  const smz = w.clipAxis(tx, ty, tz, h, 2, dz);
  tz += smz;
  ty += w.clipAxis(tx, ty, tz, h, 1, -(ty - sy) - 0.5);

  const plain = (px - sx) ** 2 + (pz - sz) ** 2;
  const stepped = (tx - sx) ** 2 + (tz - sz) ** 2;
  if (stepped > plain + 1e-4 && ty >= sy - 0.25) {
    s.x = tx;
    s.y = ty;
    s.z = tz;
    if (smx !== dx) s.vx = 0;
    if (smz !== dz) s.vz = 0;
  } else {
    s.x = px;
    s.y = sy;
    s.z = pz;
    if (bx) s.vx = 0;
    if (bz) s.vz = 0;
  }
}

function airMove(w: CollisionWorld, s: PlayerState, dt: number): void {
  const h = hullHeight(s);
  const dx = s.vx * dt;
  const mx = w.clipAxis(s.x, s.y, s.z, h, 0, dx);
  s.x += mx;
  if (mx !== dx) s.vx = 0;
  const dz = s.vz * dt;
  const mz = w.clipAxis(s.x, s.y, s.z, h, 2, dz);
  s.z += mz;
  if (mz !== dz) s.vz = 0;
}

function verticalMove(w: CollisionWorld, s: PlayerState, dt: number): void {
  const dy = s.vy * dt;
  const my = w.clipAxis(s.x, s.y, s.z, hullHeight(s), 1, dy);
  s.y += my;
  if (my !== dy) s.vy = 0;
}

function wishDir(s: PlayerState, buttons: number): [number, number, boolean] {
  const f = (buttons & BTN.FWD ? 1 : 0) - (buttons & BTN.BACK ? 1 : 0);
  const r = (buttons & BTN.RIGHT ? 1 : 0) - (buttons & BTN.LEFT ? 1 : 0);
  if (f === 0 && r === 0) return [0, 0, false];
  const sy = Math.sin(s.yaw);
  const cy = Math.cos(s.yaw);
  // forward = (-sin, -cos), right = (cos, -sin)
  let wx = -sy * f + cy * r;
  let wz = -cy * f - sy * r;
  const len = Math.hypot(wx, wz);
  wx /= len;
  wz /= len;
  return [wx, wz, true];
}

export function maxSpeedFor(s: PlayerState): number {
  const d = weaponDef(s.weapon);
  return s.zoom > 0 ? d.scopedSpeed : d.speed;
}

function skydive(w: CollisionWorld, s: PlayerState, buttons: number, dt: number): void {
  const [wx, wz, moving] = wishDir(s, buttons);
  if (moving) accelerate(s, wx, wz, DROP_AIR_SPEED, DROP_ACCEL, dt);
  else {
    const k = Math.max(0, 1 - 1.5 * dt);
    s.vx *= k;
    s.vz *= k;
  }
  const hs = Math.hypot(s.vx, s.vz);
  if (hs > DROP_AIR_SPEED) {
    s.vx *= DROP_AIR_SPEED / hs;
    s.vz *= DROP_AIR_SPEED / hs;
  }
  const cap = buttons & BTN.DUCK ? DROP_DIVE_SPEED : DROP_FALL_SPEED;
  s.vy -= GRAVITY * dt;
  if (s.vy < -cap) s.vy += (-cap - s.vy) * Math.min(1, 5 * dt);
  airMove(w, s, dt);
  const before = s.vy;
  verticalMove(w, s, dt);
  if (before < 0 && s.vy === 0) {
    // touched down
    s.dropping = false;
    s.onGround = true;
    s.vx *= 0.35;
    s.vz *= 0.35;
    s.protect = SPAWN_PROTECT_TICKS;
  }
}

export function playerMove(w: CollisionWorld, s: PlayerState, buttons: number, dt: number): void {
  if (s.dropping) {
    skydive(w, s, buttons, dt);
    return;
  }

  // --- duck / unduck (GoldSrc: ducking in the air tucks the legs up) ---
  const wantDuck = (buttons & BTN.DUCK) !== 0;
  const tuck = (STAND_HEIGHT - DUCK_HEIGHT) / 2;
  if (wantDuck && !s.ducked) {
    s.ducked = true;
    if (!s.onGround) s.y += tuck;
  } else if (!wantDuck && s.ducked) {
    if (s.onGround) {
      if (!w.hullOverlaps(s.x, s.y, s.z, STAND_HEIGHT)) s.ducked = false;
    } else if (!w.hullOverlaps(s.x, s.y - tuck, s.z, STAND_HEIGHT)) {
      s.y -= tuck;
      s.ducked = false;
    } else if (!w.hullOverlaps(s.x, s.y, s.z, STAND_HEIGHT)) {
      s.ducked = false;
    }
  }

  // --- jump (must re-press; CS 1.6 bunnyhop speed cap) ---
  let jumped = false;
  if (buttons & BTN.JUMP) {
    if (s.onGround && !s.jumpHeld) {
      const maxs = maxSpeedFor(s);
      const spd = Math.hypot(s.vx, s.vz);
      const cap = BUNNYJUMP_MAX_FACTOR * maxs;
      if (spd > cap) {
        const f = (cap / spd) * 0.65;
        s.vx *= f;
        s.vz *= f;
      }
      s.vy = JUMP_SPEED;
      s.onGround = false;
      jumped = true;
    }
    s.jumpHeld = true;
  } else s.jumpHeld = false;

  const [wx, wz, moving] = wishDir(s, buttons);
  let wishspeed = moving ? maxSpeedFor(s) : 0;
  if (buttons & BTN.WALK) wishspeed *= WALK_SPEED_MULT;
  if (s.ducked && (s.onGround || jumped)) wishspeed *= DUCK_SPEED_MULT;

  const wasOnGround = s.onGround;
  if (s.onGround) {
    friction(s, dt);
    if (moving) accelerate(s, wx, wz, wishspeed, ACCELERATE, dt);
    s.vy = 0;
  } else {
    if (moving) airAccelerate(s, wx, wz, wishspeed, dt);
    s.vy -= GRAVITY * dt;
  }

  // clamp
  const hs = Math.hypot(s.vx, s.vz);
  if (hs > MAX_VELOCITY) {
    s.vx *= MAX_VELOCITY / hs;
    s.vz *= MAX_VELOCITY / hs;
  }
  s.vy = clamp(s.vy, -MAX_VELOCITY, MAX_VELOCITY);

  if (s.onGround) walkMove(w, s, dt);
  else airMove(w, s, dt);
  verticalMove(w, s, dt);

  s.onGround = checkGround(w, s);
  if (s.onGround && s.vy < 0) s.vy = 0;

  // stick to the floor when walking down stairs
  if (wasOnGround && !s.onGround && !jumped && s.vy <= 0) {
    const h = hullHeight(s);
    const d = w.clipAxis(s.x, s.y, s.z, h, 1, -STEP_SIZE);
    if (d > -STEP_SIZE + 0.001) {
      s.y += d;
      s.onGround = true;
      s.vy = 0;
    }
  }
}

// ---------------------------------------------------------------- weapons

export function computeSpread(s: PlayerState, def: WeaponDef = weaponDef(s.weapon)): number {
  const sp = def.spread;
  const base = s.zoom > 0 && sp.scoped !== undefined ? sp.scoped : sp.base;
  const maxs = maxSpeedFor(s);
  const speed = Math.hypot(s.vx, s.vz);
  const moveFrac = clamp((speed - maxs * 0.34) / (maxs * 0.66), 0, 1);
  let spread = base + sp.move * moveFrac + (s.onGround ? 0 : sp.air) + Math.min(sp.perShot * s.recoil, sp.perShotMax);
  if (s.ducked && s.onGround) spread *= sp.duckMult;
  return spread;
}

function startReload(s: PlayerState, def: WeaponDef): void {
  if (def.mag <= 0 || s.reload > 0) return;
  if (s.mag[def.id] >= def.mag || s.reserve[def.id] <= 0) return;
  s.reload = def.reloadTicks;
  s.zoom = 0;
}

function finishReload(s: PlayerState, def: WeaponDef): void {
  const need = def.mag - s.mag[def.id];
  const take = Math.min(need, s.reserve[def.id]);
  s.mag[def.id] += take;
  s.reserve[def.id] -= take;
}

function slotWeapon(s: PlayerState, req: number): WeaponId | -1 {
  switch (req) {
    case 1:
      return s.primary;
    case 2:
      return WEAPON.PISTOL;
    case 3:
      return WEAPON.HAMMER;
    case 4:
      return s.lastWeapon;
    default:
      return -1;
  }
}

function switchWeapon(s: PlayerState, req: number): void {
  const target = slotWeapon(s, req);
  if (target === -1 || target === s.weapon) return;
  if (target !== WEAPON.HAMMER && target !== WEAPON.PISTOL && target !== s.primary) return;
  s.lastWeapon = s.weapon;
  s.weapon = target;
  s.deploy = weaponDef(target).deployTicks;
  s.reload = 0;
  s.zoom = 0;
}

function fire(s: PlayerState, def: WeaponDef, seedBase: number, heavy: boolean): ShotInfo {
  const eye = eyeHeight(s);
  const [rp, ry] = recoilOffset(def, s.recoil);
  const spread = def.slot === 3 ? 0 : computeSpread(s, def);
  const yaw = s.yaw + ry;
  const pitch = clamp(s.pitch + rp, -MAX_PITCH, MAX_PITCH);
  const f = dirFromAngles(yaw, pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const rx = cy;
  const rz = -sy;
  const ux = sy * sp;
  const uy = cp;
  const uz = cy * sp;
  const rng = mulberry32(hashSeed(seedBase, s.tick));
  const dirs: number[] = [];
  for (let i = 0; i < def.pellets; i++) {
    const a = (rng() + rng() - 1) * spread;
    const b = (rng() + rng() - 1) * spread;
    let dx = f.x + rx * a + ux * b;
    let dy = f.y + uy * b;
    let dz = f.z + rz * a + uz * b;
    const len = Math.hypot(dx, dy, dz);
    dx /= len;
    dy /= len;
    dz /= len;
    dirs.push(dx, dy, dz);
  }
  s.recoil += 1;
  s.lastFire = s.tick;
  s.protect = 0;
  return { weapon: def.id, heavy, ox: s.x, oy: s.y + eye, oz: s.z, dirs, tick: s.tick };
}

function weaponTick(s: PlayerState, buttons: number, seedBase: number): ShotInfo | null {
  const def = weaponDef(s.weapon);
  const attack = (buttons & BTN.ATTACK) !== 0;
  const attack2 = (buttons & BTN.ATTACK2) !== 0;
  let shot: ShotInfo | null = null;

  if (s.deploy > 0) s.deploy--;
  if (s.reload > 0) {
    s.reload--;
    if (s.reload === 0) finishReload(s, def);
  }
  if (s.recoil > 0 && s.tick - s.lastFire > def.fireTicks + 1) {
    s.recoil = Math.max(0, s.recoil - def.recoil.recovery * TICK_DT);
  }

  if (attack2 && !s.attack2Held && def.zoomFov.length > 0 && s.deploy === 0 && s.reload === 0) {
    s.zoom = (s.zoom + 1) % (def.zoomFov.length + 1);
  }
  if (buttons & BTN.RELOAD) startReload(s, def);

  const ready = !s.dropping && s.deploy === 0 && s.reload === 0 && s.tick >= s.nextFire;
  if (def.slot === 3) {
    if (ready && (attack || attack2)) {
      const heavy = attack2 && !attack && !!def.heavy;
      s.nextFire = s.tick + (heavy && def.heavy ? def.heavy.ticks : def.fireTicks);
      shot = fire(s, def, seedBase, heavy);
    }
  } else if (attack && ready && (def.auto || !s.attackHeld)) {
    if (s.mag[def.id] > 0) {
      s.mag[def.id]--;
      s.nextFire = s.tick + def.fireTicks;
      shot = fire(s, def, seedBase, false);
    } else if (s.reserve[def.id] > 0) {
      startReload(s, def);
    } else {
      s.nextFire = s.tick + 15;
    }
  }

  s.attackHeld = attack;
  s.attack2Held = attack2;
  if (s.protect > 0) s.protect--;
  return shot;
}

/**
 * Advances one player by exactly one command (1/60 s). This function is the
 * single source of truth: the server runs it authoritatively and the client
 * runs it for prediction and replays it after every snapshot.
 */
export function applyCmd(w: CollisionWorld, s: PlayerState, cmd: Cmd, seedBase: number): ShotInfo | null {
  s.tick++;
  s.yaw = wrapAngle(cmd.yaw);
  s.pitch = clamp(cmd.pitch, -MAX_PITCH, MAX_PITCH);
  if (cmd.weapon) switchWeapon(s, cmd.weapon);
  playerMove(w, s, cmd.buttons, TICK_DT);
  return weaponTick(s, cmd.buttons, seedBase);
}

// ---------------------------------------------------------------- hitboxes

export const ZONE_HEAD = 0;
export const ZONE_BODY = 1;
export const ZONE_LEGS = 2;
export const ZONE_MULT = [4, 1, 0.75];

/** Head / body / legs AABBs for a player standing (or crouching) at feet position. */
export function hitboxes(x: number, y: number, z: number, ducked: boolean): number[][] {
  if (ducked) {
    return [
      [x - 7, y + 23, z - 7, x + 7, y + 37, z + 7],
      [x - 13, y + 12, z - 13, x + 13, y + 26, z + 13],
      [x - 11, y, z - 11, x + 11, y + 12, z + 11],
    ];
  }
  return [
    [x - 7, y + 58, z - 7, x + 7, y + 72, z + 7],
    [x - 13, y + 32, z - 13, x + 13, y + 58, z + 13],
    [x - 10, y, z - 10, x + 10, y + 32, z + 10],
  ];
}

export function rayHitbox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  x: number,
  y: number,
  z: number,
  ducked: boolean,
  maxDist: number,
): { t: number; zone: number } | null {
  // cheap reject against the whole hull first
  const r = 16;
  const top = y + (ducked ? 37 : 72);
  if (rayAabb(ox, oy, oz, dx, dy, dz, x - r, y, z - r, x + r, top, z + r, maxDist) < 0) return null;
  let best: { t: number; zone: number } | null = null;
  const boxes = hitboxes(x, y, z, ducked);
  for (let zone = 0; zone < 3; zone++) {
    const b = boxes[zone];
    const t = rayAabb(ox, oy, oz, dx, dy, dz, b[0], b[1], b[2], b[3], b[4], b[5], maxDist);
    if (t >= 0 && (!best || t < best.t)) best = { t, zone };
  }
  return best;
}
