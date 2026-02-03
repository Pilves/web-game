/**
 * Combat.js - Projectile and hit detection system for LIGHTS OUT
 *
 * Handles:
 * - Projectile creation with spread mechanics
 * - Projectile movement and collision detection
 * - Hit detection against players
 * - Damage application and knockback
 * - Throw validation and cooldowns
 */

const CONSTANTS = require('./constants');
const GEOMETRY = require('../shared/geometry.js');
const Physics = require('./Physics.js');

// Import shared geometry functions
const { rectsCollide } = GEOMETRY;

// Import collision resolution from Physics
const { resolveCollision } = Physics;

const {
  PROJECTILE_SPEED,
  PROJECTILE_BORDER_BOOST,
  PROJECTILE_SIZE,
  THROW_COOLDOWN,
  THROW_SPREAD_DARK,
  STUN_DURATION,
  INVINCIBILITY_DURATION,
  KNOCKBACK_DISTANCE,
  PLAYER_SIZE,
  ARENA_WIDTH,
  ARENA_HEIGHT,
} = CONSTANTS;

// Maximum projectile lifetime in milliseconds
const PROJECTILE_LIFETIME = 2000;

// Reusable arrays for updateProjectiles to avoid GC pressure
const _updatedProjectiles = [];
const _events = [];

// Import shared hitbox helpers
const { getPlayerRect, getProjectileRect } = require('./Hitbox.js');

/**
 * Check if a position is outside the arena bounds
 * Uses strict comparison (< and >) for consistency with Physics.js player boundary checks.
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {number} arenaInset - Arena shrink amount (for sudden death)
 * @returns {boolean} True if outside bounds
 */
function isOutOfBounds(x, y, arenaInset = 0) {
  const halfSize = PROJECTILE_SIZE / 2;
  return (
    x - halfSize < arenaInset ||
    x + halfSize > ARENA_WIDTH - arenaInset ||
    y - halfSize < arenaInset ||
    y + halfSize > ARENA_HEIGHT - arenaInset
  );
}

/**
 * Check if a projectile collides with any obstacle
 * @param {Object} projectile - Projectile object
 * @param {Array} obstacles - Array of obstacle objects
 * @returns {boolean} True if collision detected
 */
function collidesWithObstacle(projectile, obstacles) {
  const projRect = getProjectileRect(projectile);

  for (const obstacle of obstacles) {
    if (rectsCollide(projRect, obstacle)) {
      return true;
    }
  }

  return false;
}

/**
 * Create a new projectile from a player's throw
 * @param {Object} player - Player throwing the projectile
 * @param {string} projectileId - Unique ID for the projectile
 * @returns {Object} Projectile object { id, ownerId, x, y, vx, vy, createdAt }
 */
function createProjectile(player, projectileId) {
  // Start from the player's facing direction
  let angle = player.facing;

  // Apply random spread if flashlight is off
  if (!player.flashlightOn) {
    // Convert spread from degrees to radians
    const spreadRad = (THROW_SPREAD_DARK * Math.PI) / 180;
    // Random spread in range [-spread, +spread]
    const randomSpread = (Math.random() * 2 - 1) * spreadRad;
    angle += randomSpread;
  }

  // Calculate velocity components
  const vx = Math.cos(angle) * PROJECTILE_SPEED;
  const vy = Math.sin(angle) * PROJECTILE_SPEED;

  // Spawn projectile slightly in front of player to avoid self-collision
  const spawnOffset = PLAYER_SIZE / 2 + PROJECTILE_SIZE / 2 + 5;
  const startX = player.x + Math.cos(angle) * spawnOffset;
  const startY = player.y + Math.sin(angle) * spawnOffset;

  return {
    id: projectileId,
    ownerId: player.id,
    x: startX,
    y: startY,
    vx: vx,
    vy: vy,
    createdAt: Date.now(),
  };
}

/**
 * Check if a player can throw a projectile
 * @param {Object} player - Player attempting to throw
 * @param {number} now - Current timestamp
 * @returns {boolean} True if player can throw
 */
function canThrow(player, now) {
  // Dead players can't throw
  if (player.hearts <= 0) {
    return false;
  }

  // Must have ammo
  if (!player.hasAmmo) {
    return false;
  }

  // Check cooldown (lastThrowTime defaults to 0)
  if (now - (player.lastThrowTime || 0) < THROW_COOLDOWN) {
    return false;
  }

  // Cannot throw while stunned
  if (player.stunnedUntil && now < player.stunnedUntil) {
    return false;
  }

  return true;
}

