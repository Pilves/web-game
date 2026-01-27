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
    // Cache visibility state to avoid unnecessary DOM class updates
    this.playerVisibilityCache = new Map();
    this.pickupVisibilityCache = new Map();

    // Hysteresis constants to prevent jittery visibility at cone edges
    // When becoming visible: use tighter threshold (must be clearly in cone)
    // When becoming invisible: use looser threshold (must be clearly out of cone)
    this.HYSTERESIS_ANGLE = 3; // degrees of buffer at cone edge
    this.HYSTERESIS_RANGE = 15; // pixels of buffer at range edge
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
    this.playerVisibilityCache?.clear();
    this.pickupVisibilityCache?.clear();
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
        if (this.playerVisibilityCache.get(id) !== true) {
          playerEl.classList.add('visible');
          this.playerVisibilityCache.set(id, true);
        }
        continue;
      }

      // Create target object
      const target = {
        x,
        y,
        facing,
        flashlightOn: !!flashlight
      };

      // Check visibility (pass current state for hysteresis to prevent jitter)
      const wasVisible = this.playerVisibilityCache.get(id) || false;
      const visible = this.isPlayerVisible(viewer, target, muzzleFlash, wasVisible);

      // Only update DOM if visibility changed (optimization)
      if (wasVisible !== visible) {
        if (visible) {
          playerEl.classList.add('visible');
        } else {
          playerEl.classList.remove('visible');
        }
        this.playerVisibilityCache.set(id, visible);
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
          if (this.pickupVisibilityCache.get(id) !== false) {
            pickupEl.classList.remove('visible');
            this.pickupVisibilityCache.set(id, false);
          }
          continue;
        }

        // Spectators see everything - all active pickups are visible
        if (isSpectating) {
          if (this.pickupVisibilityCache.get(id) !== true) {
            pickupEl.classList.add('visible');
            this.pickupVisibilityCache.set(id, true);
          }
          continue;
        }

        // Check visibility (pass current state for hysteresis to prevent jitter)
        const wasVisible = this.pickupVisibilityCache.get(id) || false;
        const visible = this.isPointVisible(viewer, x, y, muzzleFlash, wasVisible);

        // Only update DOM if visibility changed (optimization)
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

    // Apply hysteresis to range check to prevent jitter at edge
    // If currently visible, use larger range (harder to leave)
    // If currently not visible, use smaller range (harder to enter)
    const rangeThreshold = wasVisible
      ? CONFIG.FLASHLIGHT_RANGE + this.HYSTERESIS_RANGE
      : CONFIG.FLASHLIGHT_RANGE;

    if (distance > rangeThreshold) {
      return false;
    }

    // Calculate angle to target using the same wrapped deltas
    const angleToTarget = Math.atan2(dy, dx);
    const angleDiff = normalizeAngle(angleToTarget - viewer.facing);

    // Apply hysteresis to angle check to prevent jitter at cone edge
    const hysteresisRad = (this.HYSTERESIS_ANGLE / 2) * (Math.PI / 180);
    const halfConeRad = (CONFIG.FLASHLIGHT_ANGLE / 2) * (Math.PI / 180);
    const angleThreshold = wasVisible
      ? halfConeRad + hysteresisRad  // Harder to leave (wider cone)
      : halfConeRad;                  // Normal cone to enter

    if (Math.abs(angleDiff) > angleThreshold) {
      return false;
    }

    // Check line of sight (obstacles blocking)
    return hasLineOfSight(viewer.x, viewer.y, target.x, target.y, CONFIG.OBSTACLES);
  }

  isPointVisible(viewer, x, y, muzzleFlash, wasVisible = false) {
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

    // Apply hysteresis to range check
    const rangeThreshold = wasVisible
      ? CONFIG.FLASHLIGHT_RANGE + this.HYSTERESIS_RANGE
      : CONFIG.FLASHLIGHT_RANGE;

    if (distance > rangeThreshold) {
      return false;
    }

    // Calculate angle to point using the same wrapped deltas
    const angleToPoint = Math.atan2(dy, dx);
    const angleDiff = normalizeAngle(angleToPoint - viewer.facing);

    // Apply hysteresis to angle check
    const hysteresisRad = (this.HYSTERESIS_ANGLE / 2) * (Math.PI / 180);
    const halfConeRad = (CONFIG.FLASHLIGHT_ANGLE / 2) * (Math.PI / 180);
    const angleThreshold = wasVisible
      ? halfConeRad + hysteresisRad
      : halfConeRad;

    if (Math.abs(angleDiff) > angleThreshold) {
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
