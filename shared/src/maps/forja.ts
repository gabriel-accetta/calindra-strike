import { MapBuilder } from './builder.ts';
import type { MapDef } from './types.ts';

/**
 * FORJA: an open-air forge yard. Square, 4-way rotationally symmetric so every
 * landing spot is equally fair in free-for-all.
 *
 *   - Center "Bigorna" (anvil) platform with stairs on all sides and a glowing core.
 *   - One warehouse per quadrant with doors + windows (roofs are skydive-only perches).
 *   - Shipping container you reach with a crate jump chain.
 *   - Tall sniper perches only reachable by landing on them from the sky.
 */
export function buildForja(): MapDef {
  const b = new MapBuilder();
  const H = 1536;

  // ground
  b.add(-H - 64, -32, -H - 64, H + 64, 0, H + 64, 'ground');

  // perimeter, tiled so the four copies never overlap
  b.rotated(() => {
    b.add(-H - 32, 0, -H - 32, H, 288, -H, 'concrete');
    b.add(-H - 32, 288, -H - 32, H, 3200, -H, 'clip', { visible: false, shoot: true });
    b.deco(-H, 268, -H, H, 276, -H + 3);
    // big brand banners on every perimeter wall: Eitri mark flanked by the game logo
    b.deco(-90, 60, -H, 90, 240, -H + 2, 'eitri');
    b.deco(-620, 70, -H, -460, 230, -H + 2, 'logo');
    b.deco(460, 70, -H, 620, 230, -H + 2, 'logo');
  });

  // --- center: the anvil ---
  b.add(-224, 0, -224, 224, 96, 224, 'charcoal');
  b.block(0, 0, 48, 48, 112, 'lime', 96);
  b.light(0, 240, 0);
  b.point(0, -160);

  b.rotated(() => {
    b.stairs(-80, 80, -416, -224, '+z', 96, 'concrete');
    b.deco(-224, 90, -227, -80, 96, -224);
    b.deco(80, 90, -227, 224, 96, -224);
    b.block(128, -128, 56, 56, 40, 'crate', 96);
    b.crate(352, -352, 64);
    b.crate(408, -312, 40);
  });

  // --- one quadrant, replayed 4x ---
  b.rotated(() => {
    // Warehouse
    const x1 = 704;
    const x2 = 1216;
    const z1 = -1216;
    const z2 = -768;
    const h = 200;
    const t = 16;
    b.wallX(x1, x2, z1 + t / 2, t, h, 'charcoal');
    b.wallX(x1, x2, z2 - t / 2, t, h, 'charcoal', [
      { from: 880, to: 976, bottom: 0, top: 128 },
      { from: 1056, to: 1152, bottom: 64, top: 112 },
    ]);
    b.wallZ(z1 + t, z2 - t, x1 + t / 2, t, h, 'charcoal', [
      { from: -1072, to: -976, bottom: 0, top: 128 },
      { from: -912, to: -848, bottom: 64, top: 112 },
    ]);
    b.wallZ(z1 + t, z2 - t, x2 - t / 2, t, h, 'charcoal', [{ from: -1040, to: -944, bottom: 64, top: 112 }]);
    b.add(x1, h, z1, x2, h + 16, z2, 'metal');
    b.deco(x1, h + 6, z2, x2, h + 14, z2 + 3);
    b.deco(x1 - 3, h + 6, z1, x1, h + 14, z2);
    // door frames glow so they read from far away
    b.deco(880, 128, z2, 976, 134, z2 + 3);
    b.deco(x1 - 3, 128, -1072, x1, 134, -976);
    // warehouse branding facing the yard
    b.deco(722, 36, z2, 862, 176, z2 + 2, 'eitri');
    // interior cover
    b.crate(800, -1120, 56);
    b.crate(1120, -880, 64);
    b.crate(1120, -880, 32, 64);
    b.block(960, -1000, 160, 24, 44, 'metal');

    // Container + crate jump chain (40 -> 72 -> 104)
    b.add(880, 0, -560, 1200, 104, -464, 'container');
    b.block(820, -532, 40, 40, 40, 'crate');
    b.block(860, -528, 40, 48, 72, 'crate');

    // yard crates by the center lane
    b.crate(540, -260, 64);
    b.crate(604, -212, 40);

    // outer corridor cover
    b.add(1290, 0, -568, H, 40, -552, 'concrete');
    b.crate(1460, -1460, 64);
    b.crate(1400, -1470, 40);
    b.crate(1300, -300, 56);
    b.crate(900, -1400, 56);

    // Sniper perch: only reachable by skydiving onto it
    b.add(224, 0, -1376, 352, 232, -1248, 'charcoal');
    b.add(224, 232, -1376, 352, 256, -1368, 'metal');
    b.add(224, 232, -1256, 352, 256, -1248, 'metal');
    b.add(224, 232, -1368, 232, 256, -1256, 'metal');
    b.add(344, 232, -1368, 352, 256, -1256, 'metal');
    b.deco(221, 200, -1379, 355, 208, -1245);
    b.light(288, 290, -1312);

    // lane cover
    b.add(160, 0, -728, 400, 48, -712, 'concrete');
    b.crate(560, -1000, 64);
    b.crate(560, -1060, 40);
    b.crate(120, -1000, 48);

    b.point(960, -320);
    b.point(1376, -1000);
    b.point(400, -960);
  });

  return {
    id: 'forja',
    name: 'Forja',
    subtitle: 'pátio da forja do Eitri',
    bounds: { minX: -H, maxX: H, minZ: -H, maxZ: H },
    dropArea: { minX: -1450, maxX: 1450, minZ: -1450, maxZ: 1450 },
    dropHeight: 1150,
    airdropPoints: b.points,
    boxes: b.boxes,
    lights: b.lights,
    theme: {
      skyTop: '#1f2b47',
      skyHorizon: '#f2b27a',
      skyBottom: '#c98a5a',
      fog: '#e2b48a',
      fogNear: 1800,
      fogFar: 7800,
      sun: '#ffd6a0',
      sunIntensity: 3.2,
      sunDir: { x: -0.55, y: 0.55, z: -0.35 },
      hemiSky: '#c4d2ff',
      hemiGround: '#6a5643',
      hemiIntensity: 1.35,
    },
  };
}
