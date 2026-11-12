import { type ResultRow, WEAPON } from '@calindra-strike/shared';
import * as THREE from 'three';
import { Avatar } from './avatar.ts';
import { canvasTexture, drawBulldog, drawEitri } from './textures.ts';

const PLACES = [
  { x: 0, h: 64, color: '#ffd23f', label: '1' },
  { x: -88, h: 42, color: '#dfe4ea', label: '2' },
  { x: 88, h: 28, color: '#e8a066', label: '3' },
];

function numberTexture(label: string, color: string): THREE.CanvasTexture {
  return canvasTexture(
    256,
    (g) => {
      g.fillStyle = '#1c1c1a';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = color;
      g.fillRect(0, 0, 256, 10);
      g.font = '900 150px "Inter Variable", Inter, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = color;
      g.fillText(label, 128, 140);
    },
    false,
  );
}

function wallTexture(): THREE.CanvasTexture {
  return canvasTexture(
    1024,
    (g) => {
      const w = 2048;
      const h = 1024;
      g.fillStyle = '#121211';
      g.fillRect(0, 0, w, h);
      const size = 120;
      const gap = 18;
      for (let x = -40; x < w; x += size + gap) {
        for (let y = -30; y < h; y += size + gap) {
          const cx = x + size / 2 - w / 2;
          const cy = y + size / 2 - h * 0.42;
          const d = Math.hypot(cx, cy);
          g.fillStyle = `rgba(32,32,30,${0.95 - Math.min(0.5, d / 2400)})`;
          g.beginPath();
          g.roundRect(x, y, size, size, 32);
          g.fill();
          g.strokeStyle = 'rgba(255,255,255,0.04)';
          g.stroke();
        }
      }
      const grd = g.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, 620);
      grd.addColorStop(0, 'rgba(165,250,0,0.45)');
      grd.addColorStop(1, 'rgba(165,250,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      // brand tiles either side of the winner: Calindra Strike × Eitri
      drawBulldog(g, w * 0.3, h * 0.68, 210, true);
      drawEitri(g, w * 0.7, h * 0.68, 210, { tile: true });
    },
    false,
    2048,
    1024,
  );
}

interface Confetti {
  p: THREE.Vector3;
  v: number;
  r: THREE.Euler;
  w: THREE.Vector3;
  sway: number;
}

/** End-of-match stage: top three players on pedestals, spotlights and confetti. */
export class PodiumScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 1, 5000);
  private avatars: Avatar[] = [];
  private readonly stand = new THREE.Group();
  private readonly confetti: Confetti[] = [];
  private readonly confettiMesh: THREE.InstancedMesh;
  private t = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor() {
    this.scene.background = new THREE.Color('#0e0e0d');
    this.scene.fog = new THREE.Fog('#0e0e0d', 500, 1400);
    this.scene.add(new THREE.HemisphereLight('#d9e2ff', '#1b1b1a', 0.9));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(120, 300, 260);
    this.scene.add(key);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.MeshStandardMaterial({
        map: (() => {
          const t = canvasTexture(256, (g, s) => {
            g.fillStyle = '#151514';
            g.fillRect(0, 0, s, s);
            g.strokeStyle = 'rgba(165,250,0,0.18)';
            g.lineWidth = 3;
            g.strokeRect(0, 0, s, s);
          });
          t.repeat.set(40, 40);
          return t;
        })(),
        roughness: 0.35,
        metalness: 0.3,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const wall = new THREE.Mesh(new THREE.PlaneGeometry(1600, 800), new THREE.MeshBasicMaterial({ map: wallTexture(), fog: false }));
    wall.position.set(0, 330, -420);
    this.scene.add(wall);

    for (const pl of PLACES) {
      const side = new THREE.MeshStandardMaterial({ color: '#1c1c1a', roughness: 0.6 });
      const top = new THREE.MeshStandardMaterial({ color: pl.color, emissive: pl.color, emissiveIntensity: 0.25, roughness: 0.4 });
      const front = new THREE.MeshStandardMaterial({ map: numberTexture(pl.label, pl.color), roughness: 0.6 });
      const block = new THREE.Mesh(new THREE.BoxGeometry(76, pl.h, 70), [side, side, top, side, front, side]);
      block.position.set(pl.x, pl.h / 2, 0);
      this.stand.add(block);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(70, 520, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: pl.color, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      cone.position.set(pl.x, pl.h + 250, 0);
      this.stand.add(cone);
      const spot = new THREE.SpotLight(pl.color, 5, 1100, 0.32, 0.6, 0);
      spot.position.set(pl.x, 560, 60);
      spot.target.position.set(pl.x, pl.h, 0);
      this.stand.add(spot, spot.target);
    }
    this.scene.add(this.stand);

    const colors = ['#a5fa00', '#f0f0f0', '#ffd23f', '#3ec1ff', '#ff5fc4', '#292929'];
    this.confettiMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.2, 1.8), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 360);
    for (let i = 0; i < 360; i++) {
      this.confetti.push({
        p: new THREE.Vector3((Math.random() - 0.5) * 520, Math.random() * 420, (Math.random() - 0.5) * 300),
        v: 30 + Math.random() * 50,
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        w: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        sway: Math.random() * 6,
      });
      this.confettiMesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    }
    this.confettiMesh.frustumCulled = false;
    this.scene.add(this.confettiMesh);
  }

  setResults(results: ResultRow[], colorFor: (r: ResultRow) => string): void {
    for (const a of this.avatars) {
      this.stand.remove(a.root);
      a.dispose();
    }
    this.avatars = [];
    results.slice(0, 3).forEach((r, i) => {
      const pl = PLACES[i];
      const a = new Avatar(r.name, colorFor(r));
      a.setWeapon(i === 0 ? WEAPON.SNIPER : WEAPON.RIFLE);
      a.root.position.set(pl.x, pl.h, 0);
      a.root.rotation.y = Math.PI;
      a.root.scale.setScalar(1.15);
      a.showTag(false); // names are on the result cards, in the player's colour
      this.stand.add(a.root);
      this.avatars.push(a);
    });
    this.t = 0;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    const intro = Math.min(1, t / 2.5);
    const e = 1 - (1 - intro) ** 3;
    this.camera.position.set(Math.sin(t * 0.25) * 80, 96 + (1 - e) * 140, 540 - e * 60);
    this.camera.lookAt(0, 88, 0);
    this.avatars.forEach((a, i) => {
      const hop = i === 0 ? Math.abs(Math.sin(t * 3.2)) * 9 : 0;
      a.root.position.y = PLACES[i].h + hop;
      a.root.rotation.y = Math.PI + Math.sin(t * 0.9 + i) * 0.35;
      a.update(dt, {
        speed: 0,
        ducked: false,
        dropping: false,
        onGround: true,
        pitch: i === 0 ? 1.1 + Math.sin(t * 6.4) * 0.2 : 0.25 + Math.sin(t * 2 + i) * 0.08,
        protect: false,
        reloading: false,
      });
    });
    this.confetti.forEach((c, i) => {
      c.p.y -= c.v * dt;
      c.p.x += Math.sin(t * 2 + c.sway) * 12 * dt;
      if (c.p.y < 0) c.p.y += 440;
      c.r.x += c.w.x * dt;
      c.r.y += c.w.y * dt;
      this.q.setFromEuler(c.r);
      this.m4.compose(c.p, this.q, this.one);
      this.confettiMesh.setMatrixAt(i, this.m4);
    });
    this.confettiMesh.instanceMatrix.needsUpdate = true;
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }
}
