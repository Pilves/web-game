// Visual effects module for game juice
export class Effects {
  constructor() {
    this.arena = null;
    this.ripplePool = [];
    this.rippleIndex = 0;
    this.flashPool = [];
    this.flashIndex = 0;
    this.pendingTimeouts = [];
    this.initialized = false;
  }

  init() {
    this.arena = document.getElementById('arena');
    if (!this.arena) return;

    // Pre-allocate ripple elements with Effects-specific class
    // Use 'effects-ripple' class to avoid conflicts with Renderer's 'sound-ripple' pool
    // Each class manages its own separate pool of ripple elements
    const existingEffectsRipples = this.arena.querySelectorAll('.effects-ripple');
    if (existingEffectsRipples.length > 0) {
      // Reuse existing Effects ripples if they exist
      this.ripplePool = Array.from(existingEffectsRipples);
    } else {
      // Create new ripples for Effects class only
      for (let i = 0; i < 30; i++) {
        const el = document.createElement('div');
        el.className = 'effects-ripple sound-ripple'; // effects-ripple for identification, sound-ripple for styling
        this.arena.appendChild(el);
        this.ripplePool.push(el);
      }
    }

    // Pre-allocate impact flash elements
    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.className = 'impact-flash';
      el.style.display = 'none';
      this.arena.appendChild(el);
      this.flashPool.push(el);
    }

    this.initialized = true;
  }

  // Show a sound ripple at position
  showSoundRipple(x, y, type = 'footstep') {
    if (!this.arena || this.ripplePool.length === 0) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    // Get next ripple from pool (circular)
    const el = this.ripplePool[this.rippleIndex];
    this.rippleIndex = (this.rippleIndex + 1) % this.ripplePool.length;

    // Reset and position
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.transform = '';  // Reset transform
    el.style.opacity = '';    // Reset opacity
    el.className = `sound-ripple active ${type}`;

    // Remove active class after animation
    const timeoutId = setTimeout(() => {
      el.classList.remove('active');
      this.removeTimeout(timeoutId);
    }, 500);
    this.pendingTimeouts.push(timeoutId);
  }

  // Trigger muzzle flash (whole arena lights up briefly)
  triggerMuzzleFlash() {
    if (!this.arena) return;

    this.arena.classList.add('muzzle-flash');
    const timeoutId = setTimeout(() => {
      this.arena.classList.remove('muzzle-flash');
      this.removeTimeout(timeoutId);
    }, 100);
    this.pendingTimeouts.push(timeoutId);
  }

  // Show impact flash at position (using object pool)
  showImpactFlash(x, y) {
    if (!this.arena || this.flashPool.length === 0) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    // Get next flash element from pool (circular)
    const el = this.flashPool[this.flashIndex];
    this.flashIndex = (this.flashIndex + 1) % this.flashPool.length;

    // Position and show with proper animation reset
    el.style.left = `${x - 30}px`;
    el.style.top = `${y - 30}px`;
    el.style.display = 'block';

    // Proper animation reset pattern: remove class, force reflow, then add class
    el.classList.remove('active');
    void el.offsetWidth;  // Force reflow to reset animation
    el.style.transform = '';
    el.style.opacity = '';
    el.classList.add('active');

    // Hide after animation
    const timeoutId = setTimeout(() => {
      el.style.display = 'none';
      el.classList.remove('active');
      this.removeTimeout(timeoutId);
    }, 150);
    this.pendingTimeouts.push(timeoutId);
  }

  // Trigger screen shake
  triggerScreenShake() {
    if (!this.arena) return;

    this.arena.classList.add('shake');
    const timeoutId = setTimeout(() => {
      this.arena.classList.remove('shake');
      this.removeTimeout(timeoutId);
    }, 200);
    this.pendingTimeouts.push(timeoutId);
  }

  // Show death effect for a player element
  showDeathEffect(playerElement) {
    if (!playerElement) return;

    playerElement.classList.add('dying');

    // Remove after animation
    const timeoutId = setTimeout(() => {
      playerElement.classList.remove('dying');
      playerElement.style.display = 'none';
      this.removeTimeout(timeoutId);
    }, 500);
    this.pendingTimeouts.push(timeoutId);
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

  // Helper to remove timeout ID from tracking array
  removeTimeout(timeoutId) {
    const index = this.pendingTimeouts.indexOf(timeoutId);
    if (index > -1) {
      this.pendingTimeouts.splice(index, 1);
    }
  }

  // Clear all effects (on game end)
  clear() {
    if (!this.arena) return;

    // Clear all pending timeouts to prevent memory leaks
    this.pendingTimeouts.forEach(id => clearTimeout(id));
    this.pendingTimeouts = [];

    this.arena.classList.remove('muzzle-flash', 'shake');

    // Reset all ripples - complete style reset to prevent stale visual state
    this.ripplePool.forEach(el => {
      el.classList.remove('active');
      el.style.transform = '';  // Reset any transform applied during animation
      el.style.opacity = '';    // Reset any opacity changes
    });
    this.rippleIndex = 0;  // Reset pool index

    // Reset all pooled impact flashes - complete style reset
    this.flashPool.forEach(el => {
      el.style.display = 'none';
      el.classList.remove('active');
      el.style.transform = '';  // Reset any transform applied during animation
      el.style.opacity = '';    // Reset any opacity changes
    });
    this.flashIndex = 0;  // Reset pool index
  }
}

// Export singleton instance
export const effects = new Effects();