/**
 * Check if a projectile hits any player
 * @param {Object} projectile - Projectile to check
 * @param {Map|Object} players - Map or Object of player ID to player objects
 * @returns {Object|null} Hit player or null
 */
function checkProjectileHit(projectile, players) {
  const projRect = getProjectileRect(projectile);
  const now = Date.now();

  // Support both Map and Object iteration (Map is more efficient)
  const entries = players instanceof Map ? players : Object.entries(players);
  for (const [playerId, player] of entries) {

    // Cannot hit yourself
    if (player.id === projectile.ownerId) {
      continue;
    }

    // Cannot hit invincible players
    if (player.invincibleUntil && now < player.invincibleUntil) {
      continue;
    }

    // REMOVED: Stunned players CAN be hit (they just can't move)
    // if (player.stunnedUntil && now < player.stunnedUntil) {
    //   continue;
    // }

    // Cannot hit disconnected players
    if (!player.connected) {
      continue;
    }

    // Cannot hit dead players
    if (player.hearts <= 0) {
      continue;
    }

    const playerRect = getPlayerRect(player);

    if (rectsCollide(projRect, playerRect)) {
      return player;
    }
  }

  return null;
}

/**
 * Handle a hit on a player
 * @param {Object} victim - Player who was hit
 * @param {Object} attacker - Player who threw the projectile
 * @param {Object} projectile - The projectile that hit
 * @param {Array} obstacles - Array of obstacle objects for collision resolution
 * @param {number} arenaInset - Arena shrink amount (for sudden death)
 * @returns {Object} Event data { type, victimId, attackerId, isDeath }
 */
function handleHit(victim, attacker, projectile, obstacles = [], arenaInset = 0) {
  const now = Date.now();

  // Reduce victim's hearts
  victim.hearts -= 1;

  // Set invincibility and stun
  victim.invincibleUntil = now + INVINCIBILITY_DURATION;
  victim.stunnedUntil = now + STUN_DURATION;

  // Apply knockback - push away from projectile direction
  // Normalize projectile velocity to get direction
  // Division by zero protection: speed is always > 0 for active projectiles
  // since they have non-zero velocity, but we check explicitly to be safe
  const speed = Math.hypot(projectile.vx, projectile.vy);
  if (speed > 0) {
    // Store position BEFORE knockback for collision resolution
    // resolveCollision needs the pre-knockback position to correctly
    // calculate which direction to push the player out of obstacles
    const oldX = victim.x;
    const oldY = victim.y;

    const dirX = projectile.vx / speed;
    const dirY = projectile.vy / speed;

    // Apply knockback distance
    victim.x += dirX * KNOCKBACK_DISTANCE;
    victim.y += dirY * KNOCKBACK_DISTANCE;

    // Clamp to arena bounds (accounting for arena inset during sudden death)
    const halfSize = PLAYER_SIZE / 2;
    const minBound = arenaInset + halfSize;
    const maxBoundX = ARENA_WIDTH - arenaInset - halfSize;
    const maxBoundY = ARENA_HEIGHT - arenaInset - halfSize;
    victim.x = Math.max(minBound, Math.min(maxBoundX, victim.x));
    victim.y = Math.max(minBound, Math.min(maxBoundY, victim.y));

    // Check for obstacle collisions after knockback and resolve them
    const playerRect = getPlayerRect(victim);
    for (const obstacle of obstacles) {
      if (rectsCollide(playerRect, obstacle)) {
        resolveCollision(victim, obstacle, oldX, oldY);
      }
    }
  }

  // Victim drops their pillow (if they had one)
  victim.hasAmmo = false;

  // Check for death
  const isDeath = victim.hearts <= 0;

  if (isDeath) {
    // Increment attacker's kill count only on actual kill
    // Explicit null/undefined check: attacker can be null if the throwing player
    // disconnected before the projectile hit, or if projectile.ownerId is invalid.
    // CRITICAL: Only increment kills when attacker is explicitly connected (=== true)
    // to prevent awarding kills to disconnected players whose projectiles are still in flight.
    if (attacker !== null && attacker !== undefined && attacker.connected === true) {
      attacker.kills = (attacker.kills || 0) + 1;
    }
    victim.deaths = (victim.deaths || 0) + 1;
  }

  return {
    type: isDeath ? 'death' : 'hit',
    victimId: victim.id,
    attackerId: attacker ? attacker.id : null,
    isDeath: isDeath,
    victimX: victim.x,
    victimY: victim.y,
  };
}

