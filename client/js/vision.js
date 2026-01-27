// Visibility calculations for flashlight and darkness mechanics
import { CONFIG } from './config.js';

// Use shared geometry functions (loaded via script tag before modules)
// These functions are critical for visibility calculations - fail fast if not available
if (typeof window.GEOMETRY === 'undefined') {
  throw new Error('[Vision] window.GEOMETRY is undefined. Ensure geometry.js is loaded before this module.');
}

const { pointInRect, normalizeAngle, hasLineOfSight } = window.GEOMETRY;

// Validate that required functions are available
if (typeof normalizeAngle !== 'function') {
  throw new Error('[Vision] window.GEOMETRY.normalizeAngle is not a function');
}
if (typeof hasLineOfSight !== 'function') {
  throw new Error('[Vision] window.GEOMETRY.hasLineOfSight is not a function');
}

export class Vision {
  constructor(game) {
    this.game = game;
    // Cache DOM element references to avoid querySelector every frame
    this.playerElementCache = new Map();
    this.pickupElementCache = new Map();
  }

  /**
   * Calculate wrap-aware delta for a single axis with sign preservation.
   * Returns the shortest signed distance considering arena wrapping.
   * @param {number} from - Starting coordinate
   * @param {number} to - Target coordinate
   * @param {number} arenaSize - Size of the arena on this axis
   * @returns {number} Signed delta (shortest path considering wrap-around)
   */
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

  // Clear caches when game state changes (new game, etc.)
  clearCache() {
    this.playerElementCache?.clear();
    this.pickupElementCache?.clear();
  }

  // Get cached player element or query and cache it
  getPlayerElement(id) {
    let el = this.playerElementCache.get(id);
    // Check if cached element is still connected to DOM
    if (el && !el.isConnected) {
      this.playerElementCache.delete(id);
      el = null;
    }
    if (!el) {
      el = document.querySelector(`.player[data-id="${id}"]`);
      if (el) {
        this.playerElementCache.set(id, el);  // Only cache valid elements
      }
    }
    return el;
  }

  // Get cached pickup element or query and cache it
  getPickupElement(id) {
    let el = this.pickupElementCache.get(id);
    // Check if cached element is still connected to DOM
    if (el && !el.isConnected) {
      this.pickupElementCache.delete(id);
      el = null;
    }
    if (!el) {
      el = document.getElementById(`pickup-${id}`);
      if (el) {
        this.pickupElementCache.set(id, el);  // Only cache valid elements
      }
    }
    return el;
  }

  updateVisibility(state, localPlayer) {
    // Defensive checks for state and required properties
    if (!state?.p) return;

    // Early return if game reference is invalid
    if (!this.game) return;

    // Check if player is spectating (dead but game continues)
    const isSpectating = this.game.isSpectating;

    // Find the local player data from server state
    const localPlayerData = state.p.find(p => p[0] === this.game?.myId);
    if (!localPlayerData && !isSpectating) return;

    // Extract local player info (only needed if not spectating)
    let viewer = null;
    if (!isSpectating && localPlayerData) {
      const [, lx, ly, lfacing, lflashlight] = localPlayerData;
      // Use predicted local position if available
      viewer = {
        x: localPlayer?.x ?? lx,
        y: localPlayer?.y ?? ly,
        facing: localPlayer?.facing ?? lfacing,
        flashlightOn: !!lflashlight
      };
    }

    // Check muzzle flash state from server
    const muzzleFlash = !!state.mf;

    // Update visibility for each player
    for (const pData of state.p) {
      const [id, x, y, facing, flashlight] = pData;

      // Skip self - self is always visible via CSS
      if (id === this.game?.myId) continue;

      // Get cached player element
      const playerEl = this.getPlayerElement(id);
      if (!playerEl) continue;

      // Spectators see everything - all players are visible
      if (isSpectating) {
        playerEl.classList.add('visible');
        continue;
      }

      // Create target object
      const target = {
        x,
        y,
        facing,
        flashlightOn: !!flashlight
      };

      // Check visibility
      const visible = this.isPlayerVisible(viewer, target, muzzleFlash);

      // Add/remove visible class
      if (visible) {
        playerEl.classList.add('visible');
      } else {
        playerEl.classList.remove('visible');
      }
    }

    // Update visibility for each pickup
    if (state.k) {
      for (const pickup of state.k) {
        const [id, x, y, active] = pickup;

        // Get cached pickup element
        const pickupEl = this.getPickupElement(id);
        if (!pickupEl) continue;

        // Inactive pickups should not be visible
        if (!active) {
          pickupEl.classList.remove('visible');
          continue;
        }

        // Spectators see everything - all active pickups are visible
        if (isSpectating) {
          pickupEl.classList.add('visible');
          continue;
        }

        // Check visibility (pickups don't have flashlights, simpler check)
        const visible = this.isPointVisible(viewer, x, y, muzzleFlash);

        // Add/remove visible class
        if (visible) {
          pickupEl.classList.add('visible');
        } else {
          pickupEl.classList.remove('visible');
        }
      }
    }
  }

