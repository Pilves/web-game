// Visual effects module for game juice
export class Effects {
  constructor() {
    this.arena = null;
    this.ripplePool = [];
    this.rippleIndex = 0;
    this.initialized = false;
  }

  init() {
    this.arena = document.getElementById('arena');
    if (!this.arena) return;

    // Pre-allocate ripple elements
    for (let i = 0; i < 30; i++) {
      const el = document.createElement('div');
      el.className = 'sound-ripple';
      this.arena.appendChild(el);
      this.ripplePool.push(el);
    }

    this.initialized = true;
  }

  // Show a sound ripple at position
  showSoundRipple(x, y, type = 'footstep') {
    if (!this.initialized) return;

    // Get next ripple from pool (circular)
    const el = this.ripplePool[this.rippleIndex];
    this.rippleIndex = (this.rippleIndex + 1) % this.ripplePool.length;

    // Reset and position
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.className = `sound-ripple active ${type}`;

    // Remove active class after animation
    setTimeout(() => {
      el.classList.remove('active');
    }, 500);
  }

  // Trigger muzzle flash (whole arena lights up briefly)
  triggerMuzzleFlash() {
    if (!this.arena) return;

    this.arena.classList.add('muzzle-flash');
    setTimeout(() => {
      this.arena.classList.remove('muzzle-flash');
    }, 100);
  }

  // Show impact flash at position
  showImpactFlash(x, y) {
    if (!this.arena) return;

    const el = document.createElement('div');
    el.className = 'impact-flash';
    el.style.left = `${x - 30}px`;
    el.style.top = `${y - 30}px`;
    this.arena.appendChild(el);

    // Remove after animation
    setTimeout(() => {
      if (el.parentNode) {
        el.remove();
      }
    }, 150);
  }

  // Trigger screen shake
  triggerScreenShake() {
    if (!this.arena) return;

    this.arena.classList.add('shake');
    setTimeout(() => {
      this.arena.classList.remove('shake');
    }, 200);
  }

  // Show death effect for a player element
  showDeathEffect(playerElement) {
    if (!playerElement) return;

    playerElement.classList.add('dying');

    // Remove after animation
    setTimeout(() => {
      playerElement.classList.remove('dying');
      playerElement.style.display = 'none';
    }, 500);
  }

  // Set invincibility effect on player
  setInvincible(playerElement, isInvincible) {
    if (!playerElement) return;

    if (isInvincible) {
      playerElement.classList.add('invincible');
    } else {
      playerElement.classList.remove('invincible');
    }
  }

  // Clear all effects (on game end)
  clear() {
    if (!this.arena) return;

    this.arena.classList.remove('muzzle-flash', 'shake');

    // Reset all ripples
    this.ripplePool.forEach(el => {
      el.classList.remove('active');
    });

    // Remove any lingering impact flashes
    const flashes = this.arena.querySelectorAll('.impact-flash');
    flashes.forEach(el => el.remove());
  }
}

// Export singleton instance
export const effects = new Effects();
