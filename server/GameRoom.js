/**
 * GameRoom.js - Server-side game room instance for LIGHTS OUT
 *
 * Manages active games including:
 * - Game state machine (lobby, countdown, playing, paused, gameover)
 * - Physics and broadcast loops
 * - Player input handling
 * - Projectile and pickup management
 * - Win conditions and sudden death
 */

const CONSTANTS = require('./constants');
const { debugLog } = require('./constants');
const Names = require('../shared/names.js');
const Physics = require('./Physics');
const Combat = require('./Combat');
const RateLimiter = require('./RateLimiter');
const PickupManager = require('./PickupManager');
const StateBroadcaster = require('./StateBroadcaster');
const InputHandler = require('./InputHandler');
const GameTimer = require('./GameTimer');
const PlayerManager = require('./PlayerManager');

// Footstep sound interval when sprinting (ms)
const FOOTSTEP_INTERVAL = 300;

class GameRoom {
  /**
   * Initialize room state
   * @param {Object} io - Socket.io server instance
   * @param {string} code - Room code
   * @param {string} host - Host socket ID
   * @param {Object} settings - Game settings (optional)
   */
  constructor(io, code, host, settings = {}) {
    this.io = io;
    this.code = code;
    this.host = host;

    // State machine
    this.state = 'lobby'; // 'lobby', 'countdown', 'playing', 'paused', 'gameover'

    // Game settings (with validation and type coercion)
    const parsedLives = parseInt(settings.lives, 10);
    const parsedTimeLimit = parseInt(settings.timeLimit, 10);
    this.settings = {
      lives: (Number.isFinite(parsedLives) && parsedLives > 0 && parsedLives <= 10)
        ? parsedLives
        : CONSTANTS.DEFAULT_LIVES,
      timeLimit: (Number.isFinite(parsedTimeLimit) && parsedTimeLimit > 0 && parsedTimeLimit <= 600)
        ? parsedTimeLimit
        : CONSTANTS.DEFAULT_TIME_LIMIT,
    };

    // Lobby players (Map: socketId -> player object)
    this.players = new Map();

    // Player manager (handles player lifecycle)
    this.playerManager = new PlayerManager(code);

    // Game state (only populated when game is active)
    this.projectiles = [];
    this.pickupManager = new PickupManager(code);
    this.events = [];

    // Game timer (clock, sudden death, arena shrinking)
    this.gameTimer = new GameTimer(io, code);
    this.gameTimer.reset(this.settings);

    // Muzzle flash state
    this.muzzleFlashActive = false;
    this.muzzleFlashUntil = 0;

    // Intervals
    this.physicsInterval = null;
    this.broadcastInterval = null;
    this.countdownInterval = null;

    // Projectile ID counter (with overflow protection)
    this.nextProjectileId = 1;
    this.MAX_PROJECTILE_ID = Number.MAX_SAFE_INTEGER;

    // State broadcaster for network serialization
    this.broadcaster = new StateBroadcaster(io, code);

    // Input handler for player input processing
    this.inputHandler = new InputHandler(code);

    // Pause state
    this.pausedBy = null;

    // Return to lobby requests
    this.returnToLobbyRequests = new Set();

    // Rate limiting for input flooding
    this.inputRateLimiter = new RateLimiter();
  }

  // --- Property delegation to GameTimer ---
  get timeRemaining() { return this.gameTimer.timeRemaining; }
  set timeRemaining(v) { this.gameTimer.timeRemaining = v; }
  get arenaInset() { return this.gameTimer.arenaInset; }
  set arenaInset(v) { this.gameTimer.arenaInset = v; }
  get suddenDeath() { return this.gameTimer.suddenDeath; }
  set suddenDeath(v) { this.gameTimer.suddenDeath = v; }

  // --- Property delegation to PlayerManager ---
  get gamePlayers() { return this.playerManager.gamePlayers; }
  get gamePlayersObject() { return this.playerManager.gamePlayersObject; }
  set gamePlayersObject(v) { this.playerManager.gamePlayersObject = v; }

  /**
   * Sync the gamePlayersObject cache with the gamePlayers Map
   * Call this after any modification to gamePlayers
   */
  syncGamePlayersObject() {
    this.playerManager.syncGamePlayersObject();
  }

