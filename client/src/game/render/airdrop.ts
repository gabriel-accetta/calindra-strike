import { AIRDROP_HALF, type WeaponId, weaponDef } from '@calindra-strike/shared';
import * as THREE from 'three';
import { drawEitri } from './textures.ts';

let crateTex: THREE.CanvasTexture | null = null;

function crateTexture(): THREE.CanvasTexture {
  if (crateTex) return crateTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#20201e';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#a5fa00';
  g.lineWidth = 14;
  g.strokeRect(7, 7, 242, 242);
  g.fillStyle = 'rgba(165,250,0,0.12)';
  for (let i = -256; i < 256; i += 36) {
    g.beginPath();
    g.moveTo(i, 256);
    g.lineTo(i + 18, 256);
    g.lineTo(i + 274, 0);
    g.lineTo(i + 256, 0);
    g.fill();
  }
  drawEitri(g, 128, 128, 170);
  crateTex = new THREE.CanvasTexture(c);
  crateTex.colorSpace = THREE.SRGBColorSpace;
  return crateTex;
}

/** Legendary supply crate: parachutes down with a tall lime beam marking where it lands. */
export class AirdropView {
  readonly group = new THREE.Group();
  private readonly crate: THREE.Mesh;
  private readonly chute: THREE.Group;
  private readonly beam: THREE.Mesh;
  private y: number;
  readonly weapon: WeaponId;
  landed = false;

  constructor(
    readonly id: number,
    readonly x: number,
    readonly z: number,
    y: number,
    weapon: WeaponId,
  ) {
    this.weapon = weapon;
    this.y = y;
    const s = AIRDROP_HALF * 2;
    const tex = crateTexture();
    this.crate = new THREE.Mesh(
      new THREE.BoxGeometry(s, s, s),
      new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.6, metalness: 0.2 }),
    );
    this.crate.position.y = s / 2;
    this.crate.castShadow = true;
    this.group.add(this.crate);

    this.chute = new THREE.Group();
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(60, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.6),
      new THREE.MeshStandardMaterial({ color: '#a5fa00', emissive: '#3c5c00', side: THREE.DoubleSide, roughness: 0.8 }),
    );
    canopy.scale.set(1, 0.5, 1);
    canopy.position.y = 150;
    this.chute.add(canopy);
    const pts: THREE.Vector3[] = [];
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      pts.push(new THREE.Vector3(dx * 20, s, dz * 20), new THREE.Vector3(dx * 42, 150, dz * 42));
    }
    this.chute.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#f0f0f0' })));
    this.group.add(this.chute);

    const beamGeo = new THREE.CylinderGeometry(14, 22, 2400, 16, 1, true);
    beamGeo.translate(0, 1200, 0);
    this.beam = new THREE.Mesh(
      beamGeo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { time: { value: 0 }, near: { value: 1 } },
        vertexShader: 'varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          // fades in above the crate (so the crate stays readable up close) and out toward the sky
          'uniform float time; uniform float near; varying float vY; void main(){ float a = (1.0 - vY / 2400.0); a = a * a * (0.55 + 0.15 * sin(time * 4.0 - vY * 0.01)); a *= smoothstep(30.0, 220.0, vY); gl_FragColor = vec4(0.65, 0.98, 0.0, a * 0.7 * near); }',
      }),
    );
    this.beam.frustumCulled = false;
    this.group.add(this.beam);
    this.group.position.set(x, y, z);
  }

  get label(): string {
    const d = weaponDef(this.weapon);
    return d.tag === d.name.toUpperCase() ? d.name : `${d.name} · ${d.tag}`;
  }

  target(y: number, landed: boolean): void {
    this.y = y;
    this.landed = landed;
  }

  update(dt: number, t: number, camera?: THREE.Vector3): void {
    const p = this.group.position;
    if (camera) {
      // soften the beam when you are standing next to it
      const d = Math.hypot(camera.x - this.x, camera.z - this.z);
      (this.beam.material as THREE.ShaderMaterial).uniforms.near.value = THREE.MathUtils.clamp((d - 60) / 500, 0.18, 1);
    }
    p.y += (this.y - p.y) * Math.min(1, dt * 10);
    this.chute.visible = !this.landed;
    this.chute.rotation.y += dt * 0.4;
    this.crate.rotation.y = this.landed ? 0 : Math.sin(t * 1.3) * 0.15;
    // the beam stays anchored at the landing spot even while the crate is falling
    this.beam.position.y = -(p.y - this.groundY);
    (this.beam.material as THREE.ShaderMaterial).uniforms.time.value = t;
  }

  groundY = 0;

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      if (mat && (mat as THREE.MeshStandardMaterial).map !== crateTex) mat.dispose();
    });
  }
}
