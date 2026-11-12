import * as THREE from 'three';

type Draw = (g: CanvasRenderingContext2D, s: number) => void;

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTexture(size: number, draw: Draw, repeat = true, w = size, h = size): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
  return t;
}

function speckle(g: CanvasRenderingContext2D, s: number, n: number, alpha: number, seed: number, light = false): void {
  const r = rand(seed);
  for (let i = 0; i < n; i++) {
    const v = light ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${r() * alpha})`;
    const sz = 1 + r() * 2.5;
    g.fillRect(r() * s, r() * s, sz, sz);
  }
}

function blotches(g: CanvasRenderingContext2D, s: number, n: number, alpha: number, seed: number): void {
  const r = rand(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * s;
    const y = r() * s;
    const rad = 20 + r() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() > 0.5;
    grd.addColorStop(0, dark ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha * 0.6})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

/** Pinwheel crosshair mark used across the brand. */
export function drawMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, fg: string, bg: string | null): void {
  const k = size / 64;
  g.save();
  g.translate(cx, cy);
  if (bg) {
    g.fillStyle = bg;
    const r = 17 * k;
    const h = 30 * k;
    g.beginPath();
    g.roundRect(-h, -h, h * 2, h * 2, r);
    g.fill();
  }
  g.fillStyle = fg;
  for (let i = 0; i < 4; i++) {
    g.save();
    g.rotate((i * Math.PI) / 2);
    g.beginPath();
    g.moveTo(-5 * k, -25 * k);
    g.lineTo(5 * k, -25 * k);
    g.lineTo(2 * k, -11 * k);
    g.lineTo(-8 * k, -11 * k);
    g.closePath();
    g.fill();
    g.restore();
  }
  g.beginPath();
  g.arc(0, 0, 3.4 * k, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

const S = 512;

export const TEX: Record<string, () => THREE.CanvasTexture> = {
  ground: () =>
    canvasTexture(S, (g, s) => {
      g.fillStyle = '#b8a283';
      g.fillRect(0, 0, s, s);
      blotches(g, s, 26, 0.09, 11);
      speckle(g, s, 5000, 0.18, 12);
      speckle(g, s, 1500, 0.12, 13, true);
      g.strokeStyle = 'rgba(60,45,30,0.35)';
      g.lineWidth = 3;
      for (const p of [0, s / 2]) {
        g.beginPath();
        g.moveTo(p, 0);
        g.lineTo(p, s);
        g.moveTo(0, p);
        g.lineTo(s, p);
        g.stroke();
      }
    }),
  concrete: () =>
    canvasTexture(S, (g, s) => {
      g.fillStyle = '#c4beb3';
      g.fillRect(0, 0, s, s);
      blotches(g, s, 18, 0.07, 21);
      speckle(g, s, 3500, 0.14, 22);
      g.fillStyle = 'rgba(70,64,58,0.35)';
      g.fillRect(0, s / 2 - 2, s, 3);
      g.fillRect(0, s - 2, s, 3);
      g.fillRect(s / 2 - 1, 0, 3, s);
      g.fillStyle = 'rgba(40,36,32,0.45)';
      for (let x = s / 8; x < s; x += s / 4) for (let y = s / 8; y < s; y += s / 4) g.fillRect(x - 3, y - 3, 6, 6);
    }),
  charcoal: () =>
    canvasTexture(S, (g, s) => {
      g.fillStyle = '#41413d';
      g.fillRect(0, 0, s, s);
      blotches(g, s, 14, 0.06, 31);
      speckle(g, s, 2500, 0.12, 32, true);
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(0, 0, 4, s);
      g.fillRect(s / 2, 0, 4, s);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(4, 0, 2, s);
      g.fillRect(s / 2 + 4, 0, 2, s);
      g.fillStyle = 'rgba(165,250,0,0.35)';
      for (const x of [20, s / 2 + 20]) for (const y of [24, s - 24]) g.fillRect(x, y, 5, 5);
    }),
  metal: () =>
    canvasTexture(S, (g, s) => {
      const grd = g.createLinearGradient(0, 0, s / 8, 0);
      grd.addColorStop(0, '#7f878d');
      grd.addColorStop(0.5, '#a9b1b6');
      grd.addColorStop(1, '#7f878d');
      g.fillStyle = grd;
      for (let x = 0; x < s; x += s / 8) {
        g.save();
        g.translate(x, 0);
        g.fillRect(0, 0, s / 8, s);
        g.restore();
      }
      speckle(g, s, 2500, 0.15, 41);
      blotches(g, s, 10, 0.08, 42);
    }),
  container: () =>
    canvasTexture(
      S,
      (g) => {
        const w = 1024;
        const h = 384;
        g.fillStyle = '#7dbd14';
        g.fillRect(0, 0, w, h);
        for (let x = 0; x < w; x += 32) {
          const grd = g.createLinearGradient(x, 0, x + 32, 0);
          grd.addColorStop(0, 'rgba(0,0,0,0.22)');
          grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
          grd.addColorStop(1, 'rgba(0,0,0,0.22)');
          g.fillStyle = grd;
          g.fillRect(x, 0, 32, h);
        }
        speckle(g, w, 4000, 0.18, 51);
        g.fillStyle = 'rgba(17,32,0,0.9)';
        g.font = '800 72px "Inter Variable", Inter, sans-serif';
        g.textBaseline = 'middle';
        g.fillText('calindra', 70, h / 2 - 20);
        g.font = '500 30px "Fragment Mono", monospace';
        g.fillText('STRIKE // FORJA-07', 74, h / 2 + 38);
        drawMark(g, w - 120, h / 2, 150, '#7dbd14', '#112000');
        g.fillStyle = 'rgba(17,32,0,0.6)';
        g.fillRect(0, 0, w, 14);
        g.fillRect(0, h - 14, w, 14);
      },
      false,
      1024,
      384,
    ),
  crate: () =>
    canvasTexture(
      256,
      (g, s) => {
        g.fillStyle = '#a3713d';
        g.fillRect(0, 0, s, s);
        const r = rand(61);
        for (let y = 0; y < s; y += s / 6) {
          g.fillStyle = `rgba(${60 + r() * 40},${35 + r() * 20},10,0.25)`;
          g.fillRect(0, y, s, s / 6 - 3);
          g.fillStyle = 'rgba(40,22,8,0.55)';
          g.fillRect(0, y + s / 6 - 3, s, 3);
        }
        speckle(g, s, 1500, 0.2, 62);
        g.strokeStyle = '#5b3a1b';
        g.lineWidth = 22;
        g.strokeRect(11, 11, s - 22, s - 22);
        g.lineWidth = 18;
        g.beginPath();
        g.moveTo(22, 22);
        g.lineTo(s - 22, s - 22);
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.08)';
        g.lineWidth = 2;
        g.strokeRect(2, 2, s - 4, s - 4);
        drawMark(g, s * 0.7, s * 0.3, 70, '#1a1408', 'rgba(165,250,0,0.85)');
      },
      false,
    ),
  wood: () =>
    canvasTexture(256, (g, s) => {
      g.fillStyle = '#8a5a33';
      g.fillRect(0, 0, s, s);
      const r = rand(71);
      for (let y = 0; y < s; y += 32) {
        g.fillStyle = `rgba(${r() * 60},${r() * 30},0,0.2)`;
        g.fillRect(0, y, s, 30);
        g.fillStyle = 'rgba(30,15,5,0.5)';
        g.fillRect(0, y + 30, s, 2);
      }
      speckle(g, s, 1200, 0.15, 72);
    }),
  carpet: () =>
    canvasTexture(S, (g, s) => {
      g.fillStyle = '#4b4e53';
      g.fillRect(0, 0, s, s);
      speckle(g, s, 14000, 0.25, 81);
      speckle(g, s, 6000, 0.12, 82, true);
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 2;
      for (let p = 0; p <= s; p += s / 4) {
        g.beginPath();
        g.moveTo(p, 0);
        g.lineTo(p, s);
        g.moveTo(0, p);
        g.lineTo(s, p);
        g.stroke();
      }
      g.fillStyle = 'rgba(165,250,0,0.5)';
      g.fillRect(s / 2 - 1, 0, 3, s);
    }),
  desk: () =>
    canvasTexture(256, (g, s) => {
      g.fillStyle = '#d6b892';
      g.fillRect(0, 0, s, s);
      const r = rand(91);
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(120,80,40,${r() * 0.18})`;
        g.lineWidth = 1 + r() * 3;
        const y = r() * s;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(s / 3, y + r() * 10 - 5, (2 * s) / 3, y + r() * 10 - 5, s, y);
        g.stroke();
      }
    }),
  white: () =>
    canvasTexture(S, (g, s) => {
      g.fillStyle = '#e8e7e2';
      g.fillRect(0, 0, s, s);
      speckle(g, s, 2500, 0.06, 101);
      blotches(g, s, 8, 0.04, 102);
    }),
  tile: () =>
    canvasTexture(256, (g, s) => {
      g.fillStyle = '#c9c9c3';
      g.fillRect(0, 0, s, s);
      const n = 4;
      const c = s / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          g.fillStyle = (i + j) % 2 ? '#f3f3ef' : '#ecece7';
          g.fillRect(i * c + 2, j * c + 2, c - 4, c - 4);
        }
    }),
  plant: () =>
    canvasTexture(256, (g, s) => {
      g.fillStyle = '#2f6b2a';
      g.fillRect(0, 0, s, s);
      const r = rand(111);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `hsl(${95 + r() * 30}, ${45 + r() * 25}%, ${25 + r() * 30}%)`;
        g.beginPath();
        g.ellipse(r() * s, r() * s, 6 + r() * 12, 3 + r() * 5, r() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    }),
  sofa: () =>
    canvasTexture(256, (g, s) => {
      g.fillStyle = '#3c3d42';
      g.fillRect(0, 0, s, s);
      speckle(g, s, 9000, 0.25, 121);
      g.fillStyle = 'rgba(165,250,0,0.65)';
      g.fillRect(0, s / 2 - 3, s, 6);
    }),
  screen: () =>
    canvasTexture(
      512,
      (g) => {
        const w = 512;
        const h = 288;
        g.fillStyle = '#0d0e0c';
        g.fillRect(0, 0, w, h);
        const grd = g.createRadialGradient(w * 0.3, h * 0.45, 0, w * 0.3, h * 0.45, 200);
        grd.addColorStop(0, 'rgba(165,250,0,0.35)');
        grd.addColorStop(1, 'rgba(165,250,0,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
        drawMark(g, 130, h / 2, 150, '#112000', '#a5fa00');
        g.fillStyle = '#f0f0f0';
        g.font = '800 50px "Inter Variable", Inter, sans-serif';
        g.fillText('calindra', 230, h / 2 - 10);
        g.fillStyle = '#a5fa00';
        g.fillText('strike', 230, h / 2 + 42);
        g.fillStyle = 'rgba(240,240,240,0.5)';
        g.font = '400 16px "Fragment Mono", monospace';
        g.fillText('apps made easy · eitri.tech', 232, h / 2 + 80);
      },
      false,
      512,
      288,
    ),
};

/** Units of world space covered by one texture repeat (0 = stretch once per face). */
export const TEX_SCALE: Record<string, number> = {
  ground: 512,
  concrete: 256,
  charcoal: 160,
  metal: 128,
  container: 0,
  crate: 0,
  wood: 96,
  carpet: 384,
  desk: 128,
  white: 384,
  tile: 96,
  plant: 64,
  sofa: 64,
  screen: 0,
};
