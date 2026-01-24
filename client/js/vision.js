// Visibility calculations for flashlight and darkness mechanics
import { CONFIG } from './config.js';

export class Vision {
  constructor(game) {
    this.game = game;
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

      // Get or find player element
      const playerEl = document.querySelector(`.player[data-id="${id}"]`);
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
    const angleDiff = this.normalizeAngle(angleToTarget - viewer.facing);
    const halfConeRad = (CONFIG.FLASHLIGHT_ANGLE / 2) * (Math.PI / 180);

    if (Math.abs(angleDiff) > halfConeRad) {
      return false;
    }

    // Check line of sight (obstacles blocking)
    return this.hasLineOfSight(viewer.x, viewer.y, target.x, target.y);
  }

  hasLineOfSight(x1, y1, x2, y2) {
    // Raycast check for obstacles
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.hypot(dx, dy);

    // Number of steps for raycast (10px per step)
    const steps = Math.ceil(distance / 10);

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t;
      const y = y1 + dy * t;

      // Check against all obstacles
      for (const obstacle of CONFIG.OBSTACLES) {
        if (this.pointInRect(x, y, obstacle)) {
          return false; // Blocked by obstacle
        }
      }
    }

    return true; // Clear line of sight
  }

  pointInRect(x, y, rect) {
    return x >= rect.x &&
           x <= rect.x + rect.width &&
           y >= rect.y &&
           y <= rect.y + rect.height;
  }

  normalizeAngle(angle) {
    // Keep angle in [-PI, PI] range
    while (angle > Math.PI) {
      angle -= 2 * Math.PI;
    }
    while (angle < -Math.PI) {
      angle += 2 * Math.PI;
    }
    return angle;
  }
}
