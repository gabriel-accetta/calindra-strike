import { describe, expect, it } from 'vitest';
import {
  BTN,
  CollisionWorld,
  type Cmd,
  JUMP_SPEED,
  type MapDef,
  MapBuilder,
  WEAPON,
  applyCmd,
  cloneState,
  computeSpread,
  createPlayerState,
  getMaps,
  packState,
  spawnState,
  unpackState,
  weaponDef,
} from '../src/index.ts';

function testMap(build: (b: MapBuilder) => void): CollisionWorld {
  const b = new MapBuilder();
  b.add(-4000, -32, -4000, 4000, 0, 4000, 'ground');
  build(b);
  const map: MapDef = {
    ...getMaps()[0],
    boxes: b.boxes,
  };
  return new CollisionWorld(map);
}

function grounded(world: CollisionWorld, x = 0, z = 0, primary: 2 | 3 | 4 = WEAPON.RIFLE) {
  const s = createPlayerState();
  spawnState(s, x, 0.1, z, 0, primary);
  s.dropping = false;
  s.pitch = 0;
  // settle on the floor
  run(world, s, 10, 0);
  return s;
}

let seq = 0;
function run(world: CollisionWorld, s: ReturnType<typeof createPlayerState>, ticks: number, buttons: number, yaw = 0, weapon = 0) {
  const shots = [];
  for (let i = 0; i < ticks; i++) {
    const cmd: Cmd = { seq: seq++, buttons, yaw, pitch: 0, weapon: i === 0 ? weapon : 0, interp: 0 };
    const shot = applyCmd(world, s, cmd, 7);
    if (shot) shots.push(shot);
  }
  return shots;
}

