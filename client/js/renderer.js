// DOM rendering with object pools
import { CONFIG, debugLog } from './config.js';
import { ProjectilePool, RipplePool, ImpactFlashPool } from './pools.js';

export class Renderer {
  constructor(game) {
    debugLog('[Renderer]', 'Constructor called');
    this.game = game;
    this.arena = document.getElementById('arena');
    this.playerElements = {};
    this.pendingTimeouts = new Set(); // Track timeouts for cleanup (Set for O(1) operations)
    this.pickupElements = {}; // Track pickup elements by ID (LOW-17: reuse instead of create/destroy)
    this.trackedPickupIds = new Set(); // Track pickup IDs to detect removed pickups (HIGH-11)

    debugLog('[Renderer]', 'Arena element:', this.arena ? 'found' : 'NOT FOUND');

    // Initialize pool instances
    this.projectilePool = new ProjectilePool(this.arena);
    this.ripplePool = new RipplePool(this.arena, this.pendingTimeouts);
    this.impactFlashPool = new ImpactFlashPool(this.arena, this.pendingTimeouts);

    this._renderCount = 0;
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

    // Render projectiles (delegate to pool)
    this.projectilePool.render(prevState, currState, t, this.lerpWrap.bind(this));

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

  renderPickups(pickups) {
    if (!pickups) return;

    // Validate CONFIG.PICKUP_SIZE to prevent NaN positioning
    const pickupSize = CONFIG.PICKUP_SIZE;
    if (typeof pickupSize !== 'number' || !Number.isFinite(pickupSize) || pickupSize <= 0) {
      console.error('[Renderer] Invalid CONFIG.PICKUP_SIZE:', pickupSize, '- using fallback 30');
    }
    const halfSize = (typeof pickupSize === 'number' && Number.isFinite(pickupSize) && pickupSize > 0)
      ? pickupSize / 2
      : 15; // fallback: 30 / 2 = 15

    // Debug: log first 10 pickup renders to diagnose positioning issue
    if (CONFIG.DEBUG) {
      if (this._pickupLogCount === undefined) this._pickupLogCount = 0;
      if (this._pickupLogCount < 10) {
        debugLog('[Renderer]', 'renderPickups raw:', pickups);
        debugLog('[Renderer]', 'renderPickups type:', Array.isArray(pickups) ? 'array' : typeof pickups);
        debugLog('[Renderer]', 'First pickup raw:', pickups[0]);
        debugLog('[Renderer]', 'First pickup isArray:', Array.isArray(pickups[0]));
        if (pickups[0]) {
          debugLog('[Renderer]', 'First pickup values:', {
            idx0: pickups[0][0],
            idx1: pickups[0][1],
            idx2: pickups[0][2],
            idx3: pickups[0][3]
          });
        }
        debugLog('[Renderer]', 'CONFIG.PICKUP_SIZE:', CONFIG.PICKUP_SIZE, 'halfSize:', halfSize);
        this._pickupLogCount++;
      }
    }

    // HIGH-11: Track current pickup IDs to detect removed pickups
    const currentPickupIds = new Set();

    for (const pickup of pickups) {
      // Support both array format [id, x, y, active] and object format {id, x, y, active}
      let id, x, y, active;
      if (Array.isArray(pickup)) {
        [id, x, y, active] = pickup;
      } else {
        ({ id, x, y, active } = pickup);
      }
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
        const leftVal = x - halfSize;
        const topVal = y - halfSize;
        // Log first 4 pickup creations to diagnose positioning
        if (CONFIG.DEBUG) {
          if (this._pickupCreateCount === undefined) this._pickupCreateCount = 0;
          if (this._pickupCreateCount < 4) {
            debugLog('[Renderer]', `Creating pickup ${id}: x=${x}, y=${y}, halfSize=${halfSize}, left=${leftVal}px, top=${topVal}px`);
            this._pickupCreateCount++;
          }
        }
        el.style.left = `${leftVal}px`;
        el.style.top = `${topVal}px`;
        el.style.display = active ? 'block' : 'none';
        this.arena.appendChild(el);
        this.pickupElements[id] = el;
      }

      // Show/hide based on active state
      if (active) {
        el.style.display = 'block';
        // Use left/top for positioning instead of transform (transform is used by float animation)
        // Centering calculation uses halfSize to center the element at the pickup's (x,y) coordinate
        el.style.left = `${x - halfSize}px`;
        el.style.top = `${y - halfSize}px`;
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
    this.ripplePool.show(x, y, type);
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
    this.impactFlashPool.show(x, y);
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

    // Delegate pool clearing
    this.projectilePool.clear();
    this.ripplePool.clear();
    this.impactFlashPool.clear();
  }

  // Fully destroy the renderer, removing all pool elements from DOM
  destroy() {
    // First clear all state and timeouts
    this.clear();

    // Destroy all pools (removes elements from DOM)
    this.projectilePool.destroy();
    this.ripplePool.destroy();
    this.impactFlashPool.destroy();

    // Clear game reference
    this.game = null;
    this.arena = null;
  }
}
