import { WEAPON, type WeaponId } from '@calindra-strike/shared';
import * as THREE from 'three';

const mats = {
  gun: new THREE.MeshStandardMaterial({ color: '#2f3338', roughness: 0.45, metalness: 0.45 }),
  gun2: new THREE.MeshStandardMaterial({ color: '#474d55', roughness: 0.55, metalness: 0.3 }),
  poly: new THREE.MeshStandardMaterial({ color: '#242427', roughness: 0.8 }),
  steel: new THREE.MeshStandardMaterial({ color: '#a2abb3', roughness: 0.3, metalness: 0.6 }),
  wood: new THREE.MeshStandardMaterial({ color: '#7b4a22', roughness: 0.65 }),
  lime: new THREE.MeshStandardMaterial({ color: '#a5fa00', emissive: '#a5fa00', emissiveIntensity: 1.1, roughness: 0.4 }),
  limeDim: new THREE.MeshStandardMaterial({ color: '#7fbf12', roughness: 0.5, metalness: 0.2 }),
  lens: new THREE.MeshStandardMaterial({ color: '#0c1a0c', emissive: '#a5fa00', emissiveIntensity: 0.45, roughness: 0.05, metalness: 0.6 }),
};

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function bx(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeo, m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  g.add(mesh);
  return mesh;
}

function cyl(g: THREE.Group, r: number, len: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 14), m);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

export interface WeaponModel {
  group: THREE.Group;
  muzzle: THREE.Object3D;
}

