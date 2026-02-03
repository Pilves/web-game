/**
 * StateBroadcaster.js - Serializes game state into compact network packets and emits them
 */

const CONSTANTS = require('./constants');

class StateBroadcaster {
  constructor(io, roomCode) {
    this.io = io;
    this.roomCode = roomCode;

    // State sequence number for network synchronization
    this.stateSequence = 0;

    // Debug counter
    this._broadcastCount = 0;
  }

  /**
   * Build and emit state packet to all players in the room
   * @param {Object} roomState - Room state data
   * @param {Map} roomState.gamePlayers - Map of player ID to game player
   * @param {Array} roomState.projectiles - Active projectiles
   * @param {Object} roomState.pickupManager - PickupManager instance
   * @param {Array} roomState.events - Events to broadcast
   * @param {string} roomState.state - Current game state
   * @param {boolean} roomState.muzzleFlashActive - Muzzle flash state
   * @param {number} roomState.timeRemaining - Time remaining
   * @param {number} roomState.arenaInset - Arena inset for sudden death
   * @returns {Array} The events that were broadcast (caller should clear)
   */
  broadcast(roomState) {
    const packet = this.buildPacket(roomState);

    if (CONSTANTS.DEBUG) {
      this._broadcastCount++;
      if (this._broadcastCount === 1 || this._broadcastCount % 20 === 0) {
        console.log(`[StateBroadcaster ${this.roomCode}] Broadcast #${this._broadcastCount}:`, {
          state: packet.s,
          playerCount: packet.p?.length,
          playerPositions: packet.p?.map(p => ({ id: p[0].substring(0, 8), x: p[1], y: p[2] }))
        });
      }
    }

    this.io.to(this.roomCode).emit('state', packet);
  }

  /**
   * Build state packet for broadcast
   * @param {Object} roomState - Room state data
   * @returns {Object} Compact state packet
   */
  buildPacket(roomState) {
    const now = Date.now();
    const eventsCopy = roomState.events.slice();

    // Increment sequence with overflow protection
    const seq = this.stateSequence++;
    if (this.stateSequence >= Number.MAX_SAFE_INTEGER - 1) {
      this.stateSequence = 0;
    }

    return {
      seq: seq,
      t: now,
      s: roomState.state,
      mf: roomState.muzzleFlashActive,
      time: Math.max(0, Math.floor(roomState.timeRemaining)),
      inset: roomState.arenaInset,
      p: this.serializePlayers(roomState.gamePlayers, now),
      j: this.serializeProjectiles(roomState.projectiles),
      k: this.serializePickups(roomState.pickupManager),
      e: eventsCopy,
    };
  }

  /**
   * Serialize players into compact arrays
   * @param {Map} gamePlayers - Map of player objects
   * @param {number} now - Current timestamp
   * @returns {Array} Array of player arrays
   */
  serializePlayers(gamePlayers, now) {
    const result = [];
    for (const player of gamePlayers.values()) {
      result.push([
        player.id,
        Math.round(player.x),
        Math.round(player.y),
        player.facing,
        player.flashlightOn,
        player.hearts,
        player.hasAmmo,
        player.stunnedUntil > now,
        player.invincibleUntil > now,
        player.flashlightOnSince || 0,
      ]);
    }
    return result;
  }

  /**
   * Serialize projectiles into compact arrays
   * @param {Array} projectiles - Array of projectile objects
   * @returns {Array} Array of projectile arrays
   */
  serializeProjectiles(projectiles) {
    return projectiles.map(p => [
      p.id,
      Math.round(p.x),
      Math.round(p.y),
      Math.round(p.vx),
      Math.round(p.vy),
    ]);
  }

  /**
   * Serialize pickups into compact arrays
   * @param {Object} pickupManager - PickupManager instance
   * @returns {Array} Array of pickup arrays
   */
  serializePickups(pickupManager) {
    return pickupManager.getAll().map(p => [
      p.id,
      Math.round(p.x),
      Math.round(p.y),
      p.active,
    ]);
  }

  /**
   * Reset state (for new game or return to lobby)
   */
  reset() {
    this.stateSequence = 0;
    this._broadcastCount = 0;
  }
}

module.exports = StateBroadcaster;
