import { MapBuilder } from './builder.ts';
import type { MapDef } from './types.ts';

/**
 * ESCRITÓRIO: the Calindra office, "open space" taken literally: no roof.
 * North half authored once and mirrored 180 degrees for fairness.
 */
export function buildEscritorio(): MapDef {
  const b = new MapBuilder();
  const X = 1280;
  const Z = 1024;
  const WALL = 224;

  b.add(-X - 64, -32, -Z - 64, X + 64, 0, Z + 64, 'carpet');

  // perimeter
  b.add(-X - 32, 0, -Z - 32, X, WALL, -Z, 'white');
  b.add(X, 0, -Z - 32, X + 32, WALL, Z, 'white');
  b.add(-X, 0, Z, X + 32, WALL, Z + 32, 'white');
  b.add(-X - 32, 0, -Z, -X, WALL, Z + 32, 'white');
  b.add(-X - 32, WALL, -Z - 32, X + 32, 3200, -Z, 'clip', { visible: false, shoot: true });
  b.add(-X - 32, WALL, Z, X + 32, 3200, Z + 32, 'clip', { visible: false, shoot: true });
  b.add(X, WALL, -Z, X + 32, 3200, Z, 'clip', { visible: false, shoot: true });
  b.add(-X - 32, WALL, -Z, -X, 3200, Z, 'clip', { visible: false, shoot: true });
  // neon baseboard + top band
  b.deco(-X, 0, -Z, X, 6, -Z + 3);
  b.deco(-X, 0, Z - 3, X, 6, Z);
  b.deco(-X, 0, -Z, -X + 3, 6, Z);
  b.deco(X - 3, 0, -Z, X, 6, Z);

  // center: kitchen island ("copa") + coffee machine
  b.add(-192, 0, -56, 192, 40, 56, 'tile');
  b.add(-24, 40, -20, 24, 100, 20, 'charcoal');
  b.deco(-26, 70, -22, 26, 76, 22);
  b.point(0, -300);
  b.point(0, 300);

  b.mirrored(() => {
    // Mezzanine (NW) with stairs + glass railing
    b.add(-X, 0, -Z, -560, 128, -864, 'concrete');
    b.stairs(-560, -368, -Z, -944, '-x', 128, 'concrete');
    b.add(-X, 128, -868, -560, 168, -864, 'glass', { shoot: true });
    b.add(-564, 128, -944, -560, 168, -868, 'glass', { shoot: true });
    b.deco(-X, 122, -864, -560, 128, -861);
    b.add(-1100, 128, -1000, -988, 158, -936, 'desk');
    b.add(-1080, 158, -980, -1040, 184, -976, 'screen', { solid: false });
    b.deco(-1000, 150, -Z, -700, 214, -Z + 4, 'screen');
    b.point(-900, -940);

    // Desk cluster A (two facing rows) + monitors
    b.add(-1000, 0, -640, -664, 30, -512, 'desk');
    b.deco(-1000, 30, -578, -664, 52, -574, 'glass');
    for (const cx of [-944, -832, -720]) {
      b.add(cx - 20, 30, -604, cx + 20, 56, -600, 'screen', { solid: false });
      b.add(cx - 20, 30, -552, cx + 20, 56, -548, 'screen', { solid: false });
    }
    // Desk cluster B
    b.add(-336, 0, -640, 0, 30, -512, 'desk');
    b.deco(-336, 30, -578, 0, 52, -574, 'glass');
    for (const cx of [-280, -168, -56]) {
      b.add(cx - 20, 30, -604, cx + 20, 56, -600, 'screen', { solid: false });
      b.add(cx - 20, 30, -552, cx + 20, 56, -548, 'screen', { solid: false });
    }

    // Meeting room "Sala Mjölnir": glass walls, table, screen
    b.add(240, 0, -712, 440, 160, -704, 'glass', { shoot: true });
    b.add(536, 0, -712, 720, 160, -704, 'glass', { shoot: true });
    b.add(240, 0, -Z, 248, 160, -712, 'glass', { shoot: true });
    b.add(712, 0, -Z, 720, 160, -712, 'glass', { shoot: true });
    b.add(440, 128, -712, 536, 160, -704, 'glass', { shoot: true });
    b.deco(240, 156, -716, 720, 162, -700);
    b.add(360, 0, -920, 600, 30, -824, 'desk');
    b.deco(380, 60, -Z, 580, 150, -Z + 4, 'screen');

    // Server room (NE corner)
    b.wallX(900, X, -648, 16, WALL, 'charcoal', [{ from: 1000, to: 1096, bottom: 0, top: 128 }]);
    b.wallZ(-Z, -656, 908, 16, WALL, 'charcoal');
    b.add(980, 0, -940, 1200, 176, -900, 'metal');
    b.add(980, 0, -800, 1200, 176, -760, 'metal');
    b.deco(980, 20, -900, 1200, 24, -897);
    b.deco(980, 60, -900, 1200, 64, -897);
    b.deco(980, 100, -760, 1200, 104, -757);
    b.deco(980, 140, -760, 1200, 144, -757);
    b.light(1090, 200, -850);

    // Pillars
    for (const [px, pz] of [
      [-560, -300],
      [560, -300],
      [0, -760],
    ] as const) {
      b.block(px, pz, 48, 48, WALL, 'white');
      b.deco(px - 26, 96, pz - 26, px + 26, 104, pz + 26);
    }

    // Lounge: sofa + coffee table
    b.add(600, 0, -480, 840, 34, -432, 'sofa');
    b.add(600, 34, -480, 840, 62, -464, 'sofa');
    b.add(660, 0, -400, 780, 18, -352, 'wood');
    b.point(800, -250);

    // Ping-pong table
    b.add(300, 0, -300, 500, 30, -190, 'lime');
    b.add(398, 30, -300, 402, 38, -190, 'white', { solid: false, shoot: true });

    // Lockers against the west wall
    b.add(-X, 0, -700, -1232, 96, -460, 'metal');

    // Plants
    for (const [px, pz] of [
      [-1200, -320],
      [180, -420],
      [1200, -560],
    ] as const) {
      b.block(px, pz, 32, 32, 36, 'charcoal');
      b.block(px, pz, 60, 60, 64, 'plant', 36, { solid: false, shoot: true });
    }

    b.point(-800, -300);

    // brand walls
    b.deco(X - 2, 50, -330, X, 210, -170, 'eitri');
    b.deco(-200, 40, -Z, -40, 200, -Z + 2, 'logo');
  });

  return {
    id: 'escritorio',
    name: 'Escritório',
    subtitle: 'open space, literalmente',
    bounds: { minX: -X, maxX: X, minZ: -Z, maxZ: Z },
    dropArea: { minX: -1200, maxX: 1200, minZ: -950, maxZ: 950 },
    dropHeight: 1000,
    airdropPoints: b.points,
    boxes: b.boxes,
    lights: b.lights,
    theme: {
      skyTop: '#3d7fd6',
      skyHorizon: '#cfe5ff',
      skyBottom: '#eef5ff',
      fog: '#dcebff',
      fogNear: 1800,
      fogFar: 6500,
      sun: '#fff1dc',
      sunIntensity: 2.8,
      sunDir: { x: 0.45, y: 0.8, z: 0.3 },
      hemiSky: '#eaf3ff',
      hemiGround: '#7d766a',
      hemiIntensity: 1.4,
    },
  };
}
