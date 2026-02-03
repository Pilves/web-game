/**
 * StateBroadcaster.js - Serializes game state into compact network packets and emits them
 */

class StateBroadcaster {
  constructor(io, roomCode) {
    this.io = io;
    this.roomCode = roomCode;
    this.stateSequence = 0;
  }

  broadcast(roomState) {
    const packet = this.buildPacket(roomState);
    this.io.to(this.roomCode).emit('state', packet);
  }

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

  serializeProjectiles(projectiles) {
    return projectiles.map(p => [
      p.id,
      Math.round(p.x),
      Math.round(p.y),
      Math.round(p.vx),
      Math.round(p.vy),
    ]);
  }

  serializePickups(pickupManager) {
    return pickupManager.getAll().map(p => [
      p.id,
      Math.round(p.x),
      Math.round(p.y),
      p.active,
    ]);
  }

  reset() {
    this.stateSequence = 0;
  }
}

module.exports = StateBroadcaster;
