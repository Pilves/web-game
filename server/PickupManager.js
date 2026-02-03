/**
 * PickupManager.js - Spawns, tracks, and respawns health/ammo pickups
 */

const CONSTANTS = require('./constants');
const Physics = require('./Physics');

class PickupManager {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.pickups = [];
    this.nextPickupId = 1;
    this._pickupCollisionLogCount = 0;
  }

  /**
   * Generate a random spawn position that doesn't overlap with obstacles
   * @param {number} arenaInset - Current arena inset for sudden death
   * @param {number} padding - Extra padding around obstacles (default 30)
   * @returns {Object} {x, y} coordinates
   */
  getRandomSpawnPosition(arenaInset = 0, padding = 30) {
    const pickupSize = CONSTANTS.PICKUP_SIZE;
    const margin = 50;
    const edgeOffset = Math.max(margin, arenaInset + 20);

    const minX = edgeOffset + pickupSize / 2;
    const maxX = CONSTANTS.ARENA_WIDTH - edgeOffset - pickupSize / 2;
    const minY = edgeOffset + pickupSize / 2;
    const maxY = CONSTANTS.ARENA_HEIGHT - edgeOffset - pickupSize / 2;

    // If arena has shrunk too much, just return center
    if (minX >= maxX || minY >= maxY) {
      return { x: CONSTANTS.ARENA_WIDTH / 2, y: CONSTANTS.ARENA_HEIGHT / 2 };
    }

    // Try to find a valid position (max 100 attempts)
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

    // Fallback: return center of arena
    return { x: CONSTANTS.ARENA_WIDTH / 2, y: CONSTANTS.ARENA_HEIGHT / 2 };
  }

  /**
   * Initialize pickups at random positions
   * @param {number} arenaInset - Current arena inset
   */
  initialize(arenaInset = 0) {
    this.pickups = [];
    this._pickupCollisionLogCount = 0;
    for (let i = 0; i < CONSTANTS.PILLOWS_ON_MAP; i++) {
      const spawn = this.getRandomSpawnPosition(arenaInset);
      console.log(`[PickupManager ${this.roomCode}] Pickup ${i + 1} spawning at:`, spawn);
      this.pickups.push({
        id: this.nextPickupId++,
        x: spawn.x,
        y: spawn.y,
        active: true,
        respawnAt: 0,
      });
    }
    console.log(`[PickupManager ${this.roomCode}] Pickups spawned:`, this.pickups.map(p => `(${Math.round(p.x)}, ${Math.round(p.y)})`).join(', '));
  }

  /**
   * Check if players pick up pillows
   * @param {Array} players - Array of player objects
   * @param {Array} events - Events array to push pickup events into
   */
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

        // Debug proximity logging
        if (CONSTANTS.DEBUG && this._pickupCollisionLogCount < 10) {
          const dist = Math.hypot(player.x - pickup.x, player.y - pickup.y);
          if (dist < 100) {
            console.log(`[PickupManager ${this.roomCode}] Collision check: player ${player.name} at (${Math.round(player.x)}, ${Math.round(player.y)}), pickup ${pickup.id} at (${Math.round(pickup.x)}, ${Math.round(pickup.y)}), dist=${Math.round(dist)}, hasAmmo=${player.hasAmmo}`);
            this._pickupCollisionLogCount++;
          }
        }

        if (Physics.rectsCollide(playerRect, pickupRect)) {
          if (CONSTANTS.DEBUG) console.log(`[PickupManager ${this.roomCode}] Player ${player.name} picked up pillow ${pickup.id} at (${pickup.x}, ${pickup.y})`);

          events.push(['pickup', player.id, pickup.id, Math.round(pickup.x), Math.round(pickup.y)]);

          player.hasAmmo = true;
          pickup.active = false;
          pickup.respawnAt = Date.now() + CONSTANTS.PILLOW_RESPAWN_TIME;
        }
      }
    }
  }

  /**
   * Respawn inactive pickups whose timer has expired
   * @param {number} now - Current timestamp
   * @param {number} arenaInset - Current arena inset
   */
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

  /**
   * Get all pickups
   * @returns {Array} Array of pickup objects
   */
  getAll() {
    return this.pickups;
  }

  /**
   * Reset all pickup state
   */
  reset() {
    this.pickups = [];
    this._pickupCollisionLogCount = 0;
  }
}

module.exports = PickupManager;
