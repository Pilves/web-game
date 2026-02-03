// Object pool management for DOM elements (projectiles, ripples, impact flashes)
import { CONFIG, debugLog } from './config.js';

export class ProjectilePool {
  constructor(arena) {
    this.arena = arena;
    this.pool = [];
    this._projLogCount = 0;
    this.init();
  }

  init() {
    // Pre-allocate 20 projectile elements
    for (let i = 0; i < 20; i++) {
      const el = document.createElement('div');
      el.className = 'projectile';
      el.style.display = 'none';
      this.arena.appendChild(el);
      this.pool.push({ el, active: false, id: null });
    }
  }

  render(prevState, currState, t, lerpWrap) {
    // HIGH-12: Hide inactive projectiles BEFORE early return to reset state between frames
    // This ensures projectiles are hidden even when currState.j is empty/undefined
    this.pool.forEach(p => {
      p.active = false;
    });

    // Skip if no projectiles - but inactive projectiles are already marked above
    if (!currState.j) {
      // Hide all projectiles since there are none in current state
      this.pool.forEach(p => {
        p.el.style.display = 'none';
        p.id = null;
      });
      return;
    }

    if (currState.j.length > 0) {
      if (this._projLogCount < 10) {
        debugLog('[ProjectilePool]', 'renderProjectiles:', currState.j.map(p => ({id: p[0], x: p[1], y: p[2]})));
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
          renderX = lerpWrap(prev[1], x, t, CONFIG.ARENA_WIDTH);
          renderY = lerpWrap(prev[2], y, t, CONFIG.ARENA_HEIGHT);
        }
      }

      // Find or assign pool element
      // MED-16: Add null check for poolItem to prevent null pointer exceptions
      let poolItem = this.pool.find(p => p.id === id);
      if (!poolItem) {
        poolItem = this.pool.find(p => !p.active);
        if (poolItem) {
          poolItem.id = id;
        } else {
          // Pool exhausted - log warning
          console.warn('[ProjectilePool] Pool exhausted, projectile', id, 'not rendered');
          continue; // Skip this projectile
        }
      }

      // MED-16: Additional safety check - poolItem should never be undefined here
      // but guard against edge cases
      if (!poolItem || !poolItem.el) {
        console.warn('[ProjectilePool] Invalid pool item for projectile', id);
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
    this.pool.forEach(p => {
      if (!p.active) {
        p.el.style.display = 'none';
        p.id = null;
      }
    });
  }

  clear() {
    this.pool.forEach(p => {
      p.el.style.display = 'none';
      p.active = false;
      p.id = null;
    });
  }

  destroy() {
    this.pool.forEach(poolItem => {
      if (poolItem.el && poolItem.el.parentNode) {
        poolItem.el.remove();
      }
      poolItem.el = null;
    });
    this.pool = [];
  }
}

export class RipplePool {
  constructor(arena, pendingTimeouts) {
    this.arena = arena;
    this.pendingTimeouts = pendingTimeouts;
    this.pool = [];
    this.index = 0;
    this.init();
  }

  init() {
    // Pre-allocate 30 ripple elements with animation state tracking (MED-17)
    for (let i = 0; i < 30; i++) {
      const el = document.createElement('div');
      el.className = 'sound-ripple';
      this.arena.appendChild(el);
      this.pool.push({ el, animating: false, timeoutId: null });
    }
  }

  show(x, y, type = 'footstep') {
    // MED-17: Find a ripple that is not currently animating to avoid race conditions
    let poolItem = null;
    let startIndex = this.index;

    // Try to find a non-animating ripple
    // Note: This loop uses index-based access rather than iterators, so it is safe
    // from concurrent modification issues. The pool array is not modified during iteration.
    for (let i = 0; i < this.pool.length; i++) {
      const idx = (startIndex + i) % this.pool.length;
      if (!this.pool[idx].animating) {
        poolItem = this.pool[idx];
        this.index = (idx + 1) % this.pool.length;
        break;
      }
    }

    // If all are animating, force reuse the next one
    if (!poolItem) {
      poolItem = this.pool[this.index];
      this.index = (this.index + 1) % this.pool.length;
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

  clear() {
    this.pool.forEach(poolItem => {
      poolItem.el.classList.remove('active');
      poolItem.animating = false;
      poolItem.timeoutId = null;
    });
    this.index = 0;
  }

  destroy() {
    this.pool.forEach(poolItem => {
      if (poolItem.el && poolItem.el.parentNode) {
        poolItem.el.remove();
      }
      poolItem.el = null;
    });
    this.pool = [];
  }
}

export class ImpactFlashPool {
  constructor(arena, pendingTimeouts) {
    this.arena = arena;
    this.pendingTimeouts = pendingTimeouts;
    this.pool = [];
    this.init();
  }

  init() {
    // Pre-allocate 10 impact flash elements (LOW-24)
    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.className = 'impact-flash';
      el.style.display = 'none';
      this.arena.appendChild(el);
      this.pool.push({ el, active: false, timeoutId: null });
    }
  }

  show(x, y) {
    // LOW-24: Use pool for impact flash elements instead of creating/destroying
    const MAX_IMPACT_FLASH_POOL_SIZE = 20; // Maximum pool size to prevent unbounded growth
    let poolItem = this.pool.find(p => !p.active);

    if (!poolItem) {
      // Pool exhausted - check if we can grow the pool or must reuse oldest
      if (this.pool.length < MAX_IMPACT_FLASH_POOL_SIZE) {
        // Create a new element if under max pool size
        const el = document.createElement('div');
        el.className = 'impact-flash';
        el.style.display = 'none';
        this.arena.appendChild(el);
        poolItem = { el, active: false, timeoutId: null };
        this.pool.push(poolItem);
      } else {
        // Pool at max size - reuse oldest active element (first in array)
        // SAFETY NOTE: The push(shift()) operation is safe here because:
        // 1. This code path only executes when no inactive element was found via find()
        // 2. The find() operation completed before we reach this branch
        // 3. No iterator is active on pool at this point
        // 4. The poolItem reference is captured BEFORE the array modification
        poolItem = this.pool[0];
        // Move to end of array to implement LRU behavior
        this.pool.push(this.pool.shift());
        // Cancel previous timeout to prevent race condition
        if (poolItem.timeoutId !== null) {
          clearTimeout(poolItem.timeoutId);
          this.pendingTimeouts.delete(poolItem.timeoutId);
        }
        console.warn('[ImpactFlashPool] Pool exhausted, reusing oldest element');
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

  clear() {
    this.pool.forEach(poolItem => {
      poolItem.el.style.display = 'none';
      poolItem.active = false;
      poolItem.timeoutId = null;
    });
  }

  destroy() {
    this.pool.forEach(poolItem => {
      if (poolItem.el && poolItem.el.parentNode) {
        poolItem.el.remove();
      }
      poolItem.el = null;
    });
    this.pool = [];
  }
}
