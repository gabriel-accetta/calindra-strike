import { WEAPON, type WeaponId } from '@calindra-strike/shared';
import * as THREE from 'three';
import { buildWeapon, type WeaponModel } from './weapons3d.ts';

export function flashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.translate(64, 64);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 60);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,220,120,0.9)');
  grd.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  grd.addColorStop(1, 'rgba(255,100,0,0)');
  g.fillStyle = grd;
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(-7, 0);
    g.lineTo(0, -62);
    g.lineTo(7, 0);
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, 26, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface ViewPose {
  speed: number;
  onGround: boolean;
  dt: number;
  lookDX: number;
  lookDY: number;
  reloadFrac: number; // 0..1 while reloading, -1 otherwise
  deployFrac: number; // 0..1 while deploying, -1 otherwise
  hidden: boolean;
}

/** First-person weapon rendered in its own scene on top of the world. */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.5, 400);
  private readonly holder = new THREE.Group();
  private readonly kickGroup = new THREE.Group();
  private model: WeaponModel | null = null;
  private weaponId: WeaponId | -1 = -1;
  private readonly flash: THREE.Sprite;
  private flashT = 0;
  private bobPhase = 0;
  private swayX = 0;
  private swayY = 0;
  private kick = 0;
  private swing = 0;
  private swingHeavy = false;
  private readonly sleeve: THREE.MeshStandardMaterial;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;

  constructor(color: string) {
    this.sleeve = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.55), roughness: 0.85 });
    this.hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1.4);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.2);
    this.sun.position.set(-0.4, 1, 0.3);
    this.scene.add(this.hemi, this.sun, this.camera);
    this.camera.add(this.holder);
    this.holder.add(this.kickGroup);
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.flash.visible = false;
  }

  /** Sleeves follow the player's identity colour (team colour in TDM). */
  setSleeveColor(color: string): void {
    this.sleeve.color.set(color).multiplyScalar(0.55);
  }

  setLighting(sky: string, ground: string, sun: string, sunIntensity: number): void {
    this.hemi.color.set(sky);
    this.hemi.groundColor.set(ground);
    this.sun.color.set(sun);
    this.sun.intensity = Math.min(2.6, sunIntensity * 0.8);
  }

  private arms(g: THREE.Group, id: WeaponId): void {
    const glove = new THREE.MeshStandardMaterial({ color: '#1c1c1b', roughness: 0.9 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const add = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, 0);
      g.add(mesh);
    };
    // right hand on the grip; forearm leaves the screen toward the bottom-right
    add(4.2, 4.2, 4.2, glove, 0.2, -2, 0.6);
    add(4.4, 4.4, 17, this.sleeve, 2.6, -7, 7.5, 0.3, 0.62);
    if (id === WEAPON.PISTOL) {
      add(4, 4, 4, glove, -2.2, -2.6, 0.4);
      add(4.2, 4.2, 17, this.sleeve, -4.8, -7.4, 7.2, -0.32, 0.6);
    } else if (id !== WEAPON.HAMMER) {
      // left hand under the handguard; forearm goes down-left and back toward the camera
      const z = id === WEAPON.SMG ? -9 : id === WEAPON.SHOTGUN ? -17 : -16;
      add(4, 3.6, 4.6, glove, -0.4, -1.4, z);
      add(4.2, 4.2, 19, this.sleeve, -3.6, -8.2, z + 6.4, -0.3, 0.84);
    }
  }

  setWeapon(id: WeaponId): void {
    if (id === this.weaponId) return;
    if (this.model) this.kickGroup.remove(this.model.group);
    const m = buildWeapon(id);
    m.group.traverse((o) => {
      o.castShadow = false;
    });
    this.arms(m.group, id);
    this.model = m;
    this.weaponId = id;
    m.group.scale.setScalar(0.62);
    if (id === WEAPON.HAMMER) {
      m.group.position.set(7, -8, -17);
      m.group.rotation.set(0.75, -0.25, 0.2);
    } else if (id === WEAPON.PISTOL) {
      m.group.position.set(5.2, -5.6, -15);
      m.group.rotation.set(0, 0.05, 0);
    } else {
      m.group.position.set(6, -6.4, -13);
      m.group.rotation.set(0, 0.045, 0);
    }
    m.muzzle.add(this.flash);
    this.kickGroup.add(m.group);
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (!this.model) return out.set(0, 0, 0);
    return this.model.muzzle.getWorldPosition(out);
  }

  fire(heavy: boolean): void {
    if (this.weaponId === WEAPON.HAMMER) {
      this.swing = 1;
      this.swingHeavy = heavy;
      return;
    }
    const k = this.weaponId === WEAPON.SNIPER || this.weaponId === WEAPON.SHOTGUN ? 1.6 : this.weaponId === WEAPON.PISTOL ? 1.1 : 0.7;
    this.kick = Math.min(1.8, this.kick + k);
    this.flashT = 0.045;
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI;
    const s = this.weaponId === WEAPON.SMG || this.weaponId === WEAPON.PISTOL ? 9 : 14;
    this.flash.scale.set(s, s, 1);
  }

  update(p: ViewPose): void {
    const dt = p.dt;
    this.holder.visible = !p.hidden;
    // bob
    const moving = p.onGround && p.speed > 30;
    if (moving) this.bobPhase += dt * (p.speed / 30);
    const amp = moving ? Math.min(1, p.speed / 250) : 0;
    const bobX = Math.sin(this.bobPhase) * 0.55 * amp;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.5 * amp;
    // sway: lags behind mouse motion
    this.swayX += (-p.lookDX * 0.02 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (p.lookDY * 0.02 - this.swayY) * Math.min(1, dt * 10);
    this.swayX = THREE.MathUtils.clamp(this.swayX, -2.5, 2.5);
    this.swayY = THREE.MathUtils.clamp(this.swayY, -2.5, 2.5);
    // recoil spring
    this.kick = Math.max(0, this.kick - dt * 7);
    // reload / deploy dips
    let dip = 0;
    let tilt = 0;
    if (p.reloadFrac >= 0) {
      const s = Math.sin(Math.min(1, p.reloadFrac) * Math.PI);
      dip = s * 7;
      tilt = s * 0.6;
    }
    if (p.deployFrac >= 0) dip = Math.max(dip, (1 - p.deployFrac) * 14);
    const air = p.onGround ? 0 : 1.2;

    this.holder.position.set(bobX + this.swayX, bobY - dip - this.swayY + air, 0);
    this.kickGroup.position.set(0, this.kick * 0.4, this.kick * 2.4);
    this.kickGroup.rotation.set(this.kick * 0.09 + tilt * 0.3, 0, -tilt);

    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt * (this.swingHeavy ? 2.4 : 4));
      const s = Math.sin((1 - this.swing) * Math.PI);
      this.kickGroup.rotation.x -= s * (this.swingHeavy ? 1.3 : 0.9);
      this.kickGroup.rotation.y += s * 0.5;
      this.kickGroup.position.z -= s * 6;
    }

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
  }

  render(renderer: THREE.WebGLRenderer): void {
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }

  /** Soft studio reflections so metal parts don't render black. */
  setEnvironment(env: THREE.Texture): void {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.55;
  }
}
