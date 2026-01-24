/**
 * Physics.js - Movement, collision detection, and visibility for LIGHTS OUT
 */

const CONSTANTS = require('./constants.js');

// ============================================
// AABB Collision Detection
// ============================================

/**
 * Check if two rectangles overlap (AABB collision)
 * @param {Object} a - First rectangle {x, y, width, height}
 * @param {Object} b - Second rectangle {x, y, width, height}
 * @returns {boolean} True if rectangles overlap
 */
function rectsCollide(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Check if a point is inside a rectangle
 * @param {number} x - Point x coordinate
 * @param {number} y - Point y coordinate
 * @param {Object} rect - Rectangle {x, y, width, height}
 * @returns {boolean} True if point is inside rectangle
 */
function pointInRect(x, y, rect) {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

// ============================================
// Hitbox Helpers
// ============================================

/**
 * Get the bounding rectangle for a player (centered on position)
 * @param {Object} player - Player object with x, y properties
 * @returns {Object} Rectangle {x, y, width, height}
 */
function getPlayerRect(player) {
  return {
    x: player.x - CONSTANTS.PLAYER_SIZE / 2,
    y: player.y - CONSTANTS.PLAYER_SIZE / 2,
    width: CONSTANTS.PLAYER_SIZE,
    height: CONSTANTS.PLAYER_SIZE,
  };
}

/**
 * Get the bounding rectangle for a projectile (centered on position)
 * @param {Object} projectile - Projectile object with x, y properties
 * @returns {Object} Rectangle {x, y, width, height}
 */
function getProjectileRect(projectile) {
  return {
    x: projectile.x - CONSTANTS.PROJECTILE_SIZE / 2,
    y: projectile.y - CONSTANTS.PROJECTILE_SIZE / 2,
    width: CONSTANTS.PROJECTILE_SIZE,
    height: CONSTANTS.PROJECTILE_SIZE,
  };
}

// ============================================
// Movement
// ============================================

/**
 * Apply input to player velocity
 * @param {Object} player - Player object with vx, vy, input, stunnedUntil properties
 * @param {Object} input - Input state {up, down, left, right, sprint}
 * @param {number} dt - Delta time in seconds
 */
function applyInput(player, input, dt) {
  // Can't move while stunned
  const now = Date.now();
  if (player.stunnedUntil && now < player.stunnedUntil) {
    // Apply friction while stunned
    player.vx *= CONSTANTS.PLAYER_FRICTION;
    player.vy *= CONSTANTS.PLAYER_FRICTION;
    return;
  }

  // Determine speed based on sprint
  const speed = input.sprint ? CONSTANTS.PLAYER_SPRINT_SPEED : CONSTANTS.PLAYER_SPEED;

  // Calculate direction from input
  let dx = 0;
  let dy = 0;

  if (input.up) dy -= 1;
  if (input.down) dy += 1;
  if (input.left) dx -= 1;
  if (input.right) dx += 1;

  // Normalize diagonal movement to prevent faster diagonal speed
  const length = Math.hypot(dx, dy);
  if (length > 0) {
    dx = dx / length;
    dy = dy / length;

    // Set velocity
    player.vx = dx * speed;
    player.vy = dy * speed;
  } else {
    // No input - apply friction
    player.vx *= CONSTANTS.PLAYER_FRICTION;
    player.vy *= CONSTANTS.PLAYER_FRICTION;

    // Stop completely if velocity is very small
    if (Math.abs(player.vx) < 0.1) player.vx = 0;
    if (Math.abs(player.vy) < 0.1) player.vy = 0;
  }
}

/**
 * Move player and handle collisions
 * @param {Object} player - Player object with x, y, vx, vy properties
 * @param {number} dt - Delta time in seconds
 * @param {Array} obstacles - Array of obstacle rectangles
 * @param {number} arenaInset - Arena inset for sudden death (shrinking arena)
 */
function movePlayer(player, dt, obstacles, arenaInset = 0) {
  const halfSize = CONSTANTS.PLAYER_SIZE / 2;

  // Calculate arena boundaries with inset
  const minX = arenaInset + halfSize;
  const maxX = CONSTANTS.ARENA_WIDTH - arenaInset - halfSize;
  const minY = arenaInset + halfSize;
  const maxY = CONSTANTS.ARENA_HEIGHT - arenaInset - halfSize;

  // Apply velocity to position
  const newX = player.x + player.vx * dt;
  const newY = player.y + player.vy * dt;

  // Store old position for collision resolution
  const oldX = player.x;
  const oldY = player.y;

  // Update position
  player.x = newX;
  player.y = newY;

  // Check wall boundaries
  if (player.x < minX) {
    player.x = minX;
    player.vx = 0;
  }
  if (player.x > maxX) {
    player.x = maxX;
    player.vx = 0;
  }
  if (player.y < minY) {
    player.y = minY;
    player.vy = 0;
  }
  if (player.y > maxY) {
    player.y = maxY;
    player.vy = 0;
  }

  // Check obstacle collisions
  const playerRect = getPlayerRect(player);

  for (const obstacle of obstacles) {
    if (rectsCollide(playerRect, obstacle)) {
      // Resolve collision by pushing player out
      resolveCollision(player, obstacle, oldX, oldY);
    }
  }
}

/**
 * Resolve collision between player and obstacle
 * Push player out of obstacle along the axis of least penetration
 * @param {Object} player - Player object
 * @param {Object} obstacle - Obstacle rectangle
 * @param {number} oldX - Previous X position
 * @param {number} oldY - Previous Y position
 */
function resolveCollision(player, obstacle, oldX, oldY) {
  const halfSize = CONSTANTS.PLAYER_SIZE / 2;
  const playerRect = getPlayerRect(player);

  // Calculate overlap on each axis
  const overlapLeft = (playerRect.x + playerRect.width) - obstacle.x;
  const overlapRight = (obstacle.x + obstacle.width) - playerRect.x;
  const overlapTop = (playerRect.y + playerRect.height) - obstacle.y;
  const overlapBottom = (obstacle.y + obstacle.height) - playerRect.y;

  // Find minimum overlap
  const minOverlapX = Math.min(overlapLeft, overlapRight);
  const minOverlapY = Math.min(overlapTop, overlapBottom);

  // Push out along axis of least penetration
  if (minOverlapX < minOverlapY) {
    // Push horizontally
    if (overlapLeft < overlapRight) {
      player.x = obstacle.x - halfSize;
    } else {
      player.x = obstacle.x + obstacle.width + halfSize;
    }
    player.vx = 0;
  } else {
    // Push vertically
    if (overlapTop < overlapBottom) {
      player.y = obstacle.y - halfSize;
    } else {
      player.y = obstacle.y + obstacle.height + halfSize;
    }
    player.vy = 0;
  }
}

// ============================================
// Line of Sight
// ============================================

/**
 * Check if there's a clear line of sight between two points
 * @param {number} x1 - Start X coordinate
 * @param {number} y1 - Start Y coordinate
 * @param {number} x2 - End X coordinate
 * @param {number} y2 - End Y coordinate
 * @param {Array} obstacles - Array of obstacle rectangles
 * @returns {boolean} True if line of sight is clear
 */
function hasLineOfSight(x1, y1, x2, y2, obstacles) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.hypot(dx, dy);

  // Step through line every 10px
  const steps = Math.ceil(distance / 10);

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const x = x1 + dx * t;
    const y = y1 + dy * t;

    for (const obstacle of obstacles) {
      if (pointInRect(x, y, obstacle)) {
        return false; // Blocked by obstacle
      }
    }
  }

  return true; // Clear line of sight
}

