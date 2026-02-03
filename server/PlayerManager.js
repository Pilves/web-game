/**
 * PlayerManager.js - Player lifecycle management for GameRoom
 *
 * Manages:
 * - Player initialization from lobby state
 * - Game player state (Map and cached Object)
 * - Player disconnect/removal
 * - Active player queries
 */

const CONSTANTS = require('./constants');

class PlayerManager {
  constructor(code) {
    this.code = code;
    this.gamePlayers = new Map();
    this.gamePlayersObject = {};
  }

  /**
   * Sync the gamePlayersObject cache with the gamePlayers Map
   * Call this after any modification to gamePlayers
   */
  syncGamePlayersObject() {
    this.gamePlayersObject = {};
    for (const [id, player] of this.gamePlayers) {
      this.gamePlayersObject[id] = player;
    }
  }

  /**
   * Initialize game players from lobby players
   * @param {Map} lobbyPlayers - Map of lobby player objects
   * @param {Object} settings - Game settings (must include lives)
   */
  initializePlayers(lobbyPlayers, settings) {
    this.gamePlayers.clear();
    const playerList = Array.from(lobbyPlayers.values());

    playerList.forEach((player, index) => {
      // Safe array access with fallback to center of arena
      const spawnPoints = Array.isArray(CONSTANTS.SPAWN_POINTS) ? CONSTANTS.SPAWN_POINTS : [];
      const defaultSpawn = { x: CONSTANTS.ARENA_WIDTH / 2, y: CONSTANTS.ARENA_HEIGHT / 2 };
      const spawn = (index >= 0 && index < spawnPoints.length)
        ? spawnPoints[index]
        : (spawnPoints[0] || defaultSpawn);

      const gamePlayer = {
        id: player.id,
        name: player.name,
        color: player.color,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        facing: 0, // radians, 0 = right
        flashlightOn: false,
        flashlightOnSince: 0, // Track when flashlight was turned on (for flicker)
        hearts: settings.lives,
        hasAmmo: true,  // Players start with 1 pillow
        stunnedUntil: 0,
        invincibleUntil: 0,
        lastThrowTime: 0,
        lastFootstepTime: 0,
        lastFlashlightToggle: 0, // debounce flashlight toggle
        input: {
          up: false,
          down: false,
          left: false,
          right: false,
          sprint: false,
        },
        connected: true,
        kills: 0,
        deaths: 0,
      };

      this.gamePlayers.set(player.id, gamePlayer);
    });

    this.syncGamePlayersObject();
  }

  /**
   * Handle player disconnect during game
   * @param {string} playerId - Disconnected player ID
   */
  handleDisconnect(playerId) {
    const player = this.gamePlayers.get(playerId);
    if (player) {
      player.connected = false;
    }
  }

  /**
   * Remove player from game (mark as disconnected)
   * @param {string} playerId - Player ID to remove
   */
  removePlayer(playerId) {
    const player = this.gamePlayers.get(playerId);
    if (player) {
      player.connected = false;
    }
  }

  /**
   * Get list of active (connected and alive) players
   * @returns {Array} Array of active players
   */
  getActivePlayers() {
    return Array.from(this.gamePlayers.values())
      .filter(p => p.connected && p.hearts > 0);
  }

  /**
   * Reset player state
   */
  reset() {
    this.gamePlayers.clear();
    this.gamePlayersObject = {};
  }
}

module.exports = PlayerManager;
