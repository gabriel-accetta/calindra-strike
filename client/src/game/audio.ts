import { WEAPON, type WeaponId } from '@calindra-strike/shared';

interface ShotVoice {
  noiseFreq: number;
  noiseQ: number;
  decay: number;
  thump: number;
  thumpDecay: number;
  tail: number;
  gain: number;
  crack: number;
}

const VOICES: Record<number, ShotVoice> = {
  [WEAPON.PISTOL]: { noiseFreq: 2400, noiseQ: 0.9, decay: 0.09, thump: 140, thumpDecay: 0.06, tail: 0.25, gain: 0.55, crack: 3200 },
  [WEAPON.RIFLE]: { noiseFreq: 1500, noiseQ: 0.7, decay: 0.13, thump: 95, thumpDecay: 0.09, tail: 0.45, gain: 0.75, crack: 2600 },
  [WEAPON.SMG]: { noiseFreq: 2100, noiseQ: 0.8, decay: 0.08, thump: 120, thumpDecay: 0.05, tail: 0.3, gain: 0.55, crack: 3000 },
  [WEAPON.SHOTGUN]: { noiseFreq: 900, noiseQ: 0.5, decay: 0.22, thump: 70, thumpDecay: 0.16, tail: 0.6, gain: 0.95, crack: 1800 },
  [WEAPON.SNIPER]: { noiseFreq: 1100, noiseQ: 0.6, decay: 0.25, thump: 60, thumpDecay: 0.2, tail: 1.1, gain: 1.0, crack: 4200 },
  [WEAPON.LMG]: { noiseFreq: 1300, noiseQ: 0.7, decay: 0.12, thump: 85, thumpDecay: 0.1, tail: 0.5, gain: 0.75, crack: 2400 },
};

type Pos = { x: number; y: number; z: number } | null;

/**
 * All sound effects are synthesized with WebAudio at runtime: no sampled
 * assets, nothing copyrighted, nothing to download.
 */
export class Sfx {
  readonly ctx: AudioContext;
  private master: GainNode;
  private noise: AudioBuffer;
  private wind: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private listenerPos = { x: 0, y: 0, z: 0 };

  constructor(volume: number) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.setVolume(volume);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.master.gain.value = v * 0.9;
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const l = this.ctx.listener;
    this.listenerPos = { x, y, z };
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Output node for a sound: positional (with distance muffling) or direct. */
  private out(pos: Pos, ref = 220): AudioNode {
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1.1;
    p.maxDistance = 8000;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    const dist = Math.hypot(pos.x - this.listenerPos.x, pos.y - this.listenerPos.y, pos.z - this.listenerPos.z);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(900, 16000 - dist * 7);
    lp.connect(p).connect(this.master);
    return lp;
  }