// ============================================
// Visibility Check
// ============================================

/**
 * Normalize angle to range [-PI, PI]
 * @param {number} angle - Angle in radians
 * @returns {number} Normalized angle
 */
function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * Check if target player is visible to viewer
 * @param {Object} viewer - The player doing the looking
 * @param {Object} target - The player being looked at
 * @param {Array} obstacles - Array of obstacle rectangles
 * @param {boolean} muzzleFlashActive - Whether muzzle flash is currently active
 * @returns {boolean} True if target is visible to viewer
 */
function isPlayerVisible(viewer, target, obstacles, muzzleFlashActive) {
  // During muzzle flash, everyone is visible
  if (muzzleFlashActive) {
    return true;
  }

  // If viewer's flashlight is off, they can't see anyone
  if (!viewer.flashlightOn) {
    return false;
  }

  // Calculate vector from viewer to target
  const dx = target.x - viewer.x;
  const dy = target.y - viewer.y;
  const distance = Math.hypot(dx, dy);

  // Check if target is within flashlight range
  if (distance > CONSTANTS.FLASHLIGHT_RANGE) {
    return false;
  }

  // Calculate angle to target
  const angleToTarget = Math.atan2(dy, dx);

  // Calculate angle difference (normalized)
  const angleDiff = normalizeAngle(angleToTarget - viewer.facing);

  // Convert flashlight angle from degrees to radians and get half cone
  const halfCone = (CONSTANTS.FLASHLIGHT_ANGLE / 2) * (Math.PI / 180);

  // Check if target is within flashlight cone
  if (Math.abs(angleDiff) > halfCone) {
    return false;
  }

  // Check line of sight (obstacle blocking)
  return hasLineOfSight(viewer.x, viewer.y, target.x, target.y, obstacles);
}

// ============================================
// Exports
// ============================================

module.exports = {
  // AABB Collision Detection
  rectsCollide,
  pointInRect,

  // Hitbox Helpers
  getPlayerRect,
  getProjectileRect,

  // Movement
  applyInput,
  movePlayer,
  resolveCollision,

  // Line of Sight
  hasLineOfSight,

  // Visibility
  isPlayerVisible,
  normalizeAngle,
};
