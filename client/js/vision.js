// Visibility calculations for flashlight and darkness mechanics
import { CONFIG } from './config.js';

if (typeof window.GEOMETRY === 'undefined') {
  throw new Error('[Vision] window.GEOMETRY is undefined. Ensure geometry.js is loaded before this module.');
}

const { pointInRect, normalizeAngle, hasLineOfSight } = window.GEOMETRY;

if (typeof normalizeAngle !== 'function') {
  throw new Error('[Vision] window.GEOMETRY.normalizeAngle is not a function');
}
if (typeof hasLineOfSight !== 'function') {
  throw new Error('[Vision] window.GEOMETRY.hasLineOfSight is not a function');
}

export class Vision {
  constructor(game) {
    this.game = game;
    this.playerElementCache = new Map();
    this.pickupElementCache = new Map();
    this.playerVisibilityCache = new Map();
    this.pickupVisibilityCache = new Map();

    // Hysteresis to prevent jittery visibility at cone edges
    this.HYSTERESIS_ANGLE = 3; // degrees of buffer
    this.HYSTERESIS_RANGE = 15; // pixels of buffer
  }

  getWrappedDelta(from, to, arenaSize) {
    let delta = to - from;
    const halfArena = arenaSize / 2;
    if (delta > halfArena) {
      delta -= arenaSize;
    } else if (delta < -halfArena) {
      delta += arenaSize;
    }
    return delta;
  }

  clearCache() {
    this.playerElementCache?.clear();
    this.pickupElementCache?.clear();
    this.playerVisibilityCache?.clear();
    this.pickupVisibilityCache?.clear();
  }

  getPlayerElement(id) {
    let el = this.playerElementCache.get(id);
    if (el && !el.isConnected) {
      this.playerElementCache.delete(id);
      el = null;
    }
    if (!el) {
      el = document.querySelector(`.player[data-id="${id}"]`);
      if (el) {
        this.playerElementCache.set(id, el);
      }
    }
    return el;
  }

  getPickupElement(id) {
    let el = this.pickupElementCache.get(id);
    if (el && !el.isConnected) {
      this.pickupElementCache.delete(id);
      el = null;
    }
    if (!el) {
      el = document.getElementById(`pickup-${id}`);
      if (el) {
        this.pickupElementCache.set(id, el);
      }
    }
    return el;
  }

  updateVisibility(state, localPlayer) {
    if (!state?.p) return;
    if (!this.game) return;

    const isSpectating = this.game.isSpectating;

    const localPlayerData = state.p.find(p => p[0] === this.game?.myId);
    if (!localPlayerData && !isSpectating) return;

    let viewer = null;
    if (!isSpectating && localPlayerData) {
      const [, lx, ly, lfacing, lflashlight] = localPlayerData;
      viewer = {
        x: localPlayer?.x ?? lx,
        y: localPlayer?.y ?? ly,
        facing: localPlayer?.facing ?? lfacing,
        flashlightOn: !!lflashlight
      };
    }

    const muzzleFlash = !!state.mf;

    for (const pData of state.p) {
      const [id, x, y, facing, flashlight] = pData;

      if (id === this.game?.myId) continue;

      const playerEl = this.getPlayerElement(id);
      if (!playerEl) continue;

      if (isSpectating) {
        if (this.playerVisibilityCache.get(id) !== true) {
          playerEl.classList.add('visible');
          this.playerVisibilityCache.set(id, true);
        }
        continue;
      }

      const target = {
        x,
        y,
        facing,
        flashlightOn: !!flashlight
      };

      const wasVisible = this.playerVisibilityCache.get(id) || false;
      const visible = this.isPlayerVisible(viewer, target, muzzleFlash, wasVisible);

      if (wasVisible !== visible) {
        if (visible) {
          playerEl.classList.add('visible');
        } else {
          playerEl.classList.remove('visible');
        }
        this.playerVisibilityCache.set(id, visible);
      }
    }

    if (state.k) {
      for (const pickup of state.k) {
        const [id, x, y, active] = pickup;

        const pickupEl = this.getPickupElement(id);
        if (!pickupEl) continue;

        if (!active) {
          if (this.pickupVisibilityCache.get(id) !== false) {
            pickupEl.classList.remove('visible');
            this.pickupVisibilityCache.set(id, false);
          }
          continue;
        }

        if (isSpectating) {
          if (this.pickupVisibilityCache.get(id) !== true) {
            pickupEl.classList.add('visible');
            this.pickupVisibilityCache.set(id, true);
          }
          continue;
        }

        const wasVisible = this.pickupVisibilityCache.get(id) || false;
        const visible = this.isPointVisible(viewer, x, y, muzzleFlash, wasVisible);

        if (wasVisible !== visible) {
          if (visible) {
            pickupEl.classList.add('visible');
          } else {
            pickupEl.classList.remove('visible');
          }
          this.pickupVisibilityCache.set(id, visible);
        }
      }
    }
  }

