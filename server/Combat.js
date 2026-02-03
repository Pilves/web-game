const CONSTANTS = require('./constants');
const GEOMETRY = require('../shared/geometry.js');
const Physics = require('./Physics.js');

const { rectsCollide } = GEOMETRY;
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

const PROJECTILE_LIFETIME = 2000;

// Reusable arrays for updateProjectiles
const _updatedProjectiles = [];
const _events = [];

const { getPlayerRect, getProjectileRect } = require('./Hitbox.js');

function isOutOfBounds(x, y, arenaInset = 0) {
  const halfSize = PROJECTILE_SIZE / 2;
  return (
    x - halfSize < arenaInset ||
    x + halfSize > ARENA_WIDTH - arenaInset ||
    y - halfSize < arenaInset ||
    y + halfSize > ARENA_HEIGHT - arenaInset
  );
}

function collidesWithObstacle(projectile, obstacles) {
  const projRect = getProjectileRect(projectile);

  for (const obstacle of obstacles) {
    if (rectsCollide(projRect, obstacle)) {
      return true;
    }
  }

  return false;
}

function createProjectile(player, projectileId) {
  let angle = player.facing;

  // Random spread when flashlight is off
  if (!player.flashlightOn) {
    const spreadRad = (THROW_SPREAD_DARK * Math.PI) / 180;
    const randomSpread = (Math.random() * 2 - 1) * spreadRad;
    angle += randomSpread;
  }

  const vx = Math.cos(angle) * PROJECTILE_SPEED;
  const vy = Math.sin(angle) * PROJECTILE_SPEED;

  // Spawn slightly in front of player
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

function canThrow(player, now) {
  if (player.hearts <= 0) {
    return false;
  }

  if (!player.hasAmmo) {
    return false;
  }

  if (now - (player.lastThrowTime || 0) < THROW_COOLDOWN) {
    return false;
  }

  if (player.stunnedUntil && now < player.stunnedUntil) {
    return false;
  }

  return true;
}

function checkProjectileHit(projectile, players) {
  const projRect = getProjectileRect(projectile);
  const now = Date.now();

  const entries = players instanceof Map ? players : Object.entries(players);
  for (const [playerId, player] of entries) {
    if (player.id === projectile.ownerId) {
      continue;
    }

    if (player.invincibleUntil && now < player.invincibleUntil) {
      continue;
    }

    if (!player.connected) {
      continue;
    }

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

function handleHit(victim, attacker, projectile, obstacles = [], arenaInset = 0) {
  const now = Date.now();

  victim.hearts -= 1;

  victim.invincibleUntil = now + INVINCIBILITY_DURATION;
  victim.stunnedUntil = now + STUN_DURATION;

  // Knockback in projectile direction
  const speed = Math.hypot(projectile.vx, projectile.vy);
  if (speed > 0) {
    const oldX = victim.x;
    const oldY = victim.y;

    const dirX = projectile.vx / speed;
    const dirY = projectile.vy / speed;

    victim.x += dirX * KNOCKBACK_DISTANCE;
    victim.y += dirY * KNOCKBACK_DISTANCE;

    const halfSize = PLAYER_SIZE / 2;
    const minBound = arenaInset + halfSize;
    const maxBoundX = ARENA_WIDTH - arenaInset - halfSize;
    const maxBoundY = ARENA_HEIGHT - arenaInset - halfSize;
    victim.x = Math.max(minBound, Math.min(maxBoundX, victim.x));
    victim.y = Math.max(minBound, Math.min(maxBoundY, victim.y));

    const playerRect = getPlayerRect(victim);
    for (const obstacle of obstacles) {
      if (rectsCollide(playerRect, obstacle)) {
        resolveCollision(victim, obstacle, oldX, oldY);
      }
    }
  }

  victim.hasAmmo = false;
  const isDeath = victim.hearts <= 0;

  if (isDeath) {
    // Only credit kill if attacker is still connected
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

function updateProjectiles(projectiles, dt, obstacles, players, arenaInset = 0) {
  _updatedProjectiles.length = 0;
  _events.length = 0;
  const now = Date.now();

  for (const projectile of projectiles) {
    if (now - projectile.createdAt >= PROJECTILE_LIFETIME) {
      continue;
    }

    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    // Wrap around or wall collision depending on sudden death
    const halfSize = PROJECTILE_SIZE / 2;
    if (arenaInset === 0) {
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

      if (crossed && !projectile.boosted) {
        projectile.vx *= PROJECTILE_BORDER_BOOST;
        projectile.vy *= PROJECTILE_BORDER_BOOST;
        projectile.boosted = true;
      }
    } else {
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

    if (collidesWithObstacle(projectile, obstacles)) {
      _events.push({
        type: 'obstacle-hit',
        projectileId: projectile.id,
        x: projectile.x,
        y: projectile.y,
      });
      continue;
    }

    const hitPlayer = checkProjectileHit(projectile, players);
    if (hitPlayer) {
      const attacker = players instanceof Map
        ? players.get(projectile.ownerId) || null
        : (Object.hasOwn(players, projectile.ownerId) ? players[projectile.ownerId] : null);

      const hitEvent = handleHit(hitPlayer, attacker, projectile, obstacles, arenaInset);
      _events.push(hitEvent);

      continue;
    }

    _updatedProjectiles.push(projectile);
  }

  // Return copies since shared arrays get cleared on next call
  return {
    updatedProjectiles: _updatedProjectiles.slice(),
    events: _events.slice(),
  };
}

module.exports = {
  createProjectile,
  updateProjectiles,
  checkProjectileHit,
  handleHit,
  canThrow,
  rectsCollide,
  getPlayerRect,
  getProjectileRect,
  isOutOfBounds,
  collidesWithObstacle,
  PROJECTILE_LIFETIME,
};
