// Visibility calculations for flashlight and darkness mechanics
import { CONFIG } from './config.js';

// Use shared geometry functions (loaded via script tag before modules)
const { pointInRect, normalizeAngle, hasLineOfSight } = window.GEOMETRY;

export class Vision {
  constructor(game) {
    this.game = game;
    // Cache DOM element references to avoid querySelector every frame
    this.playerElementCache = new Map();
    this.pickupElementCache = new Map();
  }

  // Clear caches when game state changes (new game, etc.)
  clearCache() {
    this.playerElementCache.clear();
    this.pickupElementCache.clear();
  }

  // Get cached player element or query and cache it
  getPlayerElement(id) {
    let el = this.playerElementCache.get(id);
    if (!el) {
      el = document.querySelector(`.player[data-id="${id}"]`);
      if (el) {
        this.playerElementCache.set(id, el);
      }
    }
    return el;
  }

  // Get cached pickup element or query and cache it
  getPickupElement(id) {
    let el = this.pickupElementCache.get(id);
    if (!el) {
      el = document.getElementById(`pickup-${id}`);
      if (el) {
        this.pickupElementCache.set(id, el);
      }
    }
    return el;
  }

  updateVisibility(state, localPlayer) {
    if (!state || !state.p) return;

    // Find the local player data from server state
    const localPlayerData = state.p.find(p => p[0] === this.game.myId);
    if (!localPlayerData) return;

    // Extract local player info
    const [, lx, ly, lfacing, lflashlight] = localPlayerData;

    // Use predicted local position if available
    const viewer = {
      x: localPlayer?.x ?? lx,
      y: localPlayer?.y ?? ly,
      facing: localPlayer?.facing ?? lfacing,
      flashlightOn: !!lflashlight
    };

    // Check muzzle flash state from server
    const muzzleFlash = !!state.mf;

    // Update visibility for each player
    for (const pData of state.p) {
      const [id, x, y, facing, flashlight] = pData;

      // Skip self - self is always visible via CSS
      if (id === this.game.myId) continue;

      // Get cached player element
      const playerEl = this.getPlayerElement(id);
      if (!playerEl) continue;

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

        // Skip inactive pickups
        if (!active) continue;

        // Get cached pickup element
        const pickupEl = this.getPickupElement(id);
        if (!pickupEl) continue;

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

    // If viewer's flashlight is off, they can't see anyone
    if (!viewer.flashlightOn) {
      return false;
    }

    // Calculate distance and angle to target
    const dx = target.x - viewer.x;
    const dy = target.y - viewer.y;
    const distance = Math.hypot(dx, dy);

    // Check if target is within flashlight range
    if (distance > CONFIG.FLASHLIGHT_RANGE) {
      return false;
    }

    // Check if target is within flashlight cone angle
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

    // If viewer's flashlight is off, they can't see anything
    if (!viewer.flashlightOn) {
      return false;
    }

    // Calculate distance and angle to point
    const dx = x - viewer.x;
    const dy = y - viewer.y;
    const distance = Math.hypot(dx, dy);

    // Check if point is within flashlight range
    if (distance > CONFIG.FLASHLIGHT_RANGE) {
      return false;
    }

    // Check if point is within flashlight cone angle
    const angleToPoint = Math.atan2(dy, dx);
    const angleDiff = normalizeAngle(angleToPoint - viewer.facing);
    const halfConeRad = (CONFIG.FLASHLIGHT_ANGLE / 2) * (Math.PI / 180);

    if (Math.abs(angleDiff) > halfConeRad) {
      return false;
    }

    // Check line of sight (obstacles blocking)
    return hasLineOfSight(viewer.x, viewer.y, x, y, CONFIG.OBSTACLES);
  }
}
