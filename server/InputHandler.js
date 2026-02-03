const CONSTANTS = require('./constants');
const Combat = require('./Combat');

class InputHandler {
  constructor(roomCode) {
    this.roomCode = roomCode;
  }

  processInput(playerId, inputData, gamePlayers, room) {
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return false;
    }

    if (inputData === null || typeof inputData !== 'object') {
      return false;
    }

    if (!room.checkInputRateLimit(playerId)) {
      return false;
    }

    if (room.state !== 'playing') {
      return false;
    }

    const player = gamePlayers.get(playerId);
    if (!player || !player.connected || player.hearts <= 0) {
      return false;
    }

    this.applyMovement(player, inputData);
    this.applyFacing(player, inputData);

    if (inputData.input?.flashlight) {
      const now = Date.now();
      const FLASHLIGHT_TOGGLE_COOLDOWN = 100;

      if (now - player.lastFlashlightToggle >= FLASHLIGHT_TOGGLE_COOLDOWN) {
        player.flashlightOn = !player.flashlightOn;
        player.lastFlashlightToggle = now;
        player.flashlightOnSince = player.flashlightOn ? now : 0;
      }
    }

    if (inputData.input?.throw) {
      this.handleThrow(player, room);
    }

    return true;
  }

  applyMovement(player, inputData) {
    if (inputData.input !== undefined && inputData.input !== null && typeof inputData.input === 'object') {
      const input = inputData.input;
      player.input.up = input.up === true;
      player.input.down = input.down === true;
      player.input.left = input.left === true;
      player.input.right = input.right === true;
      player.input.sprint = input.sprint === true;
    }
  }

  applyFacing(player, inputData) {
    if (inputData.facing !== undefined) {
      const facing = parseFloat(inputData.facing);
      if (Number.isFinite(facing)) {
        let normalizedFacing = facing % (2 * Math.PI);
        if (normalizedFacing > Math.PI) {
          normalizedFacing -= 2 * Math.PI;
        } else if (normalizedFacing < -Math.PI) {
          normalizedFacing += 2 * Math.PI;
        }
        player.facing = normalizedFacing;
      }
    }
  }

  handleThrow(player, room) {
    if (!player || typeof player !== 'object') {
      return;
    }

    const MAX_PROJECTILES = 50;
    if (room.projectiles.length >= MAX_PROJECTILES) {
      return;
    }

    const now = Date.now();

    if (!Combat.canThrow(player, now)) {
      return;
    }

    const projectileId = `proj_${room.nextProjectileId}`;
    room.nextProjectileId = (room.nextProjectileId % room.MAX_PROJECTILE_ID) + 1;
    const projectile = Combat.createProjectile(player, projectileId);

    if (Combat.collidesWithObstacle(projectile, CONSTANTS.OBSTACLES)) {
      player.hasAmmo = false;
      player.lastThrowTime = now;
      return;
    }

    room.projectiles.push(projectile);

    player.hasAmmo = false;
    player.lastThrowTime = now;

    room.muzzleFlashUntil = now + CONSTANTS.MUZZLE_FLASH_DURATION;
    room.muzzleFlashActive = true;

    room.events.push(['throw', player.id, Math.round(projectile.x), Math.round(projectile.y)]);
  }

  reset() {
  }
}

module.exports = InputHandler;
