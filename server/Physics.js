/**
 * Physics.js - Movement, collision detection, and visibility for LIGHTS OUT
 */

const CONSTANTS = require('./constants.js');
const GEOMETRY = require('../shared/geometry.js');

// Import shared geometry functions
const { rectsCollide, pointInRect, normalizeAngle, hasLineOfSight } = GEOMETRY;

// ============================================
// Hitbox Helpers - Reusable rect objects to reduce GC pressure
// ============================================

// Reusable rect objects - populated by getPlayerRect/getProjectileRect
const _playerRect = { x: 0, y: 0, width: CONSTANTS.PLAYER_SIZE, height: CONSTANTS.PLAYER_SIZE };
const _projectileRect = { x: 0, y: 0, width: CONSTANTS.PROJECTILE_SIZE, height: CONSTANTS.PROJECTILE_SIZE };

/**
 * Get the bounding rectangle for a player (centered on position)
 * WARNING: Returns a reusable object - do not store reference, copy if needed
 * @param {Object} player - Player object with x, y properties
 * @returns {Object} Rectangle {x, y, width, height}
 */
function getPlayerRect(player) {
  _playerRect.x = player.x - CONSTANTS.PLAYER_SIZE / 2;
  _playerRect.y = player.y - CONSTANTS.PLAYER_SIZE / 2;
  return _playerRect;
}

/**
 * Get the bounding rectangle for a projectile (centered on position)
 * WARNING: Returns a reusable object - do not store reference, copy if needed
 * @param {Object} projectile - Projectile object with x, y properties
 * @returns {Object} Rectangle {x, y, width, height}
 */
function getProjectileRect(projectile) {
  _projectileRect.x = projectile.x - CONSTANTS.PROJECTILE_SIZE / 2;
  _projectileRect.y = projectile.y - CONSTANTS.PROJECTILE_SIZE / 2;
  return _projectileRect;
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
    // No input - apply friction (framerate independent)
    const frictionFactor = Math.pow(CONSTANTS.PLAYER_FRICTION, dt * 60);
    player.vx *= frictionFactor;
    player.vy *= frictionFactor;

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

  // Check wall boundaries - wrap around like Snake (except during sudden death)
  if (arenaInset <= 0) {
    // Wrap around mode
    const arenaWidth = CONSTANTS.ARENA_WIDTH;
    const arenaHeight = CONSTANTS.ARENA_HEIGHT;

    if (player.x < -halfSize) {
      player.x += arenaWidth;
    } else if (player.x > arenaWidth + halfSize) {
      player.x -= arenaWidth;
    }
    if (player.y < -halfSize) {
      player.y += arenaHeight;
    } else if (player.y > arenaHeight + halfSize) {
      player.y -= arenaHeight;
    }
  } else {
    // During sudden death, clamp to shrinking arena
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
  }

  // Check obstacle collisions
  for (const obstacle of obstacles) {
    const playerRect = getPlayerRect(player);  // Move inside loop
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
  // overlapLeft: how far the player's RIGHT edge penetrates past the obstacle's LEFT edge
  // overlapRight: how far the player's LEFT edge penetrates past the obstacle's RIGHT edge
  // overlapTop: how far the player's BOTTOM edge penetrates past the obstacle's TOP edge
  // overlapBottom: how far the player's TOP edge penetrates past the obstacle's BOTTOM edge
  const overlapLeft = (playerRect.x + playerRect.width) - obstacle.x;
  const overlapRight = (obstacle.x + obstacle.width) - playerRect.x;
  const overlapTop = (playerRect.y + playerRect.height) - obstacle.y;
  const overlapBottom = (obstacle.y + obstacle.height) - playerRect.y;

  // Find minimum overlap on each axis to determine shortest escape direction
  const minOverlapX = Math.min(overlapLeft, overlapRight);
  const minOverlapY = Math.min(overlapTop, overlapBottom);

  // Push out along axis of least penetration (shortest distance to escape collision)
  if (minOverlapX < minOverlapY) {
    // Push horizontally - less penetration on X axis
    if (overlapLeft < overlapRight) {
      // Player came from the left, push back to obstacle's left edge
      player.x = obstacle.x - halfSize;
    } else {
      // Player came from the right, push back to obstacle's right edge
      player.x = obstacle.x + obstacle.width + halfSize;
    }
    player.vx = 0;
  } else {
    // Push vertically - less penetration on Y axis
    if (overlapTop < overlapBottom) {
      // Player came from above, push back to obstacle's top edge
      player.y = obstacle.y - halfSize;
    } else {
      // Player came from below, push back to obstacle's bottom edge
      player.y = obstacle.y + obstacle.height + halfSize;
    }
    player.vy = 0;
  }
}

// ============================================
// Visibility Check
// ============================================

/**
 * Check if target player is visible to viewer
 * @param {Object} viewer - The player doing the looking
 * @param {Object} target - The player being looked at
 * @param {Array} obstacles - Array of obstacle rectangles
 * @param {boolean} muzzleFlashActive - Whether muzzle flash is currently active
 * @returns {boolean} True if target is visible to viewer
 */
function isPlayerVisible(viewer, target, obstacles, muzzleFlashActive) {
  // Validate viewer and target exist with required properties
  if (!viewer || typeof viewer.x !== 'number' || typeof viewer.y !== 'number' ||
      typeof viewer.facing !== 'number') {
    return false;
  }
  if (!target || typeof target.x !== 'number' || typeof target.y !== 'number') {
    return false;
  }

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
