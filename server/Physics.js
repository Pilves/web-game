/**
 * Physics.js - Movement, collision detection, and visibility for LIGHTS OUT
 */

const CONSTANTS = require('./constants.js');
const GEOMETRY = require('../shared/geometry.js');

const { rectsCollide } = GEOMETRY;
const { getPlayerRect } = require('./Hitbox.js');

function applyInput(player, input, dt) {
  const now = Date.now();
  if (player.stunnedUntil && now < player.stunnedUntil) {
    const frictionFactor = Math.pow(CONSTANTS.PLAYER_FRICTION, dt * 60);
    player.vx *= frictionFactor;
    player.vy *= frictionFactor;
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

function movePlayer(player, dt, obstacles, arenaInset = 0) {
  const halfSize = CONSTANTS.PLAYER_SIZE / 2;

  const minX = arenaInset + halfSize;
  const maxX = CONSTANTS.ARENA_WIDTH - arenaInset - halfSize;
  const minY = arenaInset + halfSize;
  const maxY = CONSTANTS.ARENA_HEIGHT - arenaInset - halfSize;

  const newX = player.x + player.vx * dt;
  const newY = player.y + player.vy * dt;
  const oldX = player.x;
  const oldY = player.y;

  player.x = newX;
  player.y = newY;

  if (arenaInset <= 0) {
    const arenaWidth = CONSTANTS.ARENA_WIDTH;
    const arenaHeight = CONSTANTS.ARENA_HEIGHT;

    if (player.x <= -halfSize) {
      player.x += arenaWidth;
    } else if (player.x >= arenaWidth + halfSize) {
      player.x -= arenaWidth;
    }
    if (player.y <= -halfSize) {
      player.y += arenaHeight;
    } else if (player.y >= arenaHeight + halfSize) {
      player.y -= arenaHeight;
    }
  } else {
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

  for (const obstacle of obstacles) {
    const playerRect = getPlayerRect(player);
    if (rectsCollide(playerRect, obstacle)) {
      resolveCollision(player, obstacle, oldX, oldY);
    }
  }
}

function resolveCollision(player, obstacle, oldX, oldY) {
  const halfSize = CONSTANTS.PLAYER_SIZE / 2;
  const playerRect = getPlayerRect(player);

  const overlapLeft = (playerRect.x + playerRect.width) - obstacle.x;
  const overlapRight = (obstacle.x + obstacle.width) - playerRect.x;
  const overlapTop = (playerRect.y + playerRect.height) - obstacle.y;
  const overlapBottom = (obstacle.y + obstacle.height) - playerRect.y;

  const minOverlapX = Math.min(overlapLeft, overlapRight);
  const minOverlapY = Math.min(overlapTop, overlapBottom);

  if (minOverlapX < minOverlapY) {
    if (overlapLeft < overlapRight) {
      player.x = obstacle.x - halfSize;
    } else {
      player.x = obstacle.x + obstacle.width + halfSize;
    }
    player.vx = 0;
  } else {
    if (overlapTop < overlapBottom) {
      player.y = obstacle.y - halfSize;
    } else {
      player.y = obstacle.y + obstacle.height + halfSize;
    }
    player.vy = 0;
  }
}

module.exports = {
  rectsCollide,
  getPlayerRect,
  applyInput,
  movePlayer,
  resolveCollision,
};
