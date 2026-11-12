import { BTN, DEG, MAX_PITCH, clamp, wrapAngle } from '@calindra-strike/shared';

/** Keyboard + mouse state. Uses `code` so WASD works on any keyboard layout. */
export class Input {
  private keys = new Set<string>();
  private mouse = 0;
  yaw = 0;
  pitch = 0;
  sensitivity = 2;
  zoomSensScale = 1;
  locked = false;
  /** Dev-only: behave as if the pointer were locked (automated browser tests). */
  debug = false;
  enabled = true;
  private weaponReq = 0;
  private wheelAcc = 0;
  lookDX = 0; // accumulated for viewmodel sway
  lookDY = 0;
  onKey: (code: string, down: boolean, e: KeyboardEvent) => boolean = () => false;
  private readonly el: HTMLElement;
  private readonly disposers: (() => void)[] = [];

  constructor(el: HTMLElement) {
    this.el = el;
    const on = <K extends keyof DocumentEventMap>(t: K, f: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      document.addEventListener(t, f as EventListener, opts);
      this.disposers.push(() => document.removeEventListener(t, f as EventListener, opts));
    };
    on('keydown', (e) => {
      if (this.onKey(e.code, true, e)) return;
      if (!this.enabled) return;
      if (this.locked && (e.code === 'Tab' || e.code === 'Space' || e.ctrlKey || e.code.startsWith('Arrow'))) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'Digit1':
          this.weaponReq = 1;
          break;
        case 'Digit2':
          this.weaponReq = 2;
          break;
        case 'Digit3':
          this.weaponReq = 3;
          break;
        case 'KeyQ':
          this.weaponReq = 4;
          break;
      }
    });
    on('keyup', (e) => {
      this.onKey(e.code, false, e);
      this.keys.delete(e.code);
    });
    on('mousedown', (e) => {
      if (!(this.locked || this.debug) || !this.enabled) return;
      this.mouse |= 1 << e.button;
    });
    on('mouseup', (e) => {
      this.mouse &= ~(1 << e.button);
    });
    on('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const k = this.sensitivity * 0.022 * DEG * this.zoomSensScale;
      this.yaw = wrapAngle(this.yaw - e.movementX * k);
      this.pitch = clamp(this.pitch - e.movementY * k, -MAX_PITCH, MAX_PITCH);
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
    on(
      'wheel',
      (e) => {
        if (!this.locked || !this.enabled) return;
        this.wheelAcc += e.deltaY;
        if (Math.abs(this.wheelAcc) > 40) {
          this.weaponReq = this.wheelAcc > 0 ? 5 : 6; // next / previous (resolved by the game)
          this.wheelAcc = 0;
        }
      },
      { passive: true },
    );
    on('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) this.releaseAll();
    });
    on('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    const blur = () => this.releaseAll();
    window.addEventListener('blur', blur);
    this.disposers.push(() => window.removeEventListener('blur', blur));
  }

  releaseAll(): void {
    this.keys.clear();
    this.mouse = 0;
  }

  async lock(): Promise<void> {
    try {
      // raw input when supported: no OS acceleration, like CS m_rawinput 1
      await (this.el.requestPointerLock as (o?: unknown) => Promise<void>).call(this.el, { unadjustedMovement: true });
    } catch {
      try {
        await this.el.requestPointerLock();
      } catch {
        /* user must click again (browser cooldown after Esc) */
      }
    }
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  buttons(): number {
    if (!this.enabled || !(this.locked || this.debug)) return 0;
    let b = 0;
    if (this.keys.has('KeyW')) b |= BTN.FWD;
    if (this.keys.has('KeyS')) b |= BTN.BACK;
    if (this.keys.has('KeyA')) b |= BTN.LEFT;
    if (this.keys.has('KeyD')) b |= BTN.RIGHT;
    if (this.keys.has('Space')) b |= BTN.JUMP;
    if (this.keys.has('ControlLeft') || this.keys.has('KeyC') || this.keys.has('ControlRight')) b |= BTN.DUCK;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) b |= BTN.WALK;
    if (this.keys.has('KeyE')) b |= BTN.USE;
    if (this.keys.has('KeyR')) b |= BTN.RELOAD;
    if (this.mouse & 1) b |= BTN.ATTACK;
    if (this.mouse & 4) b |= BTN.ATTACK2;
    return b;
  }

  takeWeaponRequest(): number {
    const r = this.weaponReq;
    this.weaponReq = 0;
    return r;
  }

  takeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
