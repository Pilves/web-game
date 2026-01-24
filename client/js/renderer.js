// DOM rendering with object pools
import { CONFIG } from './config.js';

export class Renderer {
  constructor(game) {
    console.log('[Renderer] Constructor called');
    this.game = game;
    this.arena = document.getElementById('arena');
    this.playerElements = {};
    this.projectilePool = [];
    this.ripplePool = [];
    this.rippleIndex = 0;

    console.log('[Renderer] Arena element:', this.arena ? 'found' : 'NOT FOUND');

    this.initPools();
    this._renderCount = 0;
  }

  initPools() {
    // Pre-allocate projectile elements
    for (let i = 0; i < 20; i++) {
      const el = document.createElement('div');
      el.className = 'projectile';
      el.style.display = 'none';
      this.arena.appendChild(el);
      this.projectilePool.push({ el, active: false, id: null });
    }

    // Pre-allocate ripple elements
    for (let i = 0; i < 30; i++) {
      const el = document.createElement('div');
      el.className = 'sound-ripple';
      this.arena.appendChild(el);
      this.ripplePool.push(el);
    }
  }

  render(prevState, currState, stateTime, localPlayer) {
    if (!currState) {
      if (this._renderCount === 0) {
        console.warn('[Renderer] render() called with no currState');
      }
      return;
    }

    this._renderCount++;
    if (this._renderCount === 1 || this._renderCount % 60 === 0) {
      console.log('[Renderer] render #' + this._renderCount + ':', {
        hasArena: !!this.arena,
        playerCount: currState.p?.length,
        hasLocalPlayer: !!localPlayer,
        playerElements: Object.keys(this.playerElements).length
      });
    }

    // Interpolation factor: 50ms between server updates
    const t = Math.min(stateTime / CONFIG.INTERPOLATION_DELAY, 1);

    // Track which players are in current state
    const currentPlayerIds = new Set();

    // Render players
    if (currState.p) {
      for (const pData of currState.p) {
        const [id, x, y, facing, flashlight, hearts, hasAmmo, stunned, invincible] = pData;
        currentPlayerIds.add(id);

        let renderX = x;
        let renderY = y;

        // Use predicted position for local player, interpolate others
        if (id === this.game.myId && localPlayer) {
          renderX = localPlayer.x;
          renderY = localPlayer.y;
        } else if (prevState && prevState.p) {
          const prev = prevState.p.find(p => p[0] === id);
          if (prev) {
            renderX = this.lerp(prev[1], x, t);
            renderY = this.lerp(prev[2], y, t);
          }
        }

        this.renderPlayer(id, renderX, renderY, facing, flashlight, invincible, {
          hearts,
          hasAmmo,
          stunned
        });
      }
    }

    // Cleanup players who left
    for (const id of Object.keys(this.playerElements)) {
      if (!currentPlayerIds.has(id)) {
        this.cleanupPlayer(id);
      }
    }

    // Render projectiles
    this.renderProjectiles(prevState, currState, t);

    // Render pickups
    this.renderPickups(currState.k);

    // Update visibility (handled by Vision class separately)
    if (this.game.vision) {
      this.game.vision.updateVisibility(currState, localPlayer);
    }

    // Handle muzzle flash state from server
    if (currState.mf) {
      this.arena.classList.add('muzzle-flash');
    } else {
      this.arena.classList.remove('muzzle-flash');
    }
  }

  renderPlayer(id, x, y, facing, flashlightOn, invincible, playerData) {
    let el = this.playerElements[id];

    // Create player element if it doesn't exist
    if (!el) {
      el = document.createElement('div');
      el.className = 'player';
      el.dataset.id = id;
      el.innerHTML = `
        <div class="player-body"></div>
        <div class="player-direction"></div>
        <div class="flashlight-cone"></div>
      `;
      this.arena.appendChild(el);
      this.playerElements[id] = el;
    }

    // Position via transform3d (GPU accelerated)
    el.style.transform = `translate3d(${x - CONFIG.PLAYER_SIZE / 2}px, ${y - CONFIG.PLAYER_SIZE / 2}px, 0)`;

    // Z-index based on Y position for depth sorting
    el.style.zIndex = Math.floor(y);

    // Rotation for direction indicator
    const dirEl = el.querySelector('.player-direction');
    if (dirEl) {
      dirEl.style.transform = `rotate(${facing}rad)`;
    }

    // Flashlight cone and class
    el.classList.toggle('flashlight-on', !!flashlightOn);
    const cone = el.querySelector('.flashlight-cone');
    if (cone) {
      if (flashlightOn) {
        cone.style.display = 'block';
        cone.style.transform = `rotate(${facing}rad)`;
      } else {
        cone.style.display = 'none';
      }
    }

    // Invincibility effect
    el.classList.toggle('invincible', !!invincible);

    // Mark self
    el.classList.toggle('self', id === this.game.myId);

    // Stunned effect
    if (playerData) {
      el.classList.toggle('stunned', !!playerData.stunned);
    }

    // Set player color from lobby data
    const playerInfo = this.game.lobbyData?.players?.find(p => p.id === id);
    if (playerInfo && playerInfo.color) {
      const bodyEl = el.querySelector('.player-body');
      if (bodyEl) {
        bodyEl.style.backgroundColor = playerInfo.color;
      }
    }
  }