  isPlayerVisible(viewer, target, muzzleFlash) {
    // During muzzle flash, everyone is visible
    if (muzzleFlash) {
      return true;
    }

    // If TARGET's flashlight is on, they reveal themselves (visible to everyone)
    if (target?.flashlightOn) {
      return true;
    }

    // Defensive check for viewer and target - if missing, can't determine visibility
    if (!viewer || !target) {
      return false;
    }

    // If viewer's flashlight is off, they can't see anyone (who has their flashlight off)
    if (!viewer.flashlightOn) {
      return false;
    }

    // Calculate wrap-aware delta with sign preservation (used for both distance and angle)
    const dx = this.getWrappedDelta(viewer.x, target.x, CONFIG.ARENA_WIDTH);
    const dy = this.getWrappedDelta(viewer.y, target.y, CONFIG.ARENA_HEIGHT);
    const distance = Math.hypot(dx, dy);

    // Check if target is within flashlight range
    if (distance > CONFIG.FLASHLIGHT_RANGE) {
      return false;
    }

    // Calculate angle to target using the same wrapped deltas
    const angleToTarget = Math.atan2(dy, dx);
    const angleDiff = normalizeAngle(angleToTarget - viewer.facing);
    const halfConeRad = (CONFIG.FLASHLIGHT_ANGLE / 2) * (Math.PI / 180);

    if (Math.abs(angleDiff) > halfConeRad) {
      return false;
    }

    // Check line of sight (obstacles blocking)
    return hasLineOfSight(viewer.x, viewer.y, target.x, target.y, CONFIG.OBSTACLES);
  }

  isPointVisible(viewer, x, y, muzzleFlash) {
    // During muzzle flash, everything is visible
    if (muzzleFlash) {
      return true;
    }

    // Defensive check for viewer - if no viewer, can't determine visibility
    if (!viewer) {
      return false;
    }

    // If viewer's flashlight is off, they can't see anything
    if (!viewer.flashlightOn) {
      return false;
    }

    // Calculate wrap-aware delta with sign preservation (used for both distance and angle)
    const dx = this.getWrappedDelta(viewer.x, x, CONFIG.ARENA_WIDTH);
    const dy = this.getWrappedDelta(viewer.y, y, CONFIG.ARENA_HEIGHT);
    const distance = Math.hypot(dx, dy);

    // Check if point is within flashlight range
    if (distance > CONFIG.FLASHLIGHT_RANGE) {
      return false;
    }

    // Calculate angle to point using the same wrapped deltas
    const angleToPoint = Math.atan2(dy, dx);
    const angleDiff = normalizeAngle(angleToPoint - viewer.facing);
    const halfConeRad = (CONFIG.FLASHLIGHT_ANGLE / 2) * (Math.PI / 180);

    if (Math.abs(angleDiff) > halfConeRad) {
      return false;
    }

    // Check line of sight (obstacles blocking)
    return hasLineOfSight(viewer.x, viewer.y, x, y, CONFIG.OBSTACLES);
  }

  // Clean up all references when game is destroyed
  destroy() {
    this.clearCache();
    this.game = null;
  }
}
