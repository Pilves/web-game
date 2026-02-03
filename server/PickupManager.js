const CONSTANTS = require('./constants');
const Physics = require('./Physics');

class PickupManager {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.pickups = [];
    this.nextPickupId = 1;
  }

  getRandomSpawnPosition(arenaInset = 0, padding = 30) {
    const pickupSize = CONSTANTS.PICKUP_SIZE;
    const margin = 50;
    const edgeOffset = Math.max(margin, arenaInset + 20);

    const minX = edgeOffset + pickupSize / 2;
    const maxX = CONSTANTS.ARENA_WIDTH - edgeOffset - pickupSize / 2;
    const minY = edgeOffset + pickupSize / 2;
    const maxY = CONSTANTS.ARENA_HEIGHT - edgeOffset - pickupSize / 2;

    if (minX >= maxX || minY >= maxY) {
      return { x: CONSTANTS.ARENA_WIDTH / 2, y: CONSTANTS.ARENA_HEIGHT / 2 };
    }

    for (let attempt = 0; attempt < 100; attempt++) {
      const x = minX + Math.random() * (maxX - minX);
      const y = minY + Math.random() * (maxY - minY);

      const pickupRect = {
        x: x - pickupSize / 2 - padding,
        y: y - pickupSize / 2 - padding,
        width: pickupSize + padding * 2,
        height: pickupSize + padding * 2,
      };

      let overlaps = false;
      for (const obstacle of CONSTANTS.OBSTACLES) {
        if (Physics.rectsCollide(pickupRect, obstacle)) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        return { x, y };
      }
    }

    return { x: CONSTANTS.ARENA_WIDTH / 2, y: CONSTANTS.ARENA_HEIGHT / 2 };
  }

  initialize(arenaInset = 0) {
    this.pickups = [];
    for (let i = 0; i < CONSTANTS.PILLOWS_ON_MAP; i++) {
      const spawn = this.getRandomSpawnPosition(arenaInset);
      this.pickups.push({
        id: this.nextPickupId++,
        x: spawn.x,
        y: spawn.y,
        active: true,
        respawnAt: 0,
      });
    }
  }

  checkCollisions(players, events) {
    for (const player of players) {
      if (!player.connected || player.hearts <= 0 || player.hasAmmo) continue;

      const playerRect = Physics.getPlayerRect(player);

      for (const pickup of this.pickups) {
        if (!pickup.active) continue;

        const pickupRect = {
          x: pickup.x - CONSTANTS.PICKUP_SIZE / 2,
          y: pickup.y - CONSTANTS.PICKUP_SIZE / 2,
          width: CONSTANTS.PICKUP_SIZE,
          height: CONSTANTS.PICKUP_SIZE,
        };

        if (Physics.rectsCollide(playerRect, pickupRect)) {
          events.push(['pickup', player.id, pickup.id, Math.round(pickup.x), Math.round(pickup.y)]);

          player.hasAmmo = true;
          pickup.active = false;
          pickup.respawnAt = Date.now() + CONSTANTS.PILLOW_RESPAWN_TIME;
        }
      }
    }
  }

  respawn(now, arenaInset = 0) {
    for (const pickup of this.pickups) {
      if (!pickup.active && pickup.respawnAt > 0 && now >= pickup.respawnAt) {
        const newPos = this.getRandomSpawnPosition(arenaInset);
        pickup.x = newPos.x;
        pickup.y = newPos.y;
        pickup.active = true;
        pickup.respawnAt = 0;
      }
    }
  }

  getAll() {
    return this.pickups;
  }

  reset() {
    this.pickups = [];
  }
}

module.exports = PickupManager;
