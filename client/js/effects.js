// Visual effects module for game juice
export class Effects {
  constructor() {
    this.arena = null;
    this.ripplePool = [];
    this.rippleIndex = 0;
    this.flashPool = [];
    this.flashIndex = 0;
    this.pendingTimeouts = new Set();
    this.initialized = false;
  }

  init() {
    this.arena = document.getElementById('arena');
    if (!this.arena) return;

    const existingEffectsRipples = this.arena.querySelectorAll('.effects-ripple');
    if (existingEffectsRipples.length > 0) {
      this.ripplePool = Array.from(existingEffectsRipples);
    } else {
      for (let i = 0; i < 30; i++) {
        const el = document.createElement('div');
        el.className = 'effects-ripple sound-ripple';
        this.arena.appendChild(el);
        this.ripplePool.push(el);
      }
    }

    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.className = 'impact-flash';
      el.style.display = 'none';
      this.arena.appendChild(el);
      this.flashPool.push(el);
    }

    this.initialized = true;
  }

  showSoundRipple(x, y, type = 'footstep') {
    if (!this.arena || this.ripplePool.length === 0) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const el = this.ripplePool[this.rippleIndex];
    this.rippleIndex = (this.rippleIndex + 1) % this.ripplePool.length;

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.transform = '';
    el.style.opacity = '';
    el.className = `sound-ripple active ${type}`;

    const timeoutId = setTimeout(() => {
      el.classList.remove('active');
      this.removeTimeout(timeoutId);
    }, 500);
    this.pendingTimeouts.add(timeoutId);
  }

  triggerMuzzleFlash() {
    if (!this.arena) return;

    this.arena.classList.add('muzzle-flash');
    const timeoutId = setTimeout(() => {
      this.arena.classList.remove('muzzle-flash');
      this.removeTimeout(timeoutId);
    }, 100);
    this.pendingTimeouts.add(timeoutId);
  }

  showImpactFlash(x, y) {
    if (!this.arena || this.flashPool.length === 0) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const el = this.flashPool[this.flashIndex];
    this.flashIndex = (this.flashIndex + 1) % this.flashPool.length;

    el.style.left = `${x - 30}px`;
    el.style.top = `${y - 30}px`;
    el.style.display = 'block';

    el.classList.remove('active');
    void el.offsetWidth;
    el.style.transform = '';
    el.style.opacity = '';
    el.classList.add('active');

    const timeoutId = setTimeout(() => {
      el.style.display = 'none';
      el.classList.remove('active');
      this.removeTimeout(timeoutId);
    }, 150);
    this.pendingTimeouts.add(timeoutId);
  }

  triggerScreenShake() {
    if (!this.arena) return;

    this.arena.classList.add('shake');
    const timeoutId = setTimeout(() => {
      this.arena.classList.remove('shake');
      this.removeTimeout(timeoutId);
    }, 200);
    this.pendingTimeouts.add(timeoutId);
  }

  showDeathEffect(playerElement) {
    if (!playerElement) return;

    playerElement.classList.add('dying');

    const timeoutId = setTimeout(() => {
      playerElement.classList.remove('dying');
      playerElement.style.display = 'none';
      this.removeTimeout(timeoutId);
    }, 500);
    this.pendingTimeouts.add(timeoutId);
  }

  setInvincible(playerElement, isInvincible) {
    if (!playerElement) return;

    if (isInvincible) {
      playerElement.classList.add('invincible');
    } else {
      playerElement.classList.remove('invincible');
    }
  }

  removeTimeout(timeoutId) {
    this.pendingTimeouts.delete(timeoutId);
  }

  clear() {
    if (!this.arena) return;

    this.pendingTimeouts.forEach(id => clearTimeout(id));
    this.pendingTimeouts.clear();

    this.arena.classList.remove('muzzle-flash', 'shake');

    this.ripplePool.forEach(el => {
      el.classList.remove('active');
      el.style.transform = '';
      el.style.opacity = '';
    });
    this.rippleIndex = 0;

    this.flashPool.forEach(el => {
      el.style.display = 'none';
      el.classList.remove('active');
      el.style.transform = '';
      el.style.opacity = '';
    });
    this.flashIndex = 0;
  }
}

export const effects = new Effects();
