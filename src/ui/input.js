import { INPUT } from '../game/race.js';

const KEYS = {
  KeyW: INPUT.THROTTLE,
  ArrowUp: INPUT.THROTTLE,
  KeyS: INPUT.BRAKE,
  ArrowDown: INPUT.BRAKE,
  KeyA: INPUT.LEFT,
  ArrowLeft: INPUT.LEFT,
  KeyD: INPUT.RIGHT,
  ArrowRight: INPUT.RIGHT,
  ShiftLeft: INPUT.NITRO,
  ShiftRight: INPUT.NITRO,
};

/** Keyboard + touch → digital control bits. Touch and keys combine. */
export class Input {
  constructor(touchRoot) {
    this.keys = 0;
    this.touch = 0;
    this.enabled = false;
    addEventListener('keydown', (e) => {
      if (!this.enabled || !KEYS[e.code] || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      e.preventDefault();
      this.keys |= KEYS[e.code];
    });
    addEventListener('keyup', (e) => {
      if (KEYS[e.code]) this.keys &= ~KEYS[e.code];
    });
    addEventListener('blur', () => this.clear());
    for (const btn of touchRoot.querySelectorAll('[data-input]')) {
      const bit = INPUT[btn.dataset.input];
      const press = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        this.touch |= bit;
        btn.classList.add('active');
      };
      const release = () => {
        this.touch &= ~bit;
        btn.classList.remove('active');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  get bits() {
    return this.enabled ? this.keys | this.touch : 0;
  }

  clear() {
    this.keys = 0;
    this.touch = 0;
  }
}

export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
