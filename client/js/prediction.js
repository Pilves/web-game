// Client-side player movement prediction, obstacle collision, and server reconciliation
import { CONFIG } from './config.js';

export function predictLocalPlayer(localPlayer, input, dt, arenaInset) {
  if (!localPlayer) return;

  if (localPlayer.vx === undefined) localPlayer.vx = 0;
  if (localPlayer.vy === undefined) localPlayer.vy = 0;

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

  const speed = input.sprint ? CONFIG.PLAYER_SPRINT_SPEED : CONFIG.PLAYER_SPEED;

  let vx = 0;
  let vy = 0;

  if (input.up) vy -= 1;
  if (input.down) vy += 1;
  if (input.left) vx -= 1;
  if (input.right) vx += 1;

  const length = Math.hypot(vx, vy);
  if (length > 0) {
    vx = (vx / length) * speed;
    vy = (vy / length) * speed;
  }

  localPlayer.vx = vx;
  localPlayer.vy = vy;

  localPlayer.x += vx * dt;
  localPlayer.y += vy * dt;

  localPlayer.facing = input.facing;

  applyBoundaryAndCollision(localPlayer, arenaInset);
}

export function applyBoundaryAndCollision(localPlayer, arenaInset) {
  const halfSize = CONFIG.PLAYER_SIZE / 2;
  const arenaWidth = CONFIG.ARENA_WIDTH;
  const arenaHeight = CONFIG.ARENA_HEIGHT;

  if (arenaInset > 0) {
    const minX = arenaInset + halfSize;
    const maxX = arenaWidth - arenaInset - halfSize;
    const minY = arenaInset + halfSize;
    const maxY = arenaHeight - arenaInset - halfSize;

    if (localPlayer.x < minX) { localPlayer.x = minX; localPlayer.vx = 0; }
    if (localPlayer.x > maxX) { localPlayer.x = maxX; localPlayer.vx = 0; }
    if (localPlayer.y < minY) { localPlayer.y = minY; localPlayer.vy = 0; }
    if (localPlayer.y > maxY) { localPlayer.y = maxY; localPlayer.vy = 0; }
  } else {
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

  for (const obstacle of CONFIG.OBSTACLES) {
    resolveCollision(localPlayer, obstacle);
  }
}

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

export function reconcileWithServer(localPlayer, serverPlayer) {
  if (!serverPlayer) return false;

  if (!localPlayer) return false;

  localPlayer.stunned = serverPlayer.stunned;

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