  /**
   * Check if input rate is within limits (prevents flooding)
   * @param {string} playerId - Player socket ID
   * @returns {boolean} true if input should be processed, false if rate limited
   */
  checkInputRateLimit(playerId) {
    const allowed = this.inputRateLimiter.checkWindowLimit(playerId, 1000, CONSTANTS.INPUT_RATE_LIMIT);
    if (!allowed) {
      const now = Date.now();
      if (now - this.inputRateLimiter.getLastWarning(playerId) > 1000) {
        console.log(`[GameRoom ${this.code}] Rate limiting player ${playerId.substring(0, 8)}: ${this.inputRateLimiter.getWindowCount(playerId)} packets/sec`);
        this.inputRateLimiter.setLastWarning(playerId, now);
      }
    }
    return allowed;
  }

  /**
   * Validate state transition
   * @param {string} fromState - Current state
   * @param {string} toState - Target state
   * @returns {boolean} true if transition is valid
   */
  isValidStateTransition(fromState, toState) {
    const validTransitions = {
      'lobby': ['countdown'],
      'countdown': ['lobby', 'playing'],
      'playing': ['paused', 'gameover'],
      'paused': ['playing', 'gameover'],
      'gameover': ['lobby'],
    };
    const allowed = validTransitions[fromState];
    return allowed && allowed.includes(toState);
  }

  /**
   * Add player from lobby to game state
   * @param {Object} socket - Player socket
   * @param {string} name - Player name
   * @param {string} color - Player color
   */
  addPlayer(socket, name, color) {
    // Validate socket
    if (!socket || typeof socket.id !== 'string' || socket.id.length === 0) {
      console.log(`[GameRoom ${this.code}] addPlayer: invalid socket`);
      return;
    }

    // Sanitize and validate name
    const sanitizedName = (typeof name === 'string' && name.trim().length > 0)
      ? name.trim().slice(0, 20)
      : Names.generateName();

    // Validate color (hex color format)
    const colorRegex = /^#[0-9A-Fa-f]{6}$/;
    const sanitizedColor = (typeof color === 'string' && colorRegex.test(color))
      ? color
      : '#ffffff';

    const player = {
      id: socket.id,
      name: sanitizedName || Names.generateName(),
      color: sanitizedColor,
      ready: false,
      roomCode: this.code,
    };

    this.players.set(socket.id, player);
  }

  /**
   * Initialize game state for all players
   */
  initializeGame() {
    // Initialize game players with spawn positions (delegated to PlayerManager)
    this.playerManager.initializePlayers(this.players, this.settings);

    // Initialize pickups at random positions (avoiding obstacles)
    this.pickupManager.initialize(this.arenaInset);

    // Reset game state
    this.projectiles = [];
    this.events = [];
    this.gameTimer.reset(this.settings);
    this.muzzleFlashActive = false;
    this.muzzleFlashUntil = 0;
  }

  /**
   * Start the countdown sequence
   */
  startCountdown() {
    // Validate state transition
    if (!this.isValidStateTransition(this.state, 'countdown')) {
      console.log(`[GameRoom ${this.code}] Cannot start countdown from state: ${this.state}`);
      return;
    }
    this.state = 'countdown';
    this.initializeGame();

    let count = 3;

    // Emit initial countdown
    this.io.to(this.code).emit('countdown', { count });

    this.countdownInterval = setInterval(() => {
      count--;

      // Verify player count is still valid during countdown
      if (this.players.size < CONSTANTS.MIN_PLAYERS) {
        this.cancelCountdown('Not enough players');
        return;
      }

      if (count > 0) {
        this.io.to(this.code).emit('countdown', { count });
      } else if (count === 0) {
        this.io.to(this.code).emit('countdown', { count: 0 });
      } else {
        // count < 0, start the game
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
        this.startGame();
      }
    }, 1000);
  }

  /**
   * Cancel countdown and reset to lobby state (used for state sync)
   * @param {string} reason - Reason for cancellation
   */
  cancelCountdown(reason) {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.state = 'lobby';
    // Clear any partially initialized game state
    this.gamePlayers.clear();
    this.gamePlayersObject = {};
    this.projectiles = [];
    this.pickupManager.reset();
    this.events = [];
    // Reset debug sets to avoid stale state on next game start
    this.inputHandler.reset();
    this.io.to(this.code).emit('countdown-cancelled', { reason });
  }

