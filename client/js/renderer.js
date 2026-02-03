// DOM rendering with object pools
import { CONFIG } from './config.js';
import { ProjectilePool, RipplePool, ImpactFlashPool } from './pools.js';

export class Renderer {
  constructor(game) {
    this.game = game;
    this.arena = document.getElementById('arena');
    this.playerElements = {};
    this.pendingTimeouts = new Set();
    this.pickupElements = {};
    this.trackedPickupIds = new Set();

    this.projectilePool = new ProjectilePool(this.arena);
    this.ripplePool = new RipplePool(this.arena, this.pendingTimeouts);
    this.impactFlashPool = new ImpactFlashPool(this.arena, this.pendingTimeouts);
  }

  render(prevState, currState, stateTime, localPlayer) {
    if (!currState) return;

    const interpolationDelay = CONFIG.INTERPOLATION_DELAY || 1;
    const t = Math.min(stateTime / interpolationDelay, 1);

    const currentPlayerIds = new Set();

    let prevPlayerMap = null;
    if (prevState && prevState.p) {
      prevPlayerMap = new Map();
      for (const p of prevState.p) {
        prevPlayerMap.set(p[0], p);
      }
    }

    if (currState.p) {
      for (const pData of currState.p) {
        const [id, x, y, facing, flashlight, hearts, hasAmmo, stunned, invincible, flashlightOnSince] = pData;
        currentPlayerIds.add(String(id));

        let renderX = x;
        let renderY = y;

        if (id === this.game.myId && localPlayer) {
          renderX = localPlayer.x;
          renderY = localPlayer.y;
        } else if (prevPlayerMap) {
          const prev = prevPlayerMap.get(id);
          if (prev) {
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

    for (const id of Object.keys(this.playerElements)) {
      if (!currentPlayerIds.has(id)) {
        this.cleanupPlayer(id);
      }
    }

    this.projectilePool.render(prevState, currState, t, this.lerpWrap.bind(this));
    this.renderPickups(currState.k);

    if (this.game.vision) {
      this.game.vision.updateVisibility(currState, localPlayer);
    }

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

    if (cached && !cached.root.isConnected) {
      delete this.playerElements[id];
      cached = null;
    }

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

      cached = {
        root: el,
        body: el.querySelector('.player-body'),
        direction: el.querySelector('.player-direction'),
        cone: el.querySelector('.flashlight-cone')
      };
      this.playerElements[id] = cached;
    }

    const el = cached.root;

    el.style.transform = `translate3d(${x - CONFIG.PLAYER_SIZE / 2}px, ${y - CONFIG.PLAYER_SIZE / 2}px, 0)`;

    const zBucket = Math.floor(y / 100);
    if (cached.lastZBucket !== zBucket) {
      el.style.zIndex = 40 + zBucket;
      cached.lastZBucket = zBucket;
    }

    if (cached.direction) {
      if (cached.direction.isConnected) {
        cached.direction.style.transform = `translateY(-50%) rotate(${facing}rad)`;
      } else {
        cached.direction = el.querySelector('.player-direction');
        if (cached.direction) {
          cached.direction.style.transform = `translateY(-50%) rotate(${facing}rad)`;
        }
      }
    } else {
      cached.direction = el.querySelector('.player-direction');
      if (cached.direction) {
        cached.direction.style.transform = `translateY(-50%) rotate(${facing}rad)`;
      }
    }

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

    const shouldFlicker = flashlightOn && flashlightOnSince > 0 &&
      (Date.now() - flashlightOnSince >= CONFIG.FLASHLIGHT_FLICKER_THRESHOLD);
    el.classList.toggle('flashlight-flickering', shouldFlicker);

    el.classList.toggle('invincible', !!invincible);
    el.classList.toggle('self', id === this.game.myId);

    if (playerData) {
      el.classList.toggle('stunned', !!playerData.stunned);
    }

    const playerInfo = this.game.lobbyData?.players?.find(p => p.id === id);
    if (playerInfo && playerInfo.color && cached.body) {
      cached.body.style.backgroundColor = playerInfo.color;
    }
  }

  renderPickups(pickups) {
    if (!pickups) return;

    const pickupSize = CONFIG.PICKUP_SIZE;
    if (typeof pickupSize !== 'number' || !Number.isFinite(pickupSize) || pickupSize <= 0) {
      console.error('[Renderer] Invalid CONFIG.PICKUP_SIZE:', pickupSize, '- using fallback 30');
    }
    const halfSize = (typeof pickupSize === 'number' && Number.isFinite(pickupSize) && pickupSize > 0)
      ? pickupSize / 2
      : 15; // fallback: 30 / 2 = 15

    const currentPickupIds = new Set();

    for (const pickup of pickups) {
      let id, x, y, active;
      if (Array.isArray(pickup)) {
        [id, x, y, active] = pickup;
      } else {
        ({ id, x, y, active } = pickup);
      }
      currentPickupIds.add(id);

      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
        console.warn('[Renderer] Pickup has invalid coordinates:', { id, x, y, active });
        continue;
      }

      let el = this.pickupElements[id];

      if (el && !el.isConnected) {
        delete this.pickupElements[id];
        el = null;
      }

      if (!el) {
        el = document.createElement('div');
        el.id = `pickup-${id}`;
        el.className = 'pillow-pickup';
        const leftVal = x - halfSize;
        const topVal = y - halfSize;
        el.style.left = `${leftVal}px`;
        el.style.top = `${topVal}px`;
        el.style.display = active ? 'block' : 'none';
        this.arena.appendChild(el);
        this.pickupElements[id] = el;
      }

      if (active) {
        el.style.display = 'block';
        el.style.left = `${x - halfSize}px`;
        el.style.top = `${y - halfSize}px`;
        el.style.zIndex = 20 + Math.floor(y / 100);
      } else {
        el.style.display = 'none';
      }
    }

    // Remove elements for pickups no longer in state
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

  // Wrap-aware lerp for arena edge wrapping
  lerpWrap(a, b, t, max) {
    const diff = b - a;
    const halfMax = max / 2;

    if (diff > halfMax) {
      const result = this.lerp(a + max, b, t);
      return ((result % max) + max) % max;
    } else if (diff < -halfMax) {
      const result = this.lerp(a, b + max, t);
      return ((result % max) + max) % max;
    }

    return this.lerp(a, b, t);
  }

  cleanupPlayer(id) {
    const cached = this.playerElements[id];
    if (cached) {
      if (cached.root && cached.root.parentNode) {
        cached.root.remove();
      }
      cached.root = null;
      cached.body = null;
      cached.direction = null;
      cached.cone = null;
      delete this.playerElements[id];
    }
  }

  clearPickups() {
    if (!this.arena) return;
    for (const id of Object.keys(this.pickupElements)) {
      const el = this.pickupElements[id];
      if (el && el.parentNode) {
        el.remove();
      }
    }
    const pickups = this.arena.querySelectorAll('[id^="pickup-"]');
    pickups.forEach(el => el.remove());
    this.pickupElements = {};
    this.trackedPickupIds.clear();
  }

  clear() {
    for (const timeoutId of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts = new Set();

    for (const id of Object.keys(this.playerElements)) {
      this.cleanupPlayer(id);
    }

    this.clearPickups();

    this.projectilePool.clear();
    this.ripplePool.clear();
    this.impactFlashPool.clear();
  }

  destroy() {
    this.clear();

    this.projectilePool.destroy();
    this.ripplePool.destroy();
    this.impactFlashPool.destroy();

    this.game = null;
    this.arena = null;
  }
}
