import type { Box, MapDef, Mat } from '@calindra-strike/shared';
import * as THREE from 'three';
import { TEX, TEX_SCALE } from './textures.ts';

interface Bucket {
  pos: number[];
  nrm: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

const FACES: { n: [number, number, number]; v: (b: Box) => number[][] }[] = [
  // +X
  { n: [1, 0, 0], v: (b) => [[b.max.x, b.min.y, b.max.z], [b.max.x, b.min.y, b.min.z], [b.max.x, b.max.y, b.min.z], [b.max.x, b.max.y, b.max.z]] },
  // -X
  { n: [-1, 0, 0], v: (b) => [[b.min.x, b.min.y, b.min.z], [b.min.x, b.min.y, b.max.z], [b.min.x, b.max.y, b.max.z], [b.min.x, b.max.y, b.min.z]] },
  // +Y
  { n: [0, 1, 0], v: (b) => [[b.min.x, b.max.y, b.max.z], [b.max.x, b.max.y, b.max.z], [b.max.x, b.max.y, b.min.z], [b.min.x, b.max.y, b.min.z]] },
  // -Y
  { n: [0, -1, 0], v: (b) => [[b.min.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.max.z], [b.min.x, b.min.y, b.max.z]] },
  // +Z
  { n: [0, 0, 1], v: (b) => [[b.min.x, b.min.y, b.max.z], [b.max.x, b.min.y, b.max.z], [b.max.x, b.max.y, b.max.z], [b.min.x, b.max.y, b.max.z]] },
  // -Z
  { n: [0, 0, -1], v: (b) => [[b.max.x, b.min.y, b.min.z], [b.min.x, b.min.y, b.min.z], [b.min.x, b.max.y, b.min.z], [b.max.x, b.max.y, b.min.z]] },
];

function faceUV(n: [number, number, number], p: number[], scale: number, b: Box, corner: number): [number, number] {
  if (scale === 0) {
    const c = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ][corner];
    return [c[0], c[1]];
  }
  if (n[0] !== 0) return [(p[2] * -n[0]) / scale, p[1] / scale];
  if (n[1] !== 0) return [p[0] / scale, p[2] / scale];
  void b;
  return [(p[0] * n[2]) / scale, p[1] / scale];
}

function materialFor(mat: Mat, quality: 'high' | 'low'): THREE.Material {
  void quality;
  switch (mat) {
    case 'lime':
      return new THREE.MeshStandardMaterial({ color: '#a5fa00', emissive: '#a5fa00', emissiveIntensity: 1.8, roughness: 0.4 });
    case 'glass':
      return new THREE.MeshStandardMaterial({
        color: '#cdeeff',
        transparent: true,
        opacity: 0.2,
        roughness: 0.05,
        metalness: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    case 'screen': {
      const t = TEX.screen();
      return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.9, roughness: 0.3 });
    }
    case 'eitri': {
      const t = TEX.eitri();
      // painted mural: transparent mark with a soft shadow, no square behind it
      return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.45, transparent: true, alphaTest: 0.02, depthWrite: false, roughness: 0.6 });
    }
    case 'logo': {
      const t = TEX.logo();
      return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.7, roughness: 0.5 });
    }
    case 'plant':
      return new THREE.MeshStandardMaterial({ map: TEX.plant(), roughness: 0.9, vertexColors: true });
    default: {
      const tex = TEX[mat]?.();
      const rough: Partial<Record<Mat, number>> = { metal: 0.45, container: 0.55, charcoal: 0.75, desk: 0.55, tile: 0.35 };
      const metal: Partial<Record<Mat, number>> = { metal: 0.55, container: 0.3 };
      return new THREE.MeshStandardMaterial({
        map: tex,
        roughness: rough[mat] ?? 0.9,
        metalness: metal[mat] ?? 0,
        vertexColors: true,
      });
    }
  }
}

export interface WorldView {
  group: THREE.Group;
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.Fog;
  /** Bombsite floor markings, only shown in defuse mode. */
  sites: THREE.Group;
  dispose(): void;
}

function skyDome(map: MapDef): THREE.Mesh {
  const t = map.theme;
  const sd = new THREE.Vector3(t.sunDir.x, t.sunDir.y, t.sunDir.z).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(t.skyTop) },
      horizon: { value: new THREE.Color(t.skyHorizon) },
      bottom: { value: new THREE.Color(t.skyBottom) },
      sunColor: { value: new THREE.Color(t.sun) },
      sunDir: { value: sd },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunColor; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h, 0.0, 1.0), 0.35));
        float s = max(dot(d, sunDir), 0.0);
        c += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 18.0) * 0.35 + pow(s, 3.0) * 0.08);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

/** Distant silhouettes: mountains for Forja, a skyline for the office. */
function horizon(map: MapDef): THREE.Object3D {
  const g = new THREE.Group();
  const seedRand = (s: number) => () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const r = seedRand(map.id.length * 7919 + 13);
  if (map.id === 'escritorio') {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: '#8a9bb3', roughness: 1 });
    const count = 140;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r() * 0.05;
      const rad = 3400 + r() * 2200;
      const w = 160 + r() * 380;
      const h = 300 + r() ** 2 * 2200;
      m4.compose(
        new THREE.Vector3(Math.cos(a) * rad, -40, Math.sin(a) * rad),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * Math.PI, 0)),
        new THREE.Vector3(w, h, 160 + r() * 300),
      );
      inst.setMatrixAt(i, m4);
    }
    g.add(inst);
    return g;
  }
  for (const [rad, col, amp] of [
    [5600, '#5a4560', 1300],
    [4300, '#3a2f3d', 800],
  ] as const) {
    const n = 160;
    const pos: number[] = [];
    const idx: number[] = [];
    let hPrev = 0.5;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      hPrev = Math.max(0.15, Math.min(1, hPrev + (r() - 0.5) * 0.5));
      const h = i === n ? pos[1 + 3 * 1] : hPrev * amp + 150;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      pos.push(x, -60, z, x, h, z);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    g.add(mesh);
  }
  return g;
}

