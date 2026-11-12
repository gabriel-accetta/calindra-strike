import * as THREE from 'three';
import { flashTexture } from './viewmodel.ts';

interface Tracer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  len: number;
  t: number;
  active: boolean;
}

interface Decal {
  mesh: THREE.Mesh;
  age: number;
}

interface Particle {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
}

const TRACER_SPEED = 14000;
const MAX_SPARKS = 500;
const MAX_CUBES = 240;

function holeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grd.addColorStop(0, 'rgba(10,10,10,0.95)');
  grd.addColorStop(0.35, 'rgba(20,20,18,0.8)');
  grd.addColorStop(0.6, 'rgba(40,38,34,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pooled combat effects: tracers, bullet holes, sparks, hit bursts, flashes, corpses. */
export class Effects {
  private readonly tracers: Tracer[] = [];
  private readonly decals: Decal[] = [];
  private decalIdx = 0;
  private readonly sparks: Particle[] = [];
  private readonly sparkGeo: THREE.BufferGeometry;
  private readonly sparkPts: THREE.Points;
  private readonly cubes: (Particle & { r: THREE.Euler; w: THREE.Vector3; color: THREE.Color })[] = [];
  private readonly cubeMesh: THREE.InstancedMesh;
  private readonly flashes: { s: THREE.Sprite; t: number }[] = [];
  private readonly corpses: { obj: THREE.Object3D; t: number; dir: number }[] = [];
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpS = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    const tgeo = new THREE.BoxGeometry(0.6, 0.6, 1);
    tgeo.translate(0, 0, -0.5);
    const tmat = new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(tgeo, tmat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, t: 0, active: false });
    }
    const dgeo = new THREE.PlaneGeometry(5, 5);
    const dmat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    for (let i = 0; i < 120; i++) {
      const mesh = new THREE.Mesh(dgeo, dmat);
      mesh.visible = false;
      scene.add(mesh);
      this.decals.push({ mesh, age: 0 });
    }
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * 3), 3));
    this.sparkGeo.setDrawRange(0, 0);
    this.sparkPts = new THREE.Points(
      this.sparkGeo,
      new THREE.PointsMaterial({ color: '#ffd38a', size: 2.6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.sparkPts.frustumCulled = false;
    scene.add(this.sparkPts);
    this.cubeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), new THREE.MeshStandardMaterial({ roughness: 0.5 }), MAX_CUBES);
    this.cubeMesh.count = 0;
    this.cubeMesh.frustumCulled = false;
    scene.add(this.cubeMesh);
    const fmat = new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (let i = 0; i < 16; i++) {
      const s = new THREE.Sprite(fmat);
      s.visible = false;
      s.scale.set(16, 16, 1);
      scene.add(s);
      this.flashes.push({ s, t: 0 });
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const tr = this.tracers.find((t) => !t.active);
    if (!tr) return;
    tr.from.copy(from);
    tr.dir.subVectors(to, from);
    tr.len = tr.dir.length();
    if (tr.len < 40) return;
    tr.dir.divideScalar(tr.len);
    tr.t = 0;
    tr.active = true;
    tr.mesh.visible = true;
  }

  muzzleFlash(pos: THREE.Vector3): void {
    const f = this.flashes.find((x) => x.t <= 0) ?? this.flashes[0];
    f.s.position.copy(pos);
    f.s.material.rotation = Math.random() * 3;
    f.s.visible = true;
    f.t = 0.05;
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3 | null): void {
    if (normal) {
      const d = this.decals[this.decalIdx];
      this.decalIdx = (this.decalIdx + 1) % this.decals.length;
      d.mesh.position.copy(pos).addScaledVector(normal, 0.3);
      d.mesh.lookAt(this.tmpS.copy(d.mesh.position).add(normal));
      d.mesh.rotateZ(Math.random() * Math.PI);
      d.mesh.visible = true;
      d.age = 0;
    }
    const n = normal ?? new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 6; i++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2).normalize().add(n).multiplyScalar(120 + Math.random() * 220);
      this.sparks.push({ p: pos.clone(), v, life: 0, max: 0.18 + Math.random() * 0.2 });
    }
  }

  burst(pos: THREE.Vector3, color: string, n = 14): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      if (this.cubes.length >= MAX_CUBES) this.cubes.shift();
      this.cubes.push({
        p: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10)),
        v: new THREE.Vector3((Math.random() - 0.5) * 260, 80 + Math.random() * 220, (Math.random() - 0.5) * 260),
        life: 0,
        max: 0.7 + Math.random() * 0.6,
        r: new THREE.Euler(Math.random() * 3, Math.random() * 3, 0),
        w: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10),
        color: Math.random() > 0.3 ? c : new THREE.Color('#a5fa00'),
      });
    }
  }

  corpse(obj: THREE.Object3D, yaw: number): void {
    this.scene.add(obj);
    this.corpses.push({ obj, t: 0, dir: Math.random() > 0.5 ? 1 : -1 });
    void yaw;
  }

  update(dt: number): void {
    for (const tr of this.tracers) {
      if (!tr.active) continue;
      tr.t += dt;
      const head = Math.min(tr.len, tr.t * TRACER_SPEED);
      const seg = Math.min(220, head);
      if (head >= tr.len && tr.t * TRACER_SPEED - tr.len > 220) {
        tr.active = false;
        tr.mesh.visible = false;
        continue;
      }
      const tail = Math.max(0, tr.t * TRACER_SPEED - 220);
      const start = tr.from.clone().addScaledVector(tr.dir, Math.min(tail, tr.len));
      tr.mesh.position.copy(start);
      tr.mesh.lookAt(start.clone().sub(tr.dir));
      tr.mesh.scale.z = Math.max(1, Math.min(seg, tr.len - Math.min(tail, tr.len)));
    }

    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      d.age += dt;
      if (d.age > 14) d.mesh.visible = false;
    }

    const arr = this.sparkGeo.attributes.position.array as Float32Array;
    let n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life += dt;
      if (s.life > s.max) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.v.y -= 800 * dt;
      s.p.addScaledVector(s.v, dt);
      arr[n * 3] = s.p.x;
      arr[n * 3 + 1] = s.p.y;
      arr[n * 3 + 2] = s.p.z;
      n++;
    }
    this.sparkGeo.setDrawRange(0, n);
    this.sparkGeo.attributes.position.needsUpdate = true;

    let k = 0;
    for (let i = this.cubes.length - 1; i >= 0; i--) {
      const c = this.cubes[i];
      c.life += dt;
      if (c.life > c.max) {
        this.cubes.splice(i, 1);
        continue;
      }
      c.v.y -= 800 * dt;
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < 0.6) {
        c.p.y = 0.6;
        c.v.multiplyScalar(0.4);
        c.v.y = Math.abs(c.v.y) * 0.3;
      }
      c.r.x += c.w.x * dt;
      c.r.y += c.w.y * dt;
      const sc = 1 - Math.max(0, (c.life - c.max * 0.6) / (c.max * 0.4));
      this.tmpQ.setFromEuler(c.r);
      this.tmpS.set(sc, sc, sc);
      this.tmpM.compose(c.p, this.tmpQ, this.tmpS);
      this.cubeMesh.setMatrixAt(k, this.tmpM);
      this.cubeMesh.setColorAt(k, c.color);
      k++;
    }
    this.cubeMesh.count = k;
    this.cubeMesh.instanceMatrix.needsUpdate = true;
    if (this.cubeMesh.instanceColor) this.cubeMesh.instanceColor.needsUpdate = true;

    for (const f of this.flashes) {
      if (f.t <= 0) continue;
      f.t -= dt;
      if (f.t <= 0) f.s.visible = false;
    }

    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.t += dt;
      const fall = Math.min(1, c.t / 0.45);
      c.obj.rotation.x = -fall * fall * (Math.PI / 2) * c.dir;
      if (c.t > 2.6) c.obj.position.y -= dt * 30;
      if (c.t > 3.6) {
        this.scene.remove(c.obj);
        this.corpses.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const c of this.corpses) this.scene.remove(c.obj);
    this.corpses.length = 0;
    for (const d of this.decals) d.mesh.visible = false;
    this.sparks.length = 0;
    this.cubes.length = 0;
  }
}