/**
 * Update all projectiles for one physics tick
 *
 * NOTE ON ARRAY MUTATION: This function mutates projectile positions in-place for
 * performance reasons (avoiding object allocation per projectile per frame). The
 * returned `updatedProjectiles` array contains references to the same projectile
 * objects that were passed in. Callers should be aware that:
 * 1. The input `projectiles` array should not be used after calling this function
 * 2. The returned array is a new array (via slice()) but contains the same objects
 * 3. Projectiles removed from the array (due to hits, expiry, etc.) still exist
 *    in memory until no references remain
 *
 * @param {Array} projectiles - Array of projectile objects (will be mutated)
 * @param {number} dt - Delta time in seconds
 * @param {Array} obstacles - Array of obstacle objects
 * @param {Object} players - Map of player ID to player objects
 * @param {number} arenaInset - Arena shrink amount (for sudden death)
 * @returns {Object} { updatedProjectiles, events }
 */
function updateProjectiles(projectiles, dt, obstacles, players, arenaInset = 0) {
  // Reuse arrays by clearing them instead of creating new ones
  _updatedProjectiles.length = 0;
  _events.length = 0;
  const now = Date.now();

  for (const projectile of projectiles) {
    // Check lifetime FIRST (2 seconds max) - prevents extra frame of movement
    if (now - projectile.createdAt >= PROJECTILE_LIFETIME) {
      // Projectile expired, don't add to updated list
      continue;
    }

    // Move projectile
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    // Handle boundaries - wrap around like Snake (except during sudden death)
    const halfSize = PROJECTILE_SIZE / 2;
    if (arenaInset === 0) {
      // Wrap around mode - boost speed on border crossing
      let crossed = false;
      if (projectile.x < -halfSize) {
        projectile.x += ARENA_WIDTH;
        crossed = true;
      } else if (projectile.x > ARENA_WIDTH + halfSize) {
        projectile.x -= ARENA_WIDTH;
        crossed = true;
      }

      if (projectile.y < -halfSize) {
        projectile.y += ARENA_HEIGHT;
        crossed = true;
      } else if (projectile.y > ARENA_HEIGHT + halfSize) {
        projectile.y -= ARENA_HEIGHT;
        crossed = true;
      }

      // Speed boost after crossing border (only once)
      if (crossed && !projectile.boosted) {
        projectile.vx *= PROJECTILE_BORDER_BOOST;
        projectile.vy *= PROJECTILE_BORDER_BOOST;
        projectile.boosted = true;
      }
    } else {
      // During sudden death, projectiles hit walls
      if (isOutOfBounds(projectile.x, projectile.y, arenaInset)) {
        _events.push({
          type: 'wall-hit',
          projectileId: projectile.id,
          x: projectile.x,
          y: projectile.y,
        });
        continue;
      }
    }

    // Check obstacle collision
    if (collidesWithObstacle(projectile, obstacles)) {
      // Hit obstacle, create event
      _events.push({
        type: 'obstacle-hit',
        projectileId: projectile.id,
        x: projectile.x,
        y: projectile.y,
      });
      continue;
    }

    // Check player collision
    const hitPlayer = checkProjectileHit(projectile, players);
    if (hitPlayer) {
      // Find attacker - support both Map and Object lookup
      const attacker = players instanceof Map
        ? players.get(projectile.ownerId) || null
        : (Object.hasOwn(players, projectile.ownerId) ? players[projectile.ownerId] : null);

      // Handle the hit (pass obstacles and arenaInset for knockback collision resolution)
      const hitEvent = handleHit(hitPlayer, attacker, projectile, obstacles, arenaInset);
      _events.push(hitEvent);

      // Don't add projectile to updated list (it's consumed)
      continue;
    }

    // Projectile still active
    _updatedProjectiles.push(projectile);
  }

  // Return copies of the arrays to avoid shared array mutation race conditions.
  // Callers may hold onto or mutate these arrays, and returning the shared
  // arrays directly would cause issues when the next call clears them.
  return {
    updatedProjectiles: _updatedProjectiles.slice(),
    events: _events.slice(),
  };
}

// Export all functions for use by GameRoom
module.exports = {
  createProjectile,
  updateProjectiles,
  checkProjectileHit,
  handleHit,
  canThrow,
  // Also export helpers that might be useful
  rectsCollide,
  getPlayerRect,
  getProjectileRect,
  isOutOfBounds,
  collidesWithObstacle,
  PROJECTILE_LIFETIME,
};
