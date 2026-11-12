import { WEAPON, type WeaponId } from '@calindra-strike/shared';
import * as THREE from 'three';
import { buildWeapon, type WeaponModel } from './weapons3d.ts';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function part(parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeo, m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function nameTexture(name: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 112;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.font = '700 46px "Inter Variable", Inter, sans-serif';
  const w = Math.min(500, g.measureText(name).width + 70);
  const x0 = (512 - w) / 2;
  g.fillStyle = 'rgba(19,19,18,0.78)';
  g.beginPath();
  g.roundRect(x0, 18, w, 76, 24);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x0 + 18, 46, 20, 20, 6);
  g.fill();
  g.fillStyle = '#f0f0f0';
  g.textBaseline = 'middle';
  g.fillText(name, x0 + 50, 58, w - 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function canopyTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? '#f0f0f0' : color;
    g.fillRect(i * 32, 0, 32, 32);
  }
  g.fillStyle = '#a5fa00';
  g.fillRect(0, 26, 256, 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface AvatarPose {
  speed: number;
  ducked: boolean;
  dropping: boolean;
  onGround: boolean;
  pitch: number;
  protect: boolean;
  reloading: boolean;
}

/** Stylized soldier sized to the hitboxes: legs 0-32, torso 32-58, head 58-72. */
export class Avatar {
  readonly root = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly mount = new THREE.Group();
  private readonly canopy = new THREE.Group();
  private readonly tag: THREE.Sprite;
  private weapon: WeaponModel | null = null;
  private weaponId: WeaponId | -1 = -1;
  private phase = 0;
  private recoil = 0;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private crouchT = 0;

  constructor(
    readonly name: string,
    readonly color: string,
  ) {
    const body = this.mat({ color, roughness: 0.6 });
    const dark = this.mat({ color: '#232322', roughness: 0.8 });
    const pants = this.mat({ color: '#30302e', roughness: 0.9 });
    const lime = this.mat({ color: '#a5fa00', emissive: '#a5fa00', emissiveIntensity: 0.9 });
    const visor = this.mat({ color: '#0b0c0b', roughness: 0.1, metalness: 0.8, emissive: '#1d2f05', emissiveIntensity: 1 });
    const boots = this.mat({ color: '#151515', roughness: 0.9 });

    // legs pivot at the hip
    for (const [leg, x] of [
      [this.legL, -5.5],
      [this.legR, 5.5],
    ] as const) {
      leg.position.set(x, 32, 0);
      part(leg, 9, 28, 10, pants, 0, -14, 0);
      part(leg, 10, 5, 13, boots, 0, -29.5, -1.5);
      part(leg, 9.4, 4, 2, dark, 0, -12, -5.2);
      this.root.add(leg);
    }

    this.upper.position.y = 32;
    part(this.upper, 24, 6, 14, dark, 0, 1, 0);
    part(this.upper, 24, 21, 14, body, 0, 14, 0);
    part(this.upper, 19, 14, 2.4, dark, 0, 14, -8);
    part(this.upper, 19.2, 1.8, 2.6, lime, 0, 19, -8.2);
    part(this.upper, 17, 18, 7, dark, 0, 14, 10);
    part(this.upper, 7, 7, 8, body, -14, 22, 0);
    part(this.upper, 7, 7, 8, body, 14, 22, 0);
    this.root.add(this.upper);

    this.head.position.set(0, 26, 0);
    part(this.head, 7, 4, 7, dark, 0, 1, 0);
    part(this.head, 14, 12, 14, body, 0, 8.5, 0);
    part(this.head, 15, 3, 15, dark, 0, 13.5, 0);
    part(this.head, 12, 5, 2, visor, 0, 8, -7.4);
    part(this.head, 12.2, 0.8, 2.2, lime, 0, 5.4, -7.5);
    this.upper.add(this.head);

    // weapon + arms rotate with pitch around the shoulders
    this.mount.position.set(0, 22, 0);
    part(this.mount, 6, 6, 15, body, 9, -3, -6);
    part(this.mount, 5, 5, 5, dark, 7, -5, -14);
    const armL = part(this.mount, 6, 6, 19, body, -7, -3, -10);
    armL.rotation.y = 0.45;
    part(this.mount, 5, 5, 5, dark, 0, -3, -19);
    this.upper.add(this.mount);

    // skydive canopy
    const cm = new THREE.MeshStandardMaterial({ map: canopyTexture(color), side: THREE.DoubleSide, roughness: 0.8 });
    this.materials.push(cm);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(62, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2.8), cm);
    shell.scale.set(1, 0.42, 0.75);
    shell.position.y = 120;
    this.canopy.add(shell);
    const lines = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-14, 62, 0),
      new THREE.Vector3(-52, 112, -20),
      new THREE.Vector3(14, 62, 0),
      new THREE.Vector3(52, 112, -20),
      new THREE.Vector3(-14, 62, 0),
      new THREE.Vector3(-52, 112, 20),
      new THREE.Vector3(14, 62, 0),
      new THREE.Vector3(52, 112, 20),
    ]);
    this.canopy.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: '#e8e8e8' })));
    this.canopy.visible = false;
    this.root.add(this.canopy);

    const tm = new THREE.SpriteMaterial({ map: nameTexture(name, color), depthWrite: false, sizeAttenuation: false, transparent: true });
    this.tag = new THREE.Sprite(tm);
    this.tag.scale.set(0.16, 0.035, 1);
    this.tag.position.y = 90;
    this.tag.renderOrder = 10;
    this.root.add(this.tag);

    this.setWeapon(WEAPON.RIFLE);
  }

  private mat(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial(p);
    this.materials.push(m);
    return m;
  }

  setWeapon(id: WeaponId): void {
    if (id === this.weaponId) return;
    if (this.weapon) this.mount.remove(this.weapon.group);
    this.weapon = buildWeapon(id);
    this.weaponId = id;
    const g = this.weapon.group;
    if (id === WEAPON.HAMMER) {
      g.position.set(8, -4, -16);
      g.rotation.set(0.9, 0, 0);
    } else {
      g.position.set(5, -2, -14);
    }
    this.mount.add(g);
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (!this.weapon) return this.root.getWorldPosition(out);
    return this.weapon.muzzle.getWorldPosition(out);
  }

  kick(): void {
    this.recoil = 1;
  }

  showTag(v: boolean): void {
    this.tag.visible = v;
  }

  update(dt: number, p: AvatarPose): void {
    this.crouchT += ((p.ducked ? 1 : 0) - this.crouchT) * Math.min(1, dt * 14);
    const c = this.crouchT;
    // crouch: shorter legs, hips down, torso leaning forward
    this.upper.position.y = 32 - 24 * c;
    this.upper.rotation.x = -0.35 * c;
    this.legL.position.y = this.legR.position.y = 32 - 24 * c;
    this.legL.scale.y = this.legR.scale.y = 1 - 0.7 * c;

    const moving = p.onGround && p.speed > 20;
    if (moving) this.phase += dt * (p.speed / 26);
    else this.phase *= 0.9;
    const swing = moving ? Math.sin(this.phase) * Math.min(0.75, p.speed / 300) : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    if (!p.onGround && !p.dropping) {
      this.legL.rotation.x = 0.5;
      this.legR.rotation.x = -0.2;
    }

    this.recoil = Math.max(0, this.recoil - dt * 10);
    this.mount.rotation.x = p.pitch * 0.85 + this.recoil * 0.12 + (p.reloading ? -0.5 : 0);
    this.head.rotation.x = p.pitch * 0.5;

    this.canopy.visible = p.dropping;
    if (p.dropping) {
      this.legL.rotation.x = 0.25;
      this.legR.rotation.x = 0.1;
      this.canopy.rotation.z = Math.sin(performance.now() / 400) * 0.06;
    }

    const ghost = p.protect && Math.floor(performance.now() / 120) % 2 === 0;
    for (const m of this.materials) {
      m.transparent = p.protect;
      m.opacity = ghost ? 0.35 : p.protect ? 0.7 : 1;
    }
  }

  /** Detached falling copy for death animations. */
  corpse(): THREE.Object3D {
    const c = this.root.clone();
    c.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) o.visible = false;
    });
    const canopy = c.children.find((ch) => ch.children.some((k) => (k as THREE.LineSegments).isLineSegments));
    if (canopy) canopy.visible = false;
    return c;
  }

  dispose(): void {
    for (const m of this.materials) {
      m.map?.dispose();
      m.dispose();
    }
    (this.tag.material as THREE.SpriteMaterial).map?.dispose();
    this.tag.material.dispose();
  }
}