/** Original low-poly weapon models. Barrel points toward -Z, origin at the firing hand. */
export function buildWeapon(id: WeaponId): WeaponModel {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  switch (id) {
    case WEAPON.PISTOL:
      bx(g, 1.6, 1.8, 8, mats.gun, 0, 2, -2.5);
      bx(g, 1.5, 1.2, 7, mats.poly, 0, 0.6, -2);
      bx(g, 1.5, 4.6, 2.3, mats.poly, 0, -1.8, 0.8, -0.25);
      bx(g, 0.5, 0.5, 0.5, mats.lime, 0, 3.1, -6.1);
      bx(g, 1.62, 0.35, 5, mats.lime, 0, 1.4, -3);
      bx(g, 0.4, 1.6, 2.4, mats.gun, 0, -0.2, -1.4);
      muzzle.position.set(0, 2, -6.8);
      break;
    case WEAPON.SMG:
      bx(g, 3, 4.5, 12, mats.gun, 0, 1.5, -3);
      bx(g, 1.1, 1.1, 5, mats.steel, 0, 1.6, -11.5);
      bx(g, 2, 9, 2.6, mats.gun2, 0, -4, -5.5, 0.08);
      bx(g, 2.2, 5, 2.6, mats.poly, 0, -2.2, 1, -0.3);
      bx(g, 0.8, 3, 9, mats.steel, 0, 1.2, 7);
      bx(g, 3.1, 0.5, 10, mats.lime, 0, 3.85, -3);
      bx(g, 1, 1.4, 2.4, mats.gun, 0, 4.6, 0);
      muzzle.position.set(0, 1.6, -14.5);
      break;
    case WEAPON.SHOTGUN:
      bx(g, 3, 4.5, 12, mats.gun, 0, 1.2, -2);
      bx(g, 1.6, 1.6, 22, mats.steel, 0, 2.1, -18);
      bx(g, 1.4, 1.4, 16, mats.gun2, 0, 0.3, -15);
      bx(g, 2.8, 2.8, 7, mats.limeDim, 0, 0.3, -17);
      bx(g, 2.9, 0.5, 7.2, mats.lime, 0, 1.75, -17);
      bx(g, 2.6, 4.5, 13, mats.wood, 0, -0.2, 10, 0.12);
      bx(g, 2.2, 5, 2.6, mats.wood, 0, -2.4, 3.5, -0.4);
      muzzle.position.set(0, 2.1, -29.5);
      break;
    case WEAPON.SNIPER:
      bx(g, 3, 4.5, 16, mats.gun, 0, 1.5, -4);
      bx(g, 1.5, 1.5, 26, mats.steel, 0, 1.8, -25);
      bx(g, 2.6, 2.2, 4.4, mats.gun, 0, 1.8, -39.5);
      bx(g, 0.35, 0.35, 22, mats.lime, 0.85, 2.7, -24);
      bx(g, 0.35, 0.35, 22, mats.lime, -0.85, 2.7, -24);
      cyl(g, 1.5, 15, mats.gun, 0, 5.7, -4);
      cyl(g, 1.9, 2, mats.gun2, 0, 5.7, -11.5);
      cyl(g, 1.7, 2, mats.gun2, 0, 5.7, 3.5);
      cyl(g, 1.6, 0.3, mats.lens, 0, 5.7, -12.6);
      bx(g, 1.2, 2.2, 1.6, mats.gun, 0, 4, -4);
      bx(g, 3, 5.2, 13, mats.gun2, 0, 0.6, 10);
      bx(g, 3.1, 1.2, 9, mats.lime, 0, 1.6, 10);
      bx(g, 2.2, 5, 2.6, mats.poly, 0, -2.2, 2, -0.3);
      bx(g, 2.6, 0.8, 0.8, mats.steel, 2, 2.6, 1.5);
      muzzle.position.set(0, 1.8, -42);
      break;
    case WEAPON.LMG:
      bx(g, 4.6, 6, 18, mats.gun, 0, 1.5, -3);
      bx(g, 2.8, 2.8, 16, mats.gun2, 0, 2, -20);
      for (let i = 0; i < 4; i++) bx(g, 2.9, 0.5, 1.6, mats.lime, 0, 3.45, -14 - i * 3.6);
      bx(g, 1.3, 1.3, 6, mats.steel, 0, 2, -30.5);
      bx(g, 4.2, 6.5, 6.5, mats.limeDim, -0.6, -3.8, -4);
      bx(g, 4.3, 1, 6.6, mats.lime, -0.6, -2, -4);
      bx(g, 1, 3, 8, mats.gun, 0, 5.8, -4);
      bx(g, 3, 4.6, 10, mats.poly, 0, 1, 10);
      bx(g, 2.2, 5, 2.6, mats.poly, 0, -2.6, 3, -0.3);
      bx(g, 0.5, 8, 0.5, mats.steel, 1.2, -2.5, -24, 0.4, 0, 0.25);
      bx(g, 0.5, 8, 0.5, mats.steel, -1.2, -2.5, -24, 0.4, 0, -0.25);
      muzzle.position.set(0, 2, -34);
      break;
    case WEAPON.HAMMER:
      // Upright shaft: grip at the origin, shared by first- and third-person hands.
      bx(g, 1.8, 19, 1.8, mats.wood, 0, 2.5, 0);
      bx(g, 2.2, 10, 2.2, mats.poly, 0, -1.6, 0);
      for (const y of [-5.5, -3.5, -1.5, 0.5, 2.5]) bx(g, 2.35, 0.45, 2.35, mats.gun2, 0, y, 0);
      bx(g, 3, 1.8, 3, mats.steel, 0, -7, 0);
      bx(g, 3.6, 2, 3.6, mats.gun2, 0, 11.5, 0);
      bx(g, 12, 7, 7, mats.steel, 0, 16, 0);
      bx(g, 2, 7.6, 7.6, mats.gun2, -6, 16, 0);
      bx(g, 2, 7.6, 7.6, mats.gun2, 6, 16, 0);
      for (const x of [-3.8, 3.8]) bx(g, 0.7, 7.25, 7.25, mats.lime, x, 16, 0);
      for (const z of [-3.55, 3.55]) {
        bx(g, 3.4, 0.55, 0.16, mats.lime, 0, 16.7, z);
        bx(g, 0.55, 3, 0.16, mats.lime, 0, 15.9, z);
      }
      muzzle.position.set(0, 16, -3.5);
      break;
    default: // RIFLE
      bx(g, 3, 5, 16, mats.gun, 0, 1.5, -4);
      bx(g, 3.2, 4, 10, mats.poly, 0, 1.5, -17);
      bx(g, 3.3, 0.6, 8, mats.lime, 0, 2.7, -17);
      bx(g, 1.2, 1.2, 10, mats.steel, 0, 1.8, -27);
      bx(g, 1.8, 1.8, 2.6, mats.gun, 0, 1.8, -32.5);
      bx(g, 2.4, 8, 3.6, mats.gun2, 0, -3.2, -8, 0.25);
      bx(g, 2.2, 5, 2.6, mats.poly, 0, -2.2, 0, -0.3);
      bx(g, 2.6, 4.4, 11, mats.poly, 0, 0.8, 9);
      bx(g, 2.7, 0.6, 9, mats.lime, 0, 2.3, 9);
      bx(g, 1, 1.6, 3, mats.gun, 0, 4.7, -2);
      muzzle.position.set(0, 1.8, -34);
      break;
  }
  g.add(muzzle);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group: g, muzzle };
}
