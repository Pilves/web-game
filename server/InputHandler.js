/**
 * InputHandler.js - Validates, rate-limits, and applies player input; handles throw creation
 */

const CONSTANTS = require('./constants');
const Combat = require('./Combat');

class InputHandler {
  constructor(roomCode) {
    this.roomCode = roomCode;

    // Debug tracking
    this._inputWarned = new Set();
    this._inputReceived = new Set();
  }

  /**
   * Process player input
   * @param {string} playerId - Player socket ID
   * @param {Object} inputData - Input data from client
   * @param {Map} gamePlayers - Map of player ID to game player
   * @param {Object} room - Room object for state checks and projectile/event access
   * @returns {boolean} true if input was processed
   */
  processInput(playerId, inputData, gamePlayers, room) {
    // Validate playerId
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return false;
    }

    // Validate inputData is an object
    if (inputData === null || typeof inputData !== 'object') {
      return false;
    }

    // Rate limiting check
    if (!room.checkInputRateLimit(playerId)) {
      return false;
    }

    if (room.state !== 'playing') {
      if (!this._inputWarned.has(playerId)) {
        console.log(`[InputHandler ${this.roomCode}] handleInput ignored - state is ${room.state}, not playing`);
        this._inputWarned.add(playerId);
      }
      return false;
    }

    const player = gamePlayers.get(playerId);
    if (!player || !player.connected || player.hearts <= 0) {
      console.log(`[InputHandler ${this.roomCode}] handleInput ignored - player issue:`, {
        exists: !!player,
        connected: player?.connected,
        hearts: player?.hearts
      });
      return false;
    }

    // Debug: log first input from each player
    if (CONSTANTS.DEBUG) {
      if (!this._inputReceived.has(playerId)) {
        console.log(`[InputHandler ${this.roomCode}] First input from player ${playerId.substring(0, 8)}:`, inputData);
        this._inputReceived.add(playerId);
      }
    }

    // Apply movement input
    this.applyMovement(player, inputData);

    // Apply facing direction
    this.applyFacing(player, inputData);

    // Handle flashlight toggle
    if (inputData.input?.flashlight) {
      const now = Date.now();
      const FLASHLIGHT_TOGGLE_COOLDOWN = 100;

      if (now - player.lastFlashlightToggle >= FLASHLIGHT_TOGGLE_COOLDOWN) {
        player.flashlightOn = !player.flashlightOn;
        player.lastFlashlightToggle = now;
        player.flashlightOnSince = player.flashlightOn ? now : 0;
        if (CONSTANTS.DEBUG) console.log(`[InputHandler ${this.roomCode}] Player ${playerId.substring(0, 8)} flashlight toggled to: ${player.flashlightOn}`);
      }
    }

    // Handle throw action
    if (inputData.input?.throw) {
      this.handleThrow(player, room);
    }

    return true;
  }

  /**
   * Apply movement input to player
   * @param {Object} player - Game player object
   * @param {Object} inputData - Input data from client
   */
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

  /**
   * Apply facing direction to player
   * @param {Object} player - Game player object
   * @param {Object} inputData - Input data from client
   */
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

  /**
   * Handle player throw action
   * @param {Object} player - Player object
   * @param {Object} room - Room for projectiles/events/muzzle flash access
   */
  handleThrow(player, room) {
    if (!player || typeof player !== 'object') {
      return;
    }

    // Limit projectiles per room to prevent DOS
    const MAX_PROJECTILES = 50;
    if (room.projectiles.length >= MAX_PROJECTILES) {
      if (CONSTANTS.DEBUG) console.log(`[InputHandler ${this.roomCode}] Projectile limit reached, ignoring throw`);
      return;
    }

    const now = Date.now();

    if (!Combat.canThrow(player, now)) {
      if (CONSTANTS.DEBUG) console.log(`[InputHandler ${this.roomCode}] Player ${player.name} cannot throw:`, {
        hasAmmo: player.hasAmmo,
        cooldown: now - (player.lastThrowTime || 0),
        stunned: player.stunnedUntil > now
      });
      return;
    }

    // Create projectile
    const projectileId = `proj_${room.nextProjectileId}`;
    room.nextProjectileId = (room.nextProjectileId % room.MAX_PROJECTILE_ID) + 1;
    const projectile = Combat.createProjectile(player, projectileId);

    // Check if projectile spawns inside an obstacle
    if (Combat.collidesWithObstacle(projectile, CONSTANTS.OBSTACLES)) {
      if (CONSTANTS.DEBUG) console.log(`[InputHandler ${this.roomCode}] Player ${player.name} projectile spawn blocked by obstacle`);
      player.hasAmmo = false;
      player.lastThrowTime = now;
      return;
    }

    if (CONSTANTS.DEBUG) console.log(`[InputHandler ${this.roomCode}] Player ${player.name} threw projectile:`, projectile);

    room.projectiles.push(projectile);

    player.hasAmmo = false;
    player.lastThrowTime = now;

    // Trigger muzzle flash
    room.muzzleFlashUntil = now + CONSTANTS.MUZZLE_FLASH_DURATION;
    room.muzzleFlashActive = true;

    // Add throw event
    room.events.push(['throw', player.id, Math.round(projectile.x), Math.round(projectile.y)]);
  }

  /**
   * Reset debug tracking state
   */
  reset() {
    this._inputWarned = new Set();
    this._inputReceived = new Set();
  }
}

module.exports = InputHandler;