  renderProjectiles(prevState, currState, t) {
    // Mark all as inactive
    this.projectilePool.forEach(p => {
      p.active = false;
    });

    // Skip if no projectiles
    if (!currState.j) return;

    for (const pData of currState.j) {
      const [id, x, y, vx, vy] = pData;

      let renderX = x;
      let renderY = y;

      // Interpolate projectile positions
      if (prevState && prevState.j) {
        const prev = prevState.j.find(p => p[0] === id);
        if (prev) {
          renderX = this.lerp(prev[1], x, t);
          renderY = this.lerp(prev[2], y, t);
        }
      }

      // Find or assign pool element
      let poolItem = this.projectilePool.find(p => p.id === id);
      if (!poolItem) {
        poolItem = this.projectilePool.find(p => !p.active);
        if (poolItem) {
          poolItem.id = id;
        }
      }

      if (poolItem) {
        poolItem.active = true;
        poolItem.el.style.display = 'block';
        poolItem.el.style.transform = `translate3d(${renderX - CONFIG.PROJECTILE_SIZE / 2}px, ${renderY - CONFIG.PROJECTILE_SIZE / 2}px, 0)`;
        poolItem.el.style.zIndex = Math.floor(renderY);
      }
    }

    // Hide inactive projectiles
    this.projectilePool.forEach(p => {
      if (!p.active) {
        p.el.style.display = 'none';
        p.id = null;
      }
    });
  }

  renderPickups(pickups) {
    if (!pickups) return;

    for (const pickup of pickups) {
      const [id, x, y, active] = pickup;

      // Find or create pickup element
      let el = document.getElementById(`pickup-${id}`);
      if (!el) {
        el = document.createElement('div');
        el.id = `pickup-${id}`;
        el.className = 'pillow-pickup';
        this.arena.appendChild(el);
      }

      // Show/hide based on active state
      if (active) {
        el.style.display = 'block';
        el.style.transform = `translate3d(${x - CONFIG.PICKUP_SIZE / 2}px, ${y - CONFIG.PICKUP_SIZE / 2}px, 0)`;
        el.style.zIndex = Math.floor(y);
      } else {
        el.style.display = 'none';
      }
    }
  }

  showSoundRipple(x, y, type = 'footstep') {
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

  triggerMuzzleFlash() {
    this.arena.classList.add('muzzle-flash');
    setTimeout(() => {
      this.arena.classList.remove('muzzle-flash');
    }, 100);
  }

  showImpactFlash(x, y) {
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

  lerp(a, b, t) {
    return a + (b - a) * t;
  }

  cleanupPlayer(id) {
    const el = this.playerElements[id];
    if (el) {
      el.remove();
      delete this.playerElements[id];
    }
  }

  // Clear all pickup elements
  clearPickups() {
    const pickups = this.arena.querySelectorAll('[id^="pickup-"]');
    pickups.forEach(el => el.remove());
  }

  // Clear all rendered elements (on game end)
  clear() {
    // Clear all players
    for (const id of Object.keys(this.playerElements)) {
      this.cleanupPlayer(id);
    }

    // Clear all pickups
    this.clearPickups();

    // Hide all projectiles
    this.projectilePool.forEach(p => {
      p.el.style.display = 'none';
      p.active = false;
      p.id = null;
    });

    // Reset all ripples
    this.ripplePool.forEach(el => {
      el.classList.remove('active');
    });
  }
}