  isPlayerVisible(viewer, target, muzzleFlash, wasVisible = false) {
    if (muzzleFlash) {
      return true;
    }

    // Flashlight reveals the holder
    if (target?.flashlightOn) {
      return true;
    }

    if (!viewer || !target) {
      return false;
    }

    if (!viewer.flashlightOn) {
      return false;
    }

    const dx = this.getWrappedDelta(viewer.x, target.x, CONFIG.ARENA_WIDTH);
    const dy = this.getWrappedDelta(viewer.y, target.y, CONFIG.ARENA_HEIGHT);
    const distance = Math.hypot(dx, dy);

    const rangeThreshold = wasVisible
      ? CONFIG.FLASHLIGHT_RANGE + this.HYSTERESIS_RANGE
      : CONFIG.FLASHLIGHT_RANGE;

    if (distance > rangeThreshold) {
      return false;
    }

    const angleToTarget = Math.atan2(dy, dx);
    const angleDiff = normalizeAngle(angleToTarget - viewer.facing);

    const hysteresisRad = (this.HYSTERESIS_ANGLE / 2) * (Math.PI / 180);
    const halfConeRad = (CONFIG.FLASHLIGHT_ANGLE / 2) * (Math.PI / 180);
    const angleThreshold = wasVisible
      ? halfConeRad + hysteresisRad
      : halfConeRad;

    if (Math.abs(angleDiff) > angleThreshold) {
      return false;
    }

    return hasLineOfSight(viewer.x, viewer.y, target.x, target.y, CONFIG.OBSTACLES);
  }

  isPointVisible(viewer, x, y, muzzleFlash, wasVisible = false) {
    if (muzzleFlash) {
      return true;
    }

    if (!viewer) {
      return false;
    }

    if (!viewer.flashlightOn) {
      return false;
    }

    const dx = this.getWrappedDelta(viewer.x, x, CONFIG.ARENA_WIDTH);
    const dy = this.getWrappedDelta(viewer.y, y, CONFIG.ARENA_HEIGHT);
    const distance = Math.hypot(dx, dy);

    const rangeThreshold = wasVisible
      ? CONFIG.FLASHLIGHT_RANGE + this.HYSTERESIS_RANGE
      : CONFIG.FLASHLIGHT_RANGE;

    if (distance > rangeThreshold) {
      return false;
    }

    const angleToPoint = Math.atan2(dy, dx);
    const angleDiff = normalizeAngle(angleToPoint - viewer.facing);

    const hysteresisRad = (this.HYSTERESIS_ANGLE / 2) * (Math.PI / 180);
    const halfConeRad = (CONFIG.FLASHLIGHT_ANGLE / 2) * (Math.PI / 180);
    const angleThreshold = wasVisible
      ? halfConeRad + hysteresisRad
      : halfConeRad;

    if (Math.abs(angleDiff) > angleThreshold) {
      return false;
    }

    return hasLineOfSight(viewer.x, viewer.y, x, y, CONFIG.OBSTACLES);
  }

  destroy() {
    this.clearCache();
    this.game = null;
  }
}