  /**
   * Start the game (called after countdown)
   */
  startGame() {
    // Validate state transition
    if (!this.isValidStateTransition(this.state, 'playing')) {
      console.log(`[GameRoom ${this.code}] Cannot start game from state: ${this.state}`);
      return;
    }

    // Verify player count is still valid
    if (this.players.size < CONSTANTS.MIN_PLAYERS) {
      this.state = 'lobby';
      this.io.to(this.code).emit('countdown-cancelled', { reason: 'Not enough players' });
      return;
    }

    this.state = 'playing';

    const gameStartData = {
      players: this.buildPlayersArray(Date.now()),
      pickups: this.buildPickupsArray(),
      obstacles: CONSTANTS.OBSTACLES,
      settings: this.settings,
    };

    debugLog(`[GameRoom ${this.code}]`, `Starting game with ${gameStartData.players.length} players`);
    debugLog(`[GameRoom ${this.code}]`, 'Player positions:', gameStartData.players.map(p => ({ id: p[0].substring(0, 8), x: p[1], y: p[2] })));
    debugLog(`[GameRoom ${this.code}]`, 'Pickups in game-start:', gameStartData.pickups);

    // Emit game start
    this.io.to(this.code).emit('game-start', gameStartData);

    this.startGameLoop();
  }

  /**
   * Start physics and broadcast intervals
   */
  startGameLoop() {
    // Clear any existing intervals first
    this.cleanup();

    // Flag to prevent tick during endGame cleanup
    this.gameLoopActive = true;

    const PHYSICS_DT = 1000 / CONSTANTS.PHYSICS_TICK_RATE;
    const BROADCAST_DT = 1000 / CONSTANTS.BROADCAST_RATE;

    // Physics loop - 60Hz
    this.physicsInterval = setInterval(() => {
      if (this.state !== 'playing' || !this.gameLoopActive) return;
      this.physicsTick(PHYSICS_DT / 1000); // pass delta in seconds
    }, PHYSICS_DT);

    // Broadcast loop - 20Hz
    this.broadcastInterval = setInterval(() => {
      if (!this.gameLoopActive) return;
      if (this.state !== 'playing' && this.state !== 'paused') return;
      this.broadcastState();
    }, BROADCAST_DT);
  }

  /**
   * Main physics update tick
   * @param {number} dt - Delta time in seconds
   */
  physicsTick(dt) {
    const now = Date.now();

    // Cache players array to avoid multiple iterations over Map
    const players = Array.from(this.gamePlayers.values());

    // 1. Apply inputs to player velocities
    for (const player of players) {
      if (!player.connected || player.hearts <= 0) continue;
      Physics.applyInput(player, player.input, dt);
    }

    // 2. Move players
    for (const player of players) {
      if (!player.connected || player.hearts <= 0) continue;
      Physics.movePlayer(player, dt, CONSTANTS.OBSTACLES, this.arenaInset);
    }

    // 3. Update projectiles
    const projectileResult = Combat.updateProjectiles(
      this.projectiles,
      dt,
      CONSTANTS.OBSTACLES,
      this.gamePlayers,  // Pass Map directly for more efficient iteration
      this.arenaInset
    );

    // updateProjectiles already returns a new array via .slice(), no need to slice again
    this.projectiles = projectileResult.updatedProjectiles;

    // Add projectile events to events array
    for (const event of projectileResult.events) {
      // Handle different event types with proper data
      if (event.type === 'hit' || event.type === 'death') {
        this.events.push([event.type, event.victimId || null, event.attackerId || null]);
      } else if (event.type === 'wall-hit' || event.type === 'obstacle-hit') {
        this.events.push([event.type, event.projectileId || null, Math.round(event.x || 0), Math.round(event.y || 0)]);
      } else {
        // Fallback for other event types
        this.events.push([event.type, event.victimId || null, event.attackerId || null]);
      }
    }

    // 4. Check pickup collisions
    this.pickupManager.checkCollisions(players, this.events);

    // 5. Check footstep sounds
    this.checkFootstepSounds(now, players);

    // 6. Update timers
    this.updateTimers(dt, players);

    // 7. Update muzzle flash
    if (this.muzzleFlashActive && now >= this.muzzleFlashUntil) {
      this.muzzleFlashActive = false;
    }

    // 8. Respawn pickups
    this.pickupManager.respawn(now, this.arenaInset);

    // 9. Check win condition
    this.checkWinCondition();
  }