describe('movement', () => {
  it('accelerates to the weapon max speed and no further on flat ground', () => {
    const w = testMap(() => {});
    const s = grounded(w);
    run(w, s, 120, BTN.FWD);
    const speed = Math.hypot(s.vx, s.vz);
    expect(speed).toBeGreaterThan(215);
    expect(speed).toBeLessThanOrEqual(weaponDef(WEAPON.RIFLE).speed + 0.01);
    expect(s.z).toBeLessThan(-200); // yaw 0 looks toward -Z
    expect(s.onGround).toBe(true);
  });

  it('stops at walls without penetrating them', () => {
    const w = testMap((b) => b.add(-200, 0, -300, 200, 200, -280, 'concrete'));
    const s = grounded(w);
    run(w, s, 240, BTN.FWD);
    expect(s.z - 16).toBeGreaterThanOrEqual(-280 - 0.001);
    expect(s.z - 16).toBeLessThan(-279);
  });

  it('slides along walls when moving diagonally', () => {
    const w = testMap((b) => b.add(-2000, 0, -100, 2000, 200, -80, 'concrete'));
    const s = grounded(w);
    run(w, s, 120, BTN.FWD | BTN.RIGHT);
    expect(s.x).toBeGreaterThan(100);
  });

  it('climbs stairs made of 16 unit steps', () => {
    const w = testMap((b) => {
      b.stairs(-80, 80, -300, -108, '-z', 96, 'concrete');
      b.add(-80, 0, -600, 80, 96, -300, 'concrete');
    });
    const s = grounded(w);
    run(w, s, 150, BTN.FWD);
    expect(s.y).toBeGreaterThan(95);
    expect(s.z).toBeLessThan(-300);
  });

  it('jumps about 45 units high', () => {
    const w = testMap(() => {});
    const s = grounded(w);
    let maxY = 0;
    run(w, s, 1, BTN.JUMP);
    expect(s.vy).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) {
      run(w, s, 1, 0);
      maxY = Math.max(maxY, s.y);
    }
    expect(maxY).toBeGreaterThan(42);
    expect(maxY).toBeLessThan(48);
    expect(JUMP_SPEED).toBeGreaterThan(0);
  });

  it('needs a crouch-jump to reach a 56 unit ledge', () => {
    const build = (b: MapBuilder) => b.add(-200, 0, -800, 200, 56, -300, 'crate');
    const attempt = (duck: boolean) => {
      const w = testMap(build);
      const s = grounded(w);
      // run-up until ~40 units from the ledge
      let guard = 0;
      while (s.z - 16 > -300 + 40 && guard++ < 300) run(w, s, 1, BTN.FWD);
      run(w, s, 1, BTN.JUMP | BTN.FWD);
      run(w, s, 8, BTN.FWD);
      run(w, s, 40, BTN.FWD | (duck ? BTN.DUCK : 0));
      run(w, s, 30, BTN.FWD);
      return s.y;
    };
    expect(attempt(false)).toBeLessThan(1);
    expect(attempt(true)).toBeGreaterThan(55);
  });

  it('skydives down and lands with spawn protection', () => {
    const w = testMap(() => {});
    const s = createPlayerState();
    spawnState(s, 0, 1100, 0, 0, WEAPON.RIFLE);
    let t = 0;
    while (s.dropping && t < 600) {
      run(w, s, 1, BTN.FWD);
      t++;
    }
    expect(s.dropping).toBe(false);
    expect(t).toBeLessThan(5 * 60);
    expect(s.y).toBeLessThan(1);
    expect(s.protect).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('replaying the same commands from a packed snapshot reproduces the state', () => {
    const w = new CollisionWorld(getMaps()[0]);
    const s = grounded(w, 600, 600);
    const cmds: Cmd[] = [];
    for (let i = 0; i < 180; i++) {
      const b = (i % 40 < 30 ? BTN.FWD : BTN.LEFT) | (i % 50 === 10 ? BTN.JUMP : 0) | (i > 100 && i % 3 === 0 ? BTN.ATTACK : 0);
      cmds.push({ seq: i, buttons: b, yaw: i * 0.02, pitch: 0.1, weapon: 0, interp: 0 });
    }
    const snap = packState(s);
    const a = cloneState(s);
    for (const c of cmds) applyCmd(w, a, c, 3);
    const b = createPlayerState();
    unpackState(snap, b);
    for (const c of cmds) applyCmd(w, b, c, 3);
    expect(b.x).toBeCloseTo(a.x, 2);
    expect(b.y).toBeCloseTo(a.y, 2);
    expect(b.z).toBeCloseTo(a.z, 2);
    expect(b.mag).toEqual(a.mag);
  });
});

describe('weapons', () => {
  it('fires the rifle on cadence, empties the mag and reloads', () => {
    const w = testMap(() => {});
    const s = grounded(w);
    const def = weaponDef(WEAPON.RIFLE);
    const shots = run(w, s, def.fireTicks * 30, BTN.ATTACK);
    expect(shots.length).toBe(30);
    expect(s.mag[WEAPON.RIFLE]).toBe(0);
    run(w, s, 2, BTN.ATTACK);
    expect(s.reload).toBeGreaterThan(0);
    run(w, s, def.reloadTicks + 2, 0);
    expect(s.mag[WEAPON.RIFLE]).toBe(30);
    expect(s.reserve[WEAPON.RIFLE]).toBe(60);
  });

  it('semi-automatic pistol needs a re-press', () => {
    const w = testMap(() => {});
    const s = grounded(w);
    run(w, s, 1, 0, 0, 2);
    run(w, s, 60, 0);
    const held = run(w, s, 60, BTN.ATTACK);
    expect(held.length).toBe(1);
  });

  it('is accurate standing still and inaccurate while running', () => {
    const w = testMap(() => {});
    const s = grounded(w);
    const still = computeSpread(s);
    run(w, s, 90, BTN.FWD);
    const running = computeSpread(s);
    expect(still).toBeLessThan(0.01);
    expect(running).toBeGreaterThan(still * 10);
  });

  it('shotgun fires 9 pellets with the same seed on both sides', () => {
    const w = testMap(() => {});
    const a = grounded(w, 0, 0, WEAPON.SHOTGUN);
    const b = cloneState(a);
    const sa = applyCmd(w, a, { seq: 1, buttons: BTN.ATTACK, yaw: 0, pitch: 0, weapon: 0, interp: 0 }, 42);
    const sb = applyCmd(w, b, { seq: 1, buttons: BTN.ATTACK, yaw: 0, pitch: 0, weapon: 0, interp: 0 }, 42);
    expect(sa?.dirs.length).toBe(27);
    expect(sa?.dirs).toEqual(sb?.dirs);
  });
});
