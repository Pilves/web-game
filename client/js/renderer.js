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
    this.pendingTimeouts = new Set(); // Track timeouts for cleanup (Set for O(1) operations)
    this.pickupElements = {}; // Track pickup elements by ID (LOW-17: reuse instead of create/destroy)
    this.trackedPickupIds = new Set(); // Track pickup IDs to detect removed pickups (HIGH-11)
    this.impactFlashPool = []; // Pool for impact flash elements (LOW-24)

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

    // Pre-allocate ripple elements with animation state tracking (MED-17)
    for (let i = 0; i < 30; i++) {
      const el = document.createElement('div');
      el.className = 'sound-ripple';
      this.arena.appendChild(el);
      this.ripplePool.push({ el, animating: false, timeoutId: null });
    }

    // Pre-allocate impact flash elements (LOW-24)
    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.className = 'impact-flash';
      el.style.display = 'none';
      this.arena.appendChild(el);
      this.impactFlashPool.push({ el, active: false, timeoutId: null });
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
    if (CONFIG.DEBUG && (this._renderCount === 1 || this._renderCount % 60 === 0)) {
      console.log('[Renderer] render #' + this._renderCount + ':', {
        hasArena: !!this.arena,
        playerCount: currState.p?.length,
        hasLocalPlayer: !!localPlayer,
        playerElements: Object.keys(this.playerElements).length
      });
    }

    // Interpolation factor: 50ms between server updates
    // Defensive check: prevent division by zero if INTERPOLATION_DELAY is 0 or falsy
    const interpolationDelay = CONFIG.INTERPOLATION_DELAY || 1;
    const t = Math.min(stateTime / interpolationDelay, 1);

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
        const [id, x, y, facing, flashlight, hearts, hasAmmo, stunned, invincible, flashlightOnSince] = pData;
        // Use String(id) for consistent type handling - Object.keys() returns strings
        currentPlayerIds.add(String(id));

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
        }, flashlightOnSince);
      }
    }

    // Cleanup players who left
    // Note: Object.keys() returns strings, so we use String() when adding to currentPlayerIds
    // to ensure consistent type comparison throughout (all IDs as strings)
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
    // Defensive check: arena could be null if DOM element was removed
    if (this.arena) {
      if (currState.mf) {
        this.arena.classList.add('muzzle-flash');
      } else {
        this.arena.classList.remove('muzzle-flash');
      }
    }
  }

  renderPlayer(id, x, y, facing, flashlightOn, invincible, playerData, flashlightOnSince = 0) {
    let cached = this.playerElements[id];

    // Validate cached element is still in DOM
    if (cached && !cached.root.isConnected) {
      delete this.playerElements[id];
      cached = null;
    }

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

    // Z-index based on Y position for depth sorting (HIGH-5: CSS expects players at 40)
    // Only update z-index when Y crosses a 100px boundary (optimization)
    const zBucket = Math.floor(y / 100);
    if (cached.lastZBucket !== zBucket) {
      el.style.zIndex = 40 + zBucket;
      cached.lastZBucket = zBucket;
    }

    // Rotation for direction indicator (use cached reference)
    // MED-20: Include translateY(-50%) to preserve vertical centering with rotation
    // LOW-22: Check isConnected to ensure element is still in DOM
    if (cached.direction) {
      if (cached.direction.isConnected) {
        cached.direction.style.transform = `translateY(-50%) rotate(${facing}rad)`;
      } else {
        // Element was unexpectedly removed from DOM - attempt to re-query
        console.warn(`[Renderer] Direction indicator for player ${id} disconnected, re-querying`);
        cached.direction = el.querySelector('.player-direction');
        if (cached.direction) {
          cached.direction.style.transform = `translateY(-50%) rotate(${facing}rad)`;
        } else {
          // Element structure is corrupted - direction indicator not found in DOM
          console.error(`[Renderer] Direction indicator for player ${id} not found after re-query. ` +
            `Element structure may be corrupted. Root element innerHTML: ${el.innerHTML.substring(0, 100)}...`);
        }
      }
    } else {
      // cached.direction was null/undefined from the start - element structure issue
      console.warn(`[Renderer] Direction indicator reference for player ${id} is null. ` +
        `Attempting to recover from element structure.`);
      cached.direction = el.querySelector('.player-direction');
      if (cached.direction) {
        cached.direction.style.transform = `translateY(-50%) rotate(${facing}rad)`;
      } else {
        console.error(`[Renderer] Failed to recover direction indicator for player ${id}. ` +
          `Element structure corrupted.`);
      }
    }

    // Flashlight cone and class (use cached reference)
    // LOW-22: Check isConnected to ensure element is still in DOM
    el.classList.toggle('flashlight-on', !!flashlightOn);
    if (cached.cone) {
      if (cached.cone.isConnected) {
        if (flashlightOn) {
          cached.cone.style.display = 'block';
          cached.cone.style.transform = `rotate(${facing}rad)`;
        } else {
          cached.cone.style.display = 'none';
        }
      } else {
        // Element was unexpectedly removed from DOM - attempt to re-query
        console.warn(`[Renderer] Flashlight cone for player ${id} disconnected, re-querying`);
        cached.cone = el.querySelector('.flashlight-cone');
        if (cached.cone) {
          if (flashlightOn) {
            cached.cone.style.display = 'block';
            cached.cone.style.transform = `rotate(${facing}rad)`;
          } else {
            cached.cone.style.display = 'none';
          }
        }
      }
    }

    // Flashlight flickering effect (when on for too long)
    const shouldFlicker = flashlightOn && flashlightOnSince > 0 &&
      (Date.now() - flashlightOnSince >= CONFIG.FLASHLIGHT_FLICKER_THRESHOLD);
    el.classList.toggle('flashlight-flickering', shouldFlicker);

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
    // HIGH-12: Hide inactive projectiles BEFORE early return to reset state between frames
    // This ensures projectiles are hidden even when currState.j is empty/undefined
    this.projectilePool.forEach(p => {
      p.active = false;
    });

    // Skip if no projectiles - but inactive projectiles are already marked above
    if (!currState.j) {
      // Hide all projectiles since there are none in current state
      this.projectilePool.forEach(p => {
        p.el.style.display = 'none';
        p.id = null;
      });
      return;
    }

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

      // Interpolate projectile positions with wrap-around support
      if (prevProjectileMap) {
        const prev = prevProjectileMap.get(id);
        if (prev) {
          renderX = this.lerpWrap(prev[1], x, t, CONFIG.ARENA_WIDTH);
          renderY = this.lerpWrap(prev[2], y, t, CONFIG.ARENA_HEIGHT);
        }
      }

      // Find or assign pool element
      // MED-16: Add null check for poolItem to prevent null pointer exceptions
      let poolItem = this.projectilePool.find(p => p.id === id);
      if (!poolItem) {
        poolItem = this.projectilePool.find(p => !p.active);
        if (poolItem) {
          poolItem.id = id;
        } else {
          // Pool exhausted - log warning
          console.warn('[Renderer] Projectile pool exhausted, projectile', id, 'not rendered');
          continue; // Skip this projectile
        }
      }

      // MED-16: Additional safety check - poolItem should never be undefined here
      // but guard against edge cases
      if (!poolItem || !poolItem.el) {
        console.warn('[Renderer] Invalid pool item for projectile', id);
        continue;
      }

      poolItem.active = true;
      poolItem.el.style.display = 'block';
      poolItem.el.style.transform = `translate3d(${renderX - CONFIG.PROJECTILE_SIZE / 2}px, ${renderY - CONFIG.PROJECTILE_SIZE / 2}px, 0)`;
      // HIGH-5: CSS expects projectiles at z-index 30
      // Only update z-index when Y crosses a 100px boundary
      const zBucket = Math.floor(renderY / 100);
      if (poolItem.lastZBucket !== zBucket) {
        poolItem.el.style.zIndex = 30 + zBucket;
        poolItem.lastZBucket = zBucket;
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

    // HIGH-11: Track current pickup IDs to detect removed pickups
    const currentPickupIds = new Set();

    for (const pickup of pickups) {
      const [id, x, y, active] = pickup;
      currentPickupIds.add(id);

      // Validate coordinates - skip pickups with invalid positions
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
        console.warn('[Renderer] Pickup has invalid coordinates:', { id, x, y, active });
        continue;
      }

      // LOW-17: Reuse pickup elements instead of creating/destroying on respawn
      let el = this.pickupElements[id];

      // Validate cached element is still in DOM (like player elements)
      if (el && !el.isConnected) {
        delete this.pickupElements[id];
        el = null;
      }

      if (!el) {
        el = document.createElement('div');
        el.id = `pickup-${id}`;
        el.className = 'pillow-pickup';
        // Set initial position BEFORE appending to avoid flash at (0,0)
        el.style.left = `${x - CONFIG.PICKUP_SIZE / 2}px`;
        el.style.top = `${y - CONFIG.PICKUP_SIZE / 2}px`;
        el.style.display = active ? 'block' : 'none';
        this.arena.appendChild(el);
        this.pickupElements[id] = el;
      }

      // Show/hide based on active state
      if (active) {
        el.style.display = 'block';
        // Use left/top for positioning instead of transform (transform is used by float animation)
        // Centering calculation uses PICKUP_SIZE/2 to center the element at the pickup's (x,y) coordinate
        el.style.left = `${x - CONFIG.PICKUP_SIZE / 2}px`;
        el.style.top = `${y - CONFIG.PICKUP_SIZE / 2}px`;
        // HIGH-5: CSS expects pickups at z-index 20
        el.style.zIndex = 20 + Math.floor(y / 100);
      } else {
        // Hide inactive pickups instead of removing (LOW-17: element reuse)
        el.style.display = 'none';
      }
    }

    // HIGH-11: Remove elements for pickups no longer in state (memory leak fix)
    for (const id of this.trackedPickupIds) {
      if (!currentPickupIds.has(id)) {
        const el = this.pickupElements[id];
        if (el && el.parentNode) {
          el.remove();
        }
        delete this.pickupElements[id];
      }
    }
    this.trackedPickupIds = currentPickupIds;
  }

  showSoundRipple(x, y, type = 'footstep') {
    // MED-17: Find a ripple that is not currently animating to avoid race conditions
    let poolItem = null;
    let startIndex = this.rippleIndex;

    // Try to find a non-animating ripple
    // Note: This loop uses index-based access rather than iterators, so it is safe
    // from concurrent modification issues. The pool array is not modified during iteration.
    for (let i = 0; i < this.ripplePool.length; i++) {
      const idx = (startIndex + i) % this.ripplePool.length;
      if (!this.ripplePool[idx].animating) {
        poolItem = this.ripplePool[idx];
        this.rippleIndex = (idx + 1) % this.ripplePool.length;
        break;
      }
    }

    // If all are animating, force reuse the next one
    if (!poolItem) {
      poolItem = this.ripplePool[this.rippleIndex];
      this.rippleIndex = (this.rippleIndex + 1) % this.ripplePool.length;
      // Cancel previous timeout to prevent race condition
      if (poolItem.timeoutId !== null) {
        clearTimeout(poolItem.timeoutId);
        this.pendingTimeouts.delete(poolItem.timeoutId);
      }
    }

    const el = poolItem.el;
    poolItem.animating = true;

    // Reset and position
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.className = `sound-ripple active ${type}`;

    // Remove active class after animation (track timeout for cleanup)
    // LOW-19: Use Set for O(1) add/delete operations
    const timeoutId = setTimeout(() => {
      el.classList.remove('active');
      poolItem.animating = false;
      poolItem.timeoutId = null;
      // Remove from pending timeouts Set (O(1) operation)
      this.pendingTimeouts.delete(timeoutId);
    }, 500);
    poolItem.timeoutId = timeoutId;
    this.pendingTimeouts.add(timeoutId);
  }

  triggerMuzzleFlash() {
    this.arena.classList.add('muzzle-flash');
    // MED-10: Track muzzle flash timeout for cleanup on disconnect
    const timeoutId = setTimeout(() => {
      this.arena.classList.remove('muzzle-flash');
      this.pendingTimeouts.delete(timeoutId);
    }, 100);
    this.pendingTimeouts.add(timeoutId);
  }

  showImpactFlash(x, y) {
    // LOW-24: Use pool for impact flash elements instead of creating/destroying
    const MAX_IMPACT_FLASH_POOL_SIZE = 20; // Maximum pool size to prevent unbounded growth
    let poolItem = this.impactFlashPool.find(p => !p.active);

    if (!poolItem) {
      // Pool exhausted - check if we can grow the pool or must reuse oldest
      if (this.impactFlashPool.length < MAX_IMPACT_FLASH_POOL_SIZE) {
        // Create a new element if under max pool size
        const el = document.createElement('div');
        el.className = 'impact-flash';
        el.style.display = 'none';
        this.arena.appendChild(el);
        poolItem = { el, active: false, timeoutId: null };
        this.impactFlashPool.push(poolItem);
      } else {
        // Pool at max size - reuse oldest active element (first in array)
        // SAFETY NOTE: The push(shift()) operation is safe here because:
        // 1. This code path only executes when no inactive element was found via find()
        // 2. The find() operation completed before we reach this branch
        // 3. No iterator is active on impactFlashPool at this point
        // 4. The poolItem reference is captured BEFORE the array modification
        poolItem = this.impactFlashPool[0];
        // Move to end of array to implement LRU behavior
        this.impactFlashPool.push(this.impactFlashPool.shift());
        // Cancel previous timeout to prevent race condition
        if (poolItem.timeoutId !== null) {
          clearTimeout(poolItem.timeoutId);
          this.pendingTimeouts.delete(poolItem.timeoutId);
        }
        console.warn('[Renderer] Impact flash pool exhausted, reusing oldest element');
      }
    }

    const el = poolItem.el;
    poolItem.active = true;
    el.style.display = 'block';
    el.style.left = `${x - 30}px`;
    el.style.top = `${y - 30}px`;
    // Force reflow to restart animation
    el.classList.remove('impact-flash');
    void el.offsetWidth;
    el.classList.add('impact-flash');

    // Return to pool after animation (track timeout for cleanup)
    const timeoutId = setTimeout(() => {
      el.style.display = 'none';
      poolItem.active = false;
      poolItem.timeoutId = null;
      this.pendingTimeouts.delete(timeoutId);
    }, 150);
    poolItem.timeoutId = timeoutId;
    this.pendingTimeouts.add(timeoutId);
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
      // Use ((result % max) + max) % max to handle negative modulo results in JS
      const result = this.lerp(a + max, b, t);
      return ((result % max) + max) % max;
    } else if (diff < -halfMax) {
      // a wrapped from max to 0, so adjust b
      // Use ((result % max) + max) % max to handle negative modulo results in JS
      const result = this.lerp(a, b + max, t);
      return ((result % max) + max) % max;
    }

    return this.lerp(a, b, t);
  }

  cleanupPlayer(id) {
    const cached = this.playerElements[id];
    if (cached) {
      // Remove from DOM
      if (cached.root && cached.root.parentNode) {
        cached.root.remove();
      }
      // Null out references to prevent memory leaks
      cached.root = null;
      cached.body = null;
      cached.direction = null;
      cached.cone = null;
      delete this.playerElements[id];
    }
  }

  // Clear all pickup elements
  clearPickups() {
    if (!this.arena) return;
    // Remove from DOM using tracked references (more reliable than querySelectorAll)
    for (const id of Object.keys(this.pickupElements)) {
      const el = this.pickupElements[id];
      if (el && el.parentNode) {
        el.remove();
      }
    }
    // Also query DOM in case any elements weren't tracked
    const pickups = this.arena.querySelectorAll('[id^="pickup-"]');
    pickups.forEach(el => el.remove());
    // Clear tracking objects
    this.pickupElements = {};
    this.trackedPickupIds.clear();
  }

  // Clear all rendered elements (on game end)
  clear() {
    // Clear all pending timeouts to prevent leaks (LOW-19: Set iteration)
    for (const timeoutId of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts = new Set();

    // Clear all players
    for (const id of Object.keys(this.playerElements)) {
      this.cleanupPlayer(id);
    }

    // Clear all pickups (including tracked elements)
    // Note: clearPickups() now handles clearing pickupElements and trackedPickupIds
    this.clearPickups();

    // Hide all projectiles
    this.projectilePool.forEach(p => {
      p.el.style.display = 'none';
      p.active = false;
      p.id = null;
    });

    // Reset all ripples (MED-17: reset animation state)
    this.ripplePool.forEach(poolItem => {
      poolItem.el.classList.remove('active');
      poolItem.animating = false;
      poolItem.timeoutId = null;
    });
    this.rippleIndex = 0;

    // Reset all impact flashes (LOW-24)
    this.impactFlashPool.forEach(poolItem => {
      poolItem.el.style.display = 'none';
      poolItem.active = false;
      poolItem.timeoutId = null;
    });
  }

  // Fully destroy the renderer, removing all pool elements from DOM
  destroy() {
    // First clear all state and timeouts
    this.clear();

    // Remove all pool elements from DOM
    this.projectilePool.forEach(poolItem => {
      if (poolItem.el && poolItem.el.parentNode) {
        poolItem.el.remove();
      }
      poolItem.el = null;
    });
    this.projectilePool = [];

    this.ripplePool.forEach(poolItem => {
      if (poolItem.el && poolItem.el.parentNode) {
        poolItem.el.remove();
      }
      poolItem.el = null;
    });
    this.ripplePool = [];

    this.impactFlashPool.forEach(poolItem => {
      if (poolItem.el && poolItem.el.parentNode) {
        poolItem.el.remove();
      }
      poolItem.el = null;
    });
    this.impactFlashPool = [];

    // Clear game reference
    this.game = null;
    this.arena = null;
  }
}
