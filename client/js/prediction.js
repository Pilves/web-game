// Client-side player movement prediction, obstacle collision, and server reconciliation
import { CONFIG } from './config.js';

/**
 * Predict local player movement based on input
 * @param {Object} localPlayer - Local player state {x, y, vx, vy, facing, stunned}
 * @param {Object} input - Input state {up, down, left, right, sprint, facing}
 * @param {number} dt - Delta time in seconds
 * @param {number} arenaInset - Arena inset for sudden death
 */
export function predictLocalPlayer(localPlayer, input, dt, arenaInset) {
  if (!localPlayer) return;

  // Initialize velocity if not present
  if (localPlayer.vx === undefined) localPlayer.vx = 0;
  if (localPlayer.vy === undefined) localPlayer.vy = 0;

  // Handle stunned state - apply friction but don't allow new input
  if (localPlayer.stunned) {
    const PLAYER_FRICTION = 0.85;
    localPlayer.vx *= PLAYER_FRICTION;
    localPlayer.vy *= PLAYER_FRICTION;

    localPlayer.x += localPlayer.vx * dt;
    localPlayer.y += localPlayer.vy * dt;

    localPlayer.facing = input.facing;

    applyBoundaryAndCollision(localPlayer, arenaInset);
    return;
  }

  // Calculate speed based on sprint
  const speed = input.sprint ? CONFIG.PLAYER_SPRINT_SPEED : CONFIG.PLAYER_SPEED;

  // Calculate velocity from input
  let vx = 0;
  let vy = 0;

  if (input.up) vy -= 1;
  if (input.down) vy += 1;
  if (input.left) vx -= 1;
  if (input.right) vx += 1;

  // Normalize diagonal movement
  const length = Math.hypot(vx, vy);
  if (length > 0) {
    vx = (vx / length) * speed;
    vy = (vy / length) * speed;
  }

  // Store velocity for stun friction continuity
  localPlayer.vx = vx;
  localPlayer.vy = vy;

  // Apply velocity
  localPlayer.x += vx * dt;
  localPlayer.y += vy * dt;

  // Update facing direction
  localPlayer.facing = input.facing;

  // Handle boundary and collision
  applyBoundaryAndCollision(localPlayer, arenaInset);
}

/**
 * Apply boundary wrapping/clamping and obstacle collision
 * @param {Object} localPlayer - Local player state {x, y, vx, vy}
 * @param {number} arenaInset - Arena inset for sudden death
 */
export function applyBoundaryAndCollision(localPlayer, arenaInset) {
  const halfSize = CONFIG.PLAYER_SIZE / 2;
  const arenaWidth = CONFIG.ARENA_WIDTH;
  const arenaHeight = CONFIG.ARENA_HEIGHT;

  if (arenaInset > 0) {
    // During sudden death, clamp to shrinking arena bounds
    const minX = arenaInset + halfSize;
    const maxX = arenaWidth - arenaInset - halfSize;
    const minY = arenaInset + halfSize;
    const maxY = arenaHeight - arenaInset - halfSize;

    if (localPlayer.x < minX) { localPlayer.x = minX; localPlayer.vx = 0; }
    if (localPlayer.x > maxX) { localPlayer.x = maxX; localPlayer.vx = 0; }
    if (localPlayer.y < minY) { localPlayer.y = minY; localPlayer.vy = 0; }
    if (localPlayer.y > maxY) { localPlayer.y = maxY; localPlayer.vy = 0; }
  } else {
    // Normal mode: wrap around arena bounds
    if (localPlayer.x < -halfSize) {
      localPlayer.x += arenaWidth;
    } else if (localPlayer.x > arenaWidth + halfSize) {
      localPlayer.x -= arenaWidth;
    }

    if (localPlayer.y < -halfSize) {
      localPlayer.y += arenaHeight;
    } else if (localPlayer.y > arenaHeight + halfSize) {
      localPlayer.y -= arenaHeight;
    }
  }

  // Simple obstacle collision
  for (const obstacle of CONFIG.OBSTACLES) {
    resolveCollision(localPlayer, obstacle);
  }
}

/**
 * Simple AABB collision resolution
 * @param {Object} player - Player {x, y}
 * @param {Object} obstacle - Obstacle {x, y, width, height}
 */
export function resolveCollision(player, obstacle) {
  const halfSize = CONFIG.PLAYER_SIZE / 2;
  const playerRect = {
    left: player.x - halfSize,
    right: player.x + halfSize,
    top: player.y - halfSize,
    bottom: player.y + halfSize,
  };

  const obstRect = {
    left: obstacle.x,
    right: obstacle.x + obstacle.width,
    top: obstacle.y,
    bottom: obstacle.y + obstacle.height,
  };

  if (playerRect.right > obstRect.left &&
      playerRect.left < obstRect.right &&
      playerRect.bottom > obstRect.top &&
      playerRect.top < obstRect.bottom) {

    const overlapLeft = playerRect.right - obstRect.left;
    const overlapRight = obstRect.right - playerRect.left;
    const overlapTop = playerRect.bottom - obstRect.top;
    const overlapBottom = obstRect.bottom - playerRect.top;

    const minOverlapX = Math.min(overlapLeft, overlapRight);
    const minOverlapY = Math.min(overlapTop, overlapBottom);

    if (minOverlapX < minOverlapY) {
      if (overlapLeft < overlapRight) {
        player.x = obstRect.left - halfSize;
      } else {
        player.x = obstRect.right + halfSize;
      }
    } else {
      if (overlapTop < overlapBottom) {
        player.y = obstRect.top - halfSize;
      } else {
        player.y = obstRect.bottom + halfSize;
      }
    }
  }
}

/**
 * Reconcile local player position with server state
 * @param {Object} localPlayer - Local player state (mutated in place)
 * @param {Object} serverPlayer - Server player data {x, y, stunned, ...}
 * @returns {boolean} true if localPlayer was initialized (first call)
 */
export function reconcileWithServer(localPlayer, serverPlayer) {
  if (!serverPlayer) return false;

  // Initialize local player if needed
  if (!localPlayer) return false;

  // Update stunned state from server
  localPlayer.stunned = serverPlayer.stunned;

  // Calculate difference between predicted and server position
  const dx = serverPlayer.x - localPlayer.x;
  const dy = serverPlayer.y - localPlayer.y;
  const distance = Math.hypot(dx, dy);

  if (distance < 5) {
    localPlayer.x += dx * 0.3;
    localPlayer.y += dy * 0.3;
  } else if (distance < 50) {
    localPlayer.x += dx * 0.5;
    localPlayer.y += dy * 0.5;
  } else {
    localPlayer.x = serverPlayer.x;
    localPlayer.y = serverPlayer.y;
  }
}

/**
 * Initialize a local player from server data
 * @param {Object} serverPlayer - Server player data {x, y, facing, stunned, ...}
 * @returns {Object} New local player object
 */
export function initLocalPlayer(serverPlayer) {
  return {
    x: serverPlayer.x,
    y: serverPlayer.y,
    facing: serverPlayer.facing,
    stunned: serverPlayer.stunned,
    vx: 0,
    vy: 0,
  };
}
