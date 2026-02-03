/**
 * GameTimer.js - Game clock, sudden death, arena shrinking, and win conditions
 */

const CONSTANTS = require('./constants');

class GameTimer {
  constructor(io, roomCode) {
    this.io = io;
    this.roomCode = roomCode;

    this.timeRemaining = CONSTANTS.DEFAULT_TIME_LIMIT;
    this.arenaInset = 0;
    this.suddenDeath = false;
    this.lastShrinkTime = 0;
  }

  /**
   * Update timer, handle sudden death and arena shrinking
   * @param {number} dt - Delta time in seconds
   * @param {Array} players - Array of game player objects
   * @param {Array} events - Events array to push events into
   */
  update(dt, players, events) {
    this.timeRemaining -= dt;

    if (this.timeRemaining <= 0 && !this.suddenDeath) {
      this.startSuddenDeath(events);
    }

    // Handle arena shrinking in sudden death
    if (this.suddenDeath) {
      const now = Date.now();
      if (now - this.lastShrinkTime >= CONSTANTS.ARENA_SHRINK_INTERVAL) {
        this.arenaInset += CONSTANTS.ARENA_SHRINK_AMOUNT;
        this.lastShrinkTime = now;

        // Push players into valid area
        for (const player of players) {
          if (!player.connected || player.hearts <= 0) continue;

          const halfSize = CONSTANTS.PLAYER_SIZE / 2;
          const minX = this.arenaInset + halfSize;
          const maxX = CONSTANTS.ARENA_WIDTH - this.arenaInset - halfSize;
          const minY = this.arenaInset + halfSize;
          const maxY = CONSTANTS.ARENA_HEIGHT - this.arenaInset - halfSize;

          if (player.x < minX) player.x = minX;
          if (player.x > maxX) player.x = maxX;
          if (player.y < minY) player.y = minY;
          if (player.y > maxY) player.y = maxY;
        }
      }
    }
  }

  /**
   * Check if game should end
   * @param {Map} gamePlayers - Map of all game players
   * @returns {Object|null} { shouldEnd: true, winner: player|null } or null if game continues
   */
  checkWinCondition(gamePlayers) {
    const alivePlayers = Array.from(gamePlayers.values())
      .filter(p => p.connected && p.hearts > 0);
    const totalPlayers = gamePlayers.size;

    // Solo mode: only end when player dies or time runs out
    if (totalPlayers === 1) {
      if (alivePlayers.length === 0) {
        return { shouldEnd: true, winner: null };
      } else if (this.timeRemaining <= 0 && this.suddenDeath && this.arenaInset >= Math.min(CONSTANTS.ARENA_WIDTH, CONSTANTS.ARENA_HEIGHT) * 0.3) {
        return { shouldEnd: true, winner: alivePlayers[0] };
      }
      return null;
    }

    // Multiplayer: Game ends when 1 or fewer players remain
    if (alivePlayers.length <= 1) {
      const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;
      return { shouldEnd: true, winner };
    }

    return null;
  }

  /**
   * Start sudden death mode
   * @param {Array} events - Events array to push events into
   */
  startSuddenDeath(events) {
    this.suddenDeath = true;
    this.lastShrinkTime = Date.now();
    this.timeRemaining = 0;

    this.io.to(this.roomCode).emit('sudden-death');
    events.push(['sudden-death']);
  }

  /**
   * Get current time remaining
   * @returns {number}
   */
  getTimeRemaining() {
    return this.timeRemaining;
  }

  /**
   * Get current arena inset
   * @returns {number}
   */
  getArenaInset() {
    return this.arenaInset;
  }

  /**
   * Reset timer state for a new game
   * @param {Object} settings - Game settings { timeLimit }
   */
  reset(settings) {
    this.timeRemaining = settings.timeLimit;
    this.arenaInset = 0;
    this.suddenDeath = false;
    this.lastShrinkTime = 0;
  }
}

module.exports = GameTimer;
