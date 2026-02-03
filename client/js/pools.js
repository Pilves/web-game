// Object pool management for DOM elements (projectiles, ripples, impact flashes)
import { CONFIG } from './config.js';

export class ProjectilePool {
  constructor(arena) {
    this.arena = arena;
    this.pool = [];
    this.init();
  }

  init() {
    for (let i = 0; i < 20; i++) {
      const el = document.createElement('div');
      el.className = 'projectile';
      el.style.display = 'none';
      this.arena.appendChild(el);
      this.pool.push({ el, active: false, id: null });
    }
  }

  render(prevState, currState, t, lerpWrap) {
    // Reset active flags before processing current frame
    this.pool.forEach(p => {
      p.active = false;
    });

    if (!currState.j) {
      this.pool.forEach(p => {
        p.el.style.display = 'none';
        p.id = null;
      });
      return;
    }

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

      if (prevProjectileMap) {
        const prev = prevProjectileMap.get(id);
        if (prev) {
          renderX = lerpWrap(prev[1], x, t, CONFIG.ARENA_WIDTH);
          renderY = lerpWrap(prev[2], y, t, CONFIG.ARENA_HEIGHT);
        }
      }

      let poolItem = this.pool.find(p => p.id === id);
      if (!poolItem) {
        poolItem = this.pool.find(p => !p.active);
        if (poolItem) {
          poolItem.id = id;
        } else {
          console.warn('[ProjectilePool] Pool exhausted, projectile', id, 'not rendered');
          continue;
        }
      }

      if (!poolItem || !poolItem.el) {
        console.warn('[ProjectilePool] Invalid pool item for projectile', id);
        continue;
      }

      poolItem.active = true;
      poolItem.el.style.display = 'block';
      poolItem.el.style.transform = `translate3d(${renderX - CONFIG.PROJECTILE_SIZE / 2}px, ${renderY - CONFIG.PROJECTILE_SIZE / 2}px, 0)`;
      const zBucket = Math.floor(renderY / 100);
      if (poolItem.lastZBucket !== zBucket) {
        poolItem.el.style.zIndex = 30 + zBucket;
        poolItem.lastZBucket = zBucket;
      }
    }

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
    for (let i = 0; i < 30; i++) {
      const el = document.createElement('div');
      el.className = 'sound-ripple';
      this.arena.appendChild(el);
      this.pool.push({ el, animating: false, timeoutId: null });
    }
  }

  show(x, y, type = 'footstep') {
    let poolItem = null;
    let startIndex = this.index;

    for (let i = 0; i < this.pool.length; i++) {
      const idx = (startIndex + i) % this.pool.length;
      if (!this.pool[idx].animating) {
        poolItem = this.pool[idx];
        this.index = (idx + 1) % this.pool.length;
        break;
      }
    }

    if (!poolItem) {
      poolItem = this.pool[this.index];
      this.index = (this.index + 1) % this.pool.length;
      if (poolItem.timeoutId !== null) {
        clearTimeout(poolItem.timeoutId);
        this.pendingTimeouts.delete(poolItem.timeoutId);
      }
    }

    const el = poolItem.el;
    poolItem.animating = true;

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.className = `sound-ripple active ${type}`;

    const timeoutId = setTimeout(() => {
      el.classList.remove('active');
      poolItem.animating = false;
      poolItem.timeoutId = null;
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
    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.className = 'impact-flash';
      el.style.display = 'none';
      this.arena.appendChild(el);
      this.pool.push({ el, active: false, timeoutId: null });
    }
  }

  show(x, y) {
    const MAX_IMPACT_FLASH_POOL_SIZE = 20;
    let poolItem = this.pool.find(p => !p.active);

    if (!poolItem) {
      if (this.pool.length < MAX_IMPACT_FLASH_POOL_SIZE) {
        const el = document.createElement('div');
        el.className = 'impact-flash';
        el.style.display = 'none';
        this.arena.appendChild(el);
        poolItem = { el, active: false, timeoutId: null };
        this.pool.push(poolItem);
      } else {
        // Reuse oldest (LRU)
        poolItem = this.pool[0];
        this.pool.push(this.pool.shift());
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
    el.classList.remove('impact-flash');
    void el.offsetWidth;
    el.classList.add('impact-flash');

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