  /**
   * Check and emit footstep sounds for sprinting players
   * @param {number} now - Current timestamp
   * @param {Array} players - Cached array of player objects
   */
  checkFootstepSounds(now, players) {
    for (const player of players) {
      if (!player.connected || player.hearts <= 0) continue;

      // Check if player is sprinting and moving
      const isMoving = player.input.up || player.input.down || player.input.left || player.input.right;
      const isSprinting = player.input.sprint && isMoving;

      if (isSprinting) {
        // Check if enough time has passed since last footstep
        if (now - player.lastFootstepTime >= FOOTSTEP_INTERVAL) {
          player.lastFootstepTime = now;

          // Add footstep sound event (format: ['sound', soundType, x, y])
          // Client expects this format without playerId
          this.events.push(['sound', 'footstep', Math.round(player.x), Math.round(player.y)]);
        }
      }
    }
  }

  /**
   * Update game timers (delegated to GameTimer)
   * @param {number} dt - Delta time in seconds
   * @param {Array} players - Cached array of player objects
   */
  updateTimers(dt, players) {
    this.gameTimer.update(dt, players, this.events);
  }


  /**
   * Check if game should end (delegated to GameTimer)
   */
  checkWinCondition() {
    const result = this.gameTimer.checkWinCondition(this.gamePlayers);
    if (result && result.shouldEnd) {
      this.endGame(result.winner);
    }
  }

  /**
   * Build and emit state packet to all players (delegated to StateBroadcaster)
   */
  broadcastState() {
    this.broadcaster.broadcast({
      gamePlayers: this.gamePlayers,
      projectiles: this.projectiles,
      pickupManager: this.pickupManager,
      events: this.events,
      state: this.state,
      muzzleFlashActive: this.muzzleFlashActive,
      timeRemaining: this.timeRemaining,
      arenaInset: this.arenaInset,
    });

    // Clear events after broadcast
    this.events = [];
  }

  /**
   * Build players array for game-start packet
   * @param {number} now - Current timestamp
   * @returns {Array} Array of player arrays
   */
  buildPlayersArray(now) {
    return this.broadcaster.serializePlayers(this.gamePlayers, now);
  }

  /**
   * Build pickups array for game-start packet
   * @returns {Array} Array of pickup arrays
   */
  buildPickupsArray() {
    return this.broadcaster.serializePickups(this.pickupManager);
  }

  /**
   * Process player input (delegated to InputHandler)
   * @param {string} playerId - Player socket ID
   * @param {Object} inputData - Input data from client
   */
  handleInput(playerId, inputData) {
    this.inputHandler.processInput(playerId, inputData, this.gamePlayers, this);
  }

  /**
   * Pause the game
   * @param {string} playerId - Player requesting pause
   */
  pause(playerId) {
    // Validate playerId
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return;
    }

    // Validate state transition
    if (!this.isValidStateTransition(this.state, 'paused')) {
      return;
    }

    // Verify player exists in game
    const player = this.gamePlayers.get(playerId);
    if (!player) {
      return;
    }

    // Only host can pause (optional: any player can pause)
    // For now, any player can pause
    this.state = 'paused';
    this.pausedBy = playerId;

    const playerName = player.name || 'Unknown';

