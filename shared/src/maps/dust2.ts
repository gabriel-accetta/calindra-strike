import objectives from './dust2.objectives.json';
import geometry from './dust2.geometry.json';
import { CollisionWorld } from '../physics.ts';
import { MapBuilder } from './builder.ts';
import type { Brush, MapDef } from './types.ts';

/** Classic CS 1.6 layout imported from Hammer; see tools/maps/README.md. */
export function buildDust2(): MapDef {
  const b = new MapBuilder();
  // Sky brushes are removed to support this game's parachute spawns.
  // Invisible perimeter walls retain players inside the original playable extent.
  b.wallX(-2500, 2120, -2560, 32, 2600, 'clip');
  b.wallX(-2500, 2120, 2464, 32, 2600, 'clip');
  b.wallZ(-2560, 2464, -2500, 32, 2600, 'clip');
  b.wallZ(-2560, 2464, 2120, 32, 2600, 'clip');
  for (const box of b.boxes) {
    box.visible = false;
    box.shootThrough = true;
  }
  const map: MapDef = {
    id: 'dust2',
    name: 'Dust2',
    subtitle: 'de_dust2 · Counter-Strike 1.6',
    bounds: { minX: -2480, maxX: 2100, minZ: -2540, maxZ: 2444 },
    dropArea: { minX: -2200, maxX: 1800, minZ: -2200, maxZ: 2200 },
    dropHeight: 1500,
    boxes: b.boxes,
    brushes: geometry as Brush[],
    airdropPoints: [],
    lights: [],
    theme: {
      skyTop: '#6194c4',
      skyHorizon: '#d6c6a3',
      skyBottom: '#ac9166',
      fog: '#d6c6a3',
      fogNear: 3200,
      fogFar: 8500,
      sun: '#ffe5b3',
      sunIntensity: 2.7,
      sunDir: { x: -0.45, y: 0.85, z: 0.3 },
      hemiSky: '#d5e5ff',
      hemiGround: '#9f825a',
      hemiIntensity: 1.6,
    },
  };
  const world = new CollisionWorld(map);
  for (let x = -1800; x <= 1600; x += 400) {
    for (let z = -1800; z <= 1800; z += 400) {
      const y = world.groundBelow(x, map.dropHeight, z, 22);
      if (y >= 0 && y < 800 && !world.hullOverlaps(x, y + 0.1, z, 72)) map.airdropPoints.push({ x, z });
    }
  }
  map.defuse = {
    sites: objectives.sites,
    spawns: objectives.spawns.map((team) => team.map((spawn) => ({
      ...spawn,
      y: world.groundBelow(spawn.x, spawn.y, spawn.z, 16) + 0.03125,
    }))),
  };
  map.spawnPoints = map.airdropPoints;
  return map;
}
