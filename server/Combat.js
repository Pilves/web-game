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

/**
 * Check if two axis-aligned bounding boxes collide
 * @param {Object} a - First rectangle { x, y, width, height }
 * @param {Object} b - Second rectangle { x, y, width, height }
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
 * Get bounding rectangle for a player (centered on position)
 * @param {Object} player - Player object with x, y coordinates
 * @returns {Object} Rectangle { x, y, width, height }
 */
function getPlayerRect(player) {
  return {
    x: player.x - PLAYER_SIZE / 2,
    y: player.y - PLAYER_SIZE / 2,
    width: PLAYER_SIZE,
    height: PLAYER_SIZE,
  };
}

/**
 * Get bounding rectangle for a projectile (centered on position)
 * @param {Object} projectile - Projectile object with x, y coordinates
 * @returns {Object} Rectangle { x, y, width, height }
 */
function getProjectileRect(projectile) {
  return {
    x: projectile.x - PROJECTILE_SIZE / 2,
    y: projectile.y - PROJECTILE_SIZE / 2,
    width: PROJECTILE_SIZE,
    height: PROJECTILE_SIZE,
  };
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

  for (const playerId in players) {
    const player = players[playerId];

    // Cannot hit yourself
    if (player.id === projectile.ownerId) {
      continue;
    }

    // Cannot hit invincible players
    if (player.invincibleUntil && now < player.invincibleUntil) {
      continue;
    }

    // Cannot hit stunned players
    if (player.stunnedUntil && now < player.stunnedUntil) {
      continue;
    }

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
 * @returns {Object} Event data { type, victimId, attackerId, isDeath }
 */
function handleHit(victim, attacker, projectile) {
  const now = Date.now();

  // Reduce victim's hearts
  victim.hearts -= 1;

  // Set invincibility and stun
  victim.invincibleUntil = now + INVINCIBILITY_DURATION;
  victim.stunnedUntil = now + STUN_DURATION;

  // Apply knockback - push away from projectile direction
  // Normalize projectile velocity to get direction
  const speed = Math.hypot(projectile.vx, projectile.vy);
  if (speed > 0) {
    const dirX = projectile.vx / speed;
    const dirY = projectile.vy / speed;

    // Apply knockback distance
    victim.x += dirX * KNOCKBACK_DISTANCE;
    victim.y += dirY * KNOCKBACK_DISTANCE;

    // Clamp to arena bounds
    const halfSize = PLAYER_SIZE / 2;
    victim.x = Math.max(halfSize, Math.min(ARENA_WIDTH - halfSize, victim.x));
    victim.y = Math.max(halfSize, Math.min(ARENA_HEIGHT - halfSize, victim.y));
  }

  // Victim drops their pillow (if they had one)
  victim.hasAmmo = false;

  // Increment attacker's kill count
  if (attacker) {
    attacker.kills = (attacker.kills || 0) + 1;
  }

  // Check for death
  const isDeath = victim.hearts <= 0;

  if (isDeath) {
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
  const updatedProjectiles = [];
  const events = [];
  const now = Date.now();

  for (const projectile of projectiles) {
    // Move projectile
    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    // Check lifetime (2 seconds max)
    if (now - projectile.createdAt > PROJECTILE_LIFETIME) {
      // Projectile expired, don't add to updated list
      continue;
    }

    // Check wall collision
    if (isOutOfBounds(projectile.x, projectile.y, arenaInset)) {
      // Hit wall, create event
      events.push({
        type: 'wall-hit',
        projectileId: projectile.id,
        x: projectile.x,
        y: projectile.y,
      });
      continue;
    }

    // Check obstacle collision
    if (collidesWithObstacle(projectile, obstacles)) {
      // Hit obstacle, create event
      events.push({
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
      // Find attacker
      const attacker = players[projectile.ownerId] || null;

      // Handle the hit
      const hitEvent = handleHit(hitPlayer, attacker, projectile);
      events.push(hitEvent);

      // Don't add projectile to updated list (it's consumed)
      continue;
    }

    // Projectile still active
    updatedProjectiles.push(projectile);
  }

  return {
    updatedProjectiles,
    events,
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
