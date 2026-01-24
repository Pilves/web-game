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

// Reusable rect objects to reduce GC pressure
// WARNING: These are shared mutable objects! Functions that return these objects
// (getPlayerRect, getProjectileRect) return references to these same objects.
// Callers MUST use the returned value immediately before any other call to these
// functions, or copy the values if they need to persist across multiple calls.
// Example of UNSAFE code:
//   const rect1 = getPlayerRect(player1);
//   const rect2 = getPlayerRect(player2);  // rect1 is now INVALID, points to player2's data!
// Example of SAFE code:
//   const rect1 = getPlayerRect(player1);
//   // use rect1 immediately here
//   const rect2 = getPlayerRect(player2);
//   // use rect2 immediately here
const _playerRect = { x: 0, y: 0, width: PLAYER_SIZE, height: PLAYER_SIZE };
const _projectileRect = { x: 0, y: 0, width: PROJECTILE_SIZE, height: PROJECTILE_SIZE };

/**
 * Get bounding rectangle for a player (centered on position)
 * WARNING: Returns a reusable object - do not store reference, copy if needed
 * @param {Object} player - Player object with x, y coordinates
 * @returns {Object} Rectangle { x, y, width, height }
 */
function getPlayerRect(player) {
  _playerRect.x = player.x - PLAYER_SIZE / 2;
  _playerRect.y = player.y - PLAYER_SIZE / 2;
  return _playerRect;
}

/**
 * Get bounding rectangle for a projectile (centered on position)
 * WARNING: Returns a reusable object - do not store reference, copy if needed
 * @param {Object} projectile - Projectile object with x, y coordinates
 * @returns {Object} Rectangle { x, y, width, height }
 */
function getProjectileRect(projectile) {
  _projectileRect.x = projectile.x - PROJECTILE_SIZE / 2;
  _projectileRect.y = projectile.y - PROJECTILE_SIZE / 2;
  return _projectileRect;
}

/**
 * Check if a position is outside the arena bounds
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
 * @param {Object} players - Map of player ID to player objects
 * @returns {Object|null} Hit player or null
 */
function checkProjectileHit(projectile, players) {
  const projRect = getProjectileRect(projectile);
  const now = Date.now();

  for (const [playerId, player] of Object.entries(players)) {

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
    // disconnected before the projectile hit, or if projectile.ownerId is invalid
    if (attacker !== null && attacker !== undefined && attacker.connected) {
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
 * @param {Array} projectiles - Array of projectile objects
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
      // Wrap around mode
      if (projectile.x < -halfSize) {
        projectile.x += ARENA_WIDTH;
      } else if (projectile.x > ARENA_WIDTH + halfSize) {
        projectile.x -= ARENA_WIDTH;
      }

      if (projectile.y < -halfSize) {
        projectile.y += ARENA_HEIGHT;
      } else if (projectile.y > ARENA_HEIGHT + halfSize) {
        projectile.y -= ARENA_HEIGHT;
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
      // Find attacker - use Object.hasOwn() to safely check if player exists
      // This avoids issues with inherited properties or prototype pollution
      const attacker = Object.hasOwn(players, projectile.ownerId) ? players[projectile.ownerId] : null;

      // Handle the hit (pass obstacles and arenaInset for knockback collision resolution)
      const hitEvent = handleHit(hitPlayer, attacker, projectile, obstacles, arenaInset);
      _events.push(hitEvent);

      // Don't add projectile to updated list (it's consumed)
      continue;
    }

    // Projectile still active
    _updatedProjectiles.push(projectile);
  }

  return {
    updatedProjectiles: _updatedProjectiles,
    events: _events,
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
