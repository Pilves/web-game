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
    this.pendingTimeouts = []; // Track timeouts for cleanup

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

    // Build Map from prevState for O(1) lookups (instead of Array.find O(n))
    let prevPlayerMap = null;
    if (prevState && prevState.p) {
      prevPlayerMap = new Map();
      for (const p of prevState.p) {
        prevPlayerMap.set(p[0], p);
      }
    }

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
        } else if (prevPlayerMap) {
          const prev = prevPlayerMap.get(id);
          if (prev) {
            // Use wrap-aware interpolation to handle arena edge wrapping
            renderX = this.lerpWrap(prev[1], x, t, CONFIG.ARENA_WIDTH);
            renderY = this.lerpWrap(prev[2], y, t, CONFIG.ARENA_HEIGHT);
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
    let cached = this.playerElements[id];

    // Create player element if it doesn't exist
    if (!cached) {
      const el = document.createElement('div');
      el.className = 'player';
      el.dataset.id = id;
      el.innerHTML = `
        <div class="player-body"></div>
        <div class="player-direction"></div>
        <div class="flashlight-cone"></div>
      `;
      this.arena.appendChild(el);

      // Cache element and child references to avoid querySelector every frame
      cached = {
        root: el,
        body: el.querySelector('.player-body'),
        direction: el.querySelector('.player-direction'),
        cone: el.querySelector('.flashlight-cone')
      };
      this.playerElements[id] = cached;
    }

    const el = cached.root;

    // Position via transform3d (GPU accelerated)
    el.style.transform = `translate3d(${x - CONFIG.PLAYER_SIZE / 2}px, ${y - CONFIG.PLAYER_SIZE / 2}px, 0)`;

    // Z-index based on Y position for depth sorting
    el.style.zIndex = Math.floor(y);

    // Rotation for direction indicator (use cached reference)
    if (cached.direction) {
      cached.direction.style.transform = `rotate(${facing}rad)`;
    }

    // Flashlight cone and class (use cached reference)
    el.classList.toggle('flashlight-on', !!flashlightOn);
    if (cached.cone) {
      if (flashlightOn) {
        cached.cone.style.display = 'block';
        cached.cone.style.transform = `rotate(${facing}rad)`;
      } else {
        cached.cone.style.display = 'none';
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

    // Set player color from lobby data (use cached reference)
    const playerInfo = this.game.lobbyData?.players?.find(p => p.id === id);
    if (playerInfo && playerInfo.color && cached.body) {
      cached.body.style.backgroundColor = playerInfo.color;
    }
  }

  renderProjectiles(prevState, currState, t) {
    // Mark all as inactive
    this.projectilePool.forEach(p => {
      p.active = false;
    });

    // Skip if no projectiles
    if (!currState.j) return;

    if (currState.j.length > 0) {
      if (this._projLogCount === undefined) this._projLogCount = 0;
      if (this._projLogCount < 10) {
        console.log('[Renderer] renderProjectiles:', currState.j.map(p => ({id: p[0], x: p[1], y: p[2]})));
        this._projLogCount++;
      }
    }

    // Build Map from prevState projectiles for O(1) lookups
    let prevProjectileMap = null;
    if (prevState && prevState.j) {
      prevProjectileMap = new Map();
      for (const p of prevState.j) {
        prevProjectileMap.set(p[0], p);
      }
    }

    for (const pData of currState.j) {
      const [id, x, y, vx, vy] = pData;

      let renderX = x;
      let renderY = y;

      // Interpolate projectile positions
      if (prevProjectileMap) {
        const prev = prevProjectileMap.get(id);
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

    if (this._pickupLogCount === undefined) this._pickupLogCount = 0;
    if (this._pickupLogCount < 5) {
      console.log('[Renderer] renderPickups:', pickups.map(p => ({id: p[0], x: p[1], y: p[2], active: p[3]})));
      this._pickupLogCount++;
    }

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

    // Remove active class after animation (track timeout for cleanup)
    const timeoutId = setTimeout(() => {
      el.classList.remove('active');
      // Remove from pending timeouts array
      const idx = this.pendingTimeouts.indexOf(timeoutId);
      if (idx > -1) {
        this.pendingTimeouts.splice(idx, 1);
      }
    }, 500);
    this.pendingTimeouts.push(timeoutId);
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

  // Wrap-aware lerp for positions that might wrap around arena edges
  lerpWrap(a, b, t, max) {
    const diff = b - a;
    const halfMax = max / 2;

    // If the difference is more than half the arena, they probably wrapped
    if (diff > halfMax) {
      // b wrapped from max to 0, so adjust a
      return this.lerp(a + max, b, t) % max;
    } else if (diff < -halfMax) {
      // a wrapped from max to 0, so adjust b
      return this.lerp(a, b + max, t) % max;
    }

    return this.lerp(a, b, t);
  }

  cleanupPlayer(id) {
    const cached = this.playerElements[id];
    if (cached) {
      cached.root.remove();
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
    // Clear all pending timeouts to prevent leaks
    for (const timeoutId of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts = [];

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