function glowSprite(color: string): THREE.SpriteMaterial {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 });
}

export function buildWorld(map: MapDef, scene: THREE.Scene, quality: 'high' | 'low'): WorldView {
  const group = new THREE.Group();
  const buckets = new Map<Mat, Bucket>();

  for (const b of map.boxes) {
    if (!b.visible || b.mat === 'clip') continue;
    let bk = buckets.get(b.mat);
    if (!bk) {
      bk = { pos: [], nrm: [], uv: [], col: [], idx: [] };
      buckets.set(b.mat, bk);
    }
    const scale = TEX_SCALE[b.mat] ?? 128;
    const h = b.max.y - b.min.y;
    for (const f of FACES) {
      if (f.n[1] === -1 && b.min.y <= 0.01) continue; // never visible
      const base = bk.pos.length / 3;
      const verts = f.v(b);
      verts.forEach((p, ci) => {
        bk.pos.push(p[0], p[1], p[2]);
        bk.nrm.push(f.n[0], f.n[1], f.n[2]);
        const [u, v] = faceUV(f.n, p, scale, b, ci);
        bk.uv.push(u, v);
        // cheap ambient occlusion: darken the bottom of vertical faces
        let ao = 1;
        if (f.n[1] === 0 && b.mat !== 'ground' && b.mat !== 'carpet') ao = p[1] <= b.min.y + 0.01 ? (h > 120 ? 0.62 : 0.72) : 1;
        if (f.n[1] === -1) ao = 0.55;
        bk.col.push(ao, ao, ao);
      });
      bk.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  for (const [mat, bk] of buckets) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(bk.nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3));
    geo.setIndex(bk.idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materialFor(mat, quality));
    const caster = !['glass', 'lime', 'screen', 'ground', 'carpet', 'eitri', 'logo'].includes(mat);
    mesh.castShadow = caster;
    mesh.receiveShadow = mat !== 'lime' && mat !== 'glass';
    if (mat === 'glass') mesh.renderOrder = 5;
    group.add(mesh);
  }

  const sites = new THREE.Group();
  sites.visible = false;
  for (const site of map.defuse?.sites ?? []) {
    const y = site.min.y + 0.6;
    const w = site.max.x - site.min.x;
    const d = site.max.z - site.min.z;
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#a5fa00', transparent: true, opacity: 0.07, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    fill.position.set(site.min.x + w / 2, y, site.min.z + d / 2);
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(site.min.x, y, site.min.z),
        new THREE.Vector3(site.max.x, y, site.min.z),
        new THREE.Vector3(site.max.x, y, site.max.z),
        new THREE.Vector3(site.min.x, y, site.max.z),
      ]),
      new THREE.LineBasicMaterial({ color: '#a5fa00' }),
    );
    sites.add(fill, outline);
  }
  group.add(sites);

  // glow at map light points
  for (const l of map.lights) {
    const s = new THREE.Sprite(glowSprite(l.color));
    s.position.set(l.x, l.y, l.z);
    s.scale.set(140, 140, 1);
    group.add(s);
  }

  const t = map.theme;
  const sky = skyDome(map);
  group.add(sky);
  group.add(horizon(map));

  const hemi = new THREE.HemisphereLight(t.hemiSky, t.hemiGround, t.hemiIntensity);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(t.sun, t.sunIntensity);
  const sd = new THREE.Vector3(t.sunDir.x, t.sunDir.y, t.sunDir.z).normalize();
  sun.position.copy(sd).multiplyScalar(2500);
  sun.castShadow = true;
  const sm = quality === 'high' ? 2048 : 1024;
  sun.shadow.mapSize.set(sm, sm);
  const cam = sun.shadow.camera;
  cam.left = -1100;
  cam.right = 1100;
  cam.top = 1100;
  cam.bottom = -1100;
  cam.near = 100;
  cam.far = 6000;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 1.2;
  group.add(sun);
  group.add(sun.target);

  const fog = new THREE.Fog(t.fog, t.fogNear, t.fogFar);
  scene.fog = fog;
  scene.add(group);

  return {
    group,
    sky,
    sun,
    hemi,
    fog,
    sites,
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (mat) {
          for (const mm of Array.isArray(mat) ? mat : [mat]) {
            for (const v of Object.values(mm)) if (v instanceof THREE.Texture) v.dispose();
            mm.dispose();
          }
        }
      });
    },
  };
}

/** Keeps a crisp shadow frustum centred on the player, snapped to texels to avoid shimmering. */
export function followShadow(sun: THREE.DirectionalLight, x: number, z: number, dir: THREE.Vector3): void {
  const texel = 2200 / sun.shadow.mapSize.x;
  const sx = Math.round(x / texel) * texel;
  const sz = Math.round(z / texel) * texel;
  sun.target.position.set(sx, 0, sz);
  sun.position.set(sx + dir.x * 2500, dir.y * 2500, sz + dir.z * 2500);
}