  private noiseBurst(dest: AudioNode, t: number, freq: number, q: number, attack: number, decay: number, gain: number, type: BiquadFilterType = 'bandpass'): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, attack = 0.002): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(weapon: WeaponId, pos: Pos, heavy = false): void {
    const t = this.ctx.currentTime;
    if (weapon === WEAPON.HAMMER) {
      const out = this.out(pos, 120);
      this.noiseBurst(out, t, heavy ? 700 : 1100, 0.6, 0.005, heavy ? 0.22 : 0.14, 0.35, 'bandpass');
      return;
    }
    const v = VOICES[weapon] ?? VOICES[WEAPON.RIFLE];
    const out = this.out(pos, 260);
    const g = pos ? v.gain : v.gain * 0.75;
    this.noiseBurst(out, t, v.crack, 1.2, 0.0008, 0.025, g * 0.8, 'highpass');
    this.noiseBurst(out, t, v.noiseFreq * (0.95 + Math.random() * 0.1), v.noiseQ, 0.001, v.decay, g, 'bandpass');
    this.tone(out, t, 'sine', v.thump * 1.6, v.thump * 0.6, v.thumpDecay, g * 0.9);
    this.noiseBurst(out, t + 0.01, 600, 0.4, 0.02, v.tail, g * 0.18, 'lowpass');
    if (weapon === WEAPON.SNIPER || weapon === WEAPON.SHOTGUN) {
      // bolt / pump mechanics after the shot (only audible up close)
      const mech = pos ? out : this.master;
      this.noiseBurst(mech, t + 0.42, 2600, 2, 0.002, 0.04, 0.12);
      this.noiseBurst(mech, t + 0.58, 1900, 2, 0.002, 0.05, 0.12);
    }
  }

  footstep(pos: Pos, loud = 1): void {
    const t = this.ctx.currentTime;
    const out = this.out(pos, 160);
    this.noiseBurst(out, t, 420 + Math.random() * 400, 1.4, 0.004, 0.07, 0.22 * loud);
    this.tone(out, t, 'sine', 95, 60, 0.06, 0.12 * loud);
  }

  jump(): void {
    const t = this.ctx.currentTime;
    this.noiseBurst(this.master, t, 700, 1, 0.005, 0.08, 0.08);
  }

  land(heavy: boolean, pos: Pos = null): void {
    const t = this.ctx.currentTime;
    const out = this.out(pos, 160);
    this.tone(out, t, 'sine', heavy ? 120 : 90, 45, heavy ? 0.18 : 0.1, heavy ? 0.35 : 0.18);
    this.noiseBurst(out, t, 500, 0.8, 0.004, heavy ? 0.15 : 0.08, heavy ? 0.25 : 0.14);
  }

  hitmarker(): void {
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 'triangle', 1700, 1500, 0.05, 0.16);
  }

  headshot(): void {
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 'sine', 2350, 2300, 0.35, 0.18);
    this.tone(this.master, t, 'sine', 3920, 3900, 0.22, 0.09);
    this.noiseBurst(this.master, t, 5000, 2, 0.001, 0.03, 0.12);
  }

  kill(streak: number): void {
    const t = this.ctx.currentTime;
    const base = 660 * 2 ** (Math.min(streak - 1, 5) / 12);
    this.tone(this.master, t, 'sine', base, base, 0.18, 0.2);
    this.tone(this.master, t + 0.08, 'sine', base * 1.5, base * 1.5, 0.3, 0.2);
  }

  hurt(): void {
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 'sine', 160, 70, 0.14, 0.3);
    this.noiseBurst(this.master, t, 300, 0.7, 0.003, 0.12, 0.2);
  }

  dryFire(): void {
    this.noiseBurst(this.master, this.ctx.currentTime, 3000, 3, 0.001, 0.03, 0.15);
  }

  reload(stage: number): void {
    const t = this.ctx.currentTime;
    const f = [1800, 2400, 3100][stage] ?? 2000;
    this.noiseBurst(this.master, t, f, 3, 0.001, 0.05, 0.2);
    this.tone(this.master, t, 'square', f / 4, f / 5, 0.03, 0.04);
  }

  /** Scope zoom click, like the CS 1.6 zoom sound. */
  zoom(): void {
    const t = this.ctx.currentTime;
    this.noiseBurst(this.master, t, 3600, 4, 0.001, 0.025, 0.16);
    this.tone(this.master, t, 'square', 900, 700, 0.03, 0.035);
  }

  deploy(): void {
    this.noiseBurst(this.master, this.ctx.currentTime, 2200, 2, 0.002, 0.06, 0.1);
  }

  airdrop(): void {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(380, t + i * 0.9);
      o.frequency.linearRampToValueAtTime(820, t + i * 0.9 + 0.75);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1800;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.9);
      g.gain.exponentialRampToValueAtTime(0.08, t + i * 0.9 + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.9 + 0.85);
      o.connect(f).connect(g).connect(this.master);
      o.start(t + i * 0.9);
      o.stop(t + i * 0.9 + 0.9);
    }
  }

  loot(): void {
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(this.master, t + i * 0.06, 'triangle', f, f, 0.25, 0.14));
  }

  beep(high = false): void {
    this.tone(this.master, this.ctx.currentTime, 'sine', high ? 1320 : 880, high ? 1320 : 880, 0.12, 0.15);
  }

  fanfare(): void {
    const t = this.ctx.currentTime;
    [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => {
      this.tone(this.master, t + i * 0.13, 'triangle', f, f, 0.32, 0.16);
      this.tone(this.master, t + i * 0.13, 'sine', f / 2, f / 2, 0.32, 0.08);
    });
  }

  click(): void {
    this.tone(this.master, this.ctx.currentTime, 'sine', 1200, 900, 0.04, 0.06);
  }

  /** Continuous wind while skydiving; level 0..1. */
  setWind(level: number): void {
    if (level <= 0.001) {
      if (this.wind) {
        this.wind.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      }
      return;
    }
    if (!this.wind) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.6;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      this.wind = { src, gain, filter };
    }
    const t = this.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(0.05 + level * 0.18, t, 0.1);
    this.wind.filter.frequency.setTargetAtTime(400 + level * 900, t, 0.1);
  }

  dispose(): void {
    void this.ctx.close();
  }
}