    this.io.to(this.code).emit('game-paused', {
      by: playerId,
      name: playerName,
    });
  }

  /**
   * Resume the game
   * @param {string} playerId - Player requesting resume
   */
  resume(playerId) {
    // Validate playerId
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return;
    }

    // Validate state transition
    if (!this.isValidStateTransition(this.state, 'playing')) {
      return;
    }

    // Only the player who paused or host can resume
    if (playerId !== this.pausedBy && playerId !== this.host) {
      return;
    }

    this.state = 'playing';
    const resumedBy = this.pausedBy;
    this.pausedBy = null;

    const player = this.gamePlayers.get(playerId);
    const playerName = player?.name || 'Unknown';

    this.io.to(this.code).emit('game-resumed', {
      by: resumedBy,
      name: playerName,
    });
  }

  /**
   * End the game
   * @param {Object} winner - Winner player object (or null for draw)
   */
  endGame(winner = null) {
    // Validate state transition (gameover can come from playing or paused)
    if (!this.isValidStateTransition(this.state, 'gameover')) {
      return;
    }

    // Set flag FIRST to prevent physics tick race condition
    this.gameLoopActive = false;
    this.state = 'gameover';

    // Stop game loops
    this.cleanup();

    // Build final results
    const results = {
      winner: winner ? {
        id: winner.id,
        name: winner.name,
        color: winner.color,
        kills: winner.kills || 0,
      } : null,
      players: Array.from(this.gamePlayers.values()).map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        kills: p.kills || 0,
        deaths: p.deaths || 0,
        hearts: p.hearts,
      })),
    };

    this.io.to(this.code).emit('game-over', { ...results, autoReturnSeconds: 15});

    // Reset debug sets to prevent memory leaks across multiple games
    this.inputHandler.reset();
    //Auto-return after timeout
    this.autoReturnTimeout = setTimeout(() => {
      if (this.state === 'gameover') {
        this.io.to(this.code).emit('auto-return-lobby');
        this.resetToLobby();
      }
    }, 15 * 1000);
  }

  /**
   * Handle player disconnect during game
   * @param {string} playerId - Disconnected player ID
   */
  handlePlayerDisconnect(playerId) {
    // Validate playerId
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return;
    }

    // Check if game loop is still active before modifying game state
    // This prevents race conditions if endGame() was called and cleared gamePlayers
    if (!this.gameLoopActive && this.state !== 'playing') {
      // Game has already ended, just clean up tracking
      this.inputRateLimiter.remove(playerId);
      return;
    }

    this.playerManager.handleDisconnect(playerId);
    // Clean up input rate tracking to prevent memory leak
    this.inputRateLimiter.remove(playerId);

    // Check if game should end due to disconnect
    // Only check if game loop is still active to prevent race with endGame()
    if (this.state === 'playing' && this.gameLoopActive) {
      this.checkWinCondition();
    }
  }

  /**
   * Remove player from game
   * @param {string} playerId - Player ID to remove
   */
  removePlayer(playerId) {
    // Validate playerId
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return;
    }

    this.playerManager.removePlayer(playerId);
  }

  /**
   * Get list of active (connected and alive) players
   * @returns {Array} Array of active players
   */
  getActivePlayers() {
    return this.playerManager.getActivePlayers();
  }

  /**
   * Reset room to lobby state
   */
  resetToLobby() {
    // Only allow reset to lobby from gameover state (or force reset)
    if (this.state !== 'gameover' && this.state !== 'lobby') {
      console.log(`[GameRoom ${this.code}] Warning: resetToLobby called from state: ${this.state}`);
    }
    if (this.autoReturnTimeout) {
      clearTimeout(this.autoReturnTimeout);
      this.autoReturnTimeout = null;
    }
    this.state = 'lobby';
    this.playerManager.reset();
    this.projectiles = [];
    this.pickupManager.reset();
    this.events = [];
    this.gameTimer.reset(this.settings);
    this.muzzleFlashActive = false;
    this.pausedBy = null;
    this.returnToLobbyRequests.clear();

    // Reset broadcaster state
    this.broadcaster.reset();

    // Reset game loop flag
    this.gameLoopActive = false;

    // Clear rate tracking and debug sets
    this.inputRateLimiter.clear();
    this.inputHandler.reset();
  }

  /**
   * Clean up intervals on game end
   */
  cleanup() {
    if (this.physicsInterval) {
      clearInterval(this.physicsInterval);
      this.physicsInterval = null;
    }

    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.autoReturnTimeout) { 
    clearTimeout(this.autoReturnTimeout);
    this.autoReturnTimeout = null;
    }
  }
}

module.exports = GameRoom;
