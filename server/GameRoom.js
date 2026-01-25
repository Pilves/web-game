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
const Physics = require('./Physics');
const Combat = require('./Combat');

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

    // Game state (only populated when game is active)
    this.gamePlayers = new Map(); // socketId -> game player object
    this.projectiles = [];
    this.pickups = [];
    this.events = [];

    // Timers
    this.timeRemaining = this.settings.timeLimit;
    this.arenaInset = 0;
    this.suddenDeath = false;
    this.lastShrinkTime = 0;

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

    // Pickup ID counter
    this.nextPickupId = 1;

    // Pause state
    this.pausedBy = null;

    // Return to lobby requests
    this.returnToLobbyRequests = new Set();

    // State sequence number for network synchronization
    this.stateSequence = 0;

    // Cached object representation of gamePlayers (updated when players change)
    this.gamePlayersObject = {};

    // Rate limiting: Track input counts per player using time window counter
    this.inputRateTracking = new Map(); // playerId -> { count: number, windowStart: timestamp, lastWarning: timestamp }
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
   * Check if input rate is within limits (prevents flooding)
   * Uses a simple counter with time window instead of filtering arrays
   * @param {string} playerId - Player socket ID
   * @returns {boolean} true if input should be processed, false if rate limited
   */
  checkInputRateLimit(playerId) {
    const now = Date.now();
    const windowMs = 1000; // 1 second window
    const maxPackets = CONSTANTS.INPUT_RATE_LIMIT;

    let tracking = this.inputRateTracking.get(playerId);
    if (!tracking) {
      tracking = { count: 0, windowStart: now, lastWarning: 0 };
      this.inputRateTracking.set(playerId, tracking);
    }

    // Check if we need to reset the window
    if (now - tracking.windowStart >= windowMs) {
      // Start a new window
      tracking.windowStart = now;
      tracking.count = 0;  // Reset to 0, not 1
    }

    // Increment counter
    tracking.count++;

    // Check if over limit
    if (tracking.count > maxPackets) {
      // Log warning at most once per second
      if (now - tracking.lastWarning > 1000) {
        console.log(`[GameRoom ${this.code}] Rate limiting player ${playerId.substring(0, 8)}: ${tracking.count} packets/sec`);
        tracking.lastWarning = now;
      }
      return false;
    }

    return true;
  }

  /**
   * Generate a random spawn position that doesn't overlap with obstacles
   * @param {number} padding - Extra padding around obstacles (default 30)
   * @returns {Object} {x, y} coordinates
   */
  getRandomSpawnPosition(padding = 30) {
    const pickupSize = CONSTANTS.PROJECTILE_SIZE;
    const margin = 50; // Stay away from arena edges

    const minX = margin + pickupSize / 2;
    const maxX = CONSTANTS.ARENA_WIDTH - margin - pickupSize / 2;
    const minY = margin + pickupSize / 2;
    const maxY = CONSTANTS.ARENA_HEIGHT - margin - pickupSize / 2;

    // Try to find a valid position (max 100 attempts)
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = minX + Math.random() * (maxX - minX);
      const y = minY + Math.random() * (maxY - minY);

      // Check if position overlaps with any obstacle (with padding)
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

    // Fallback: return center of arena if no valid position found
    return { x: CONSTANTS.ARENA_WIDTH / 2, y: CONSTANTS.ARENA_HEIGHT / 2 };
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
    const sanitizedName = typeof name === 'string'
      ? name.trim().slice(0, 20)
      : 'Player';

    // Validate color (hex color format)
    const colorRegex = /^#[0-9A-Fa-f]{6}$/;
    const sanitizedColor = (typeof color === 'string' && colorRegex.test(color))
      ? color
      : '#ffffff';

    const player = {
      id: socket.id,
      name: sanitizedName || 'Player',
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
    const playerList = Array.from(this.players.values());

    // Initialize game players with spawn positions
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
        hearts: this.settings.lives,
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

    // Sync the cached object representation
    this.syncGamePlayersObject();

    // Initialize pickups at random positions (avoiding obstacles)
    this.pickups = [];
    for (let i = 0; i < CONSTANTS.PILLOWS_ON_MAP; i++) {
      const spawn = this.getRandomSpawnPosition();
      console.log(`[GameRoom ${this.code}] Pickup ${i + 1} spawning at:`, spawn);
      this.pickups.push({
        id: this.nextPickupId++,
        x: spawn.x,
        y: spawn.y,
        active: true,
        respawnAt: 0,
      });
    }
    console.log(`[GameRoom ${this.code}] Pickups spawned:`, this.pickups.map(p => `(${Math.round(p.x)}, ${Math.round(p.y)})`).join(', '));

    // Reset game state
    this.projectiles = [];
    this.events = [];
    this.timeRemaining = this.settings.timeLimit;
    this.arenaInset = 0;
    this.suddenDeath = false;
    this.lastShrinkTime = 0;
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
    this.pickups = [];
    this.events = [];
    // Reset debug sets to avoid stale state on next game start
    this._inputWarned = new Set();
    this._inputReceived = new Set();
    this._broadcastCount = 0;
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

    console.log(`[GameRoom ${this.code}] Starting game with ${gameStartData.players.length} players`);
    console.log(`[GameRoom ${this.code}] Player positions:`, gameStartData.players.map(p => ({ id: p[0].substring(0, 8), x: p[1], y: p[2] })));

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
      this.gamePlayersObject,
      this.arenaInset
    );

    // Create new array instead of reassigning to avoid reference issues
    this.projectiles = projectileResult.updatedProjectiles.slice();

    // Add projectile events to events array
    for (const event of projectileResult.events) {
      // Handle different event types with proper data
      if (event.type === 'hit' || event.type === 'death') {
        this.events.push([event.type, event.victimId || null, event.attackerId || null]);
      } else if (event.type === 'wall-hit' || event.type === 'obstacle-hit') {
        this.events.push([event.type, event.projectileId || null, event.x || 0, event.y || 0]);
      } else {
        // Fallback for other event types
        this.events.push([event.type, event.victimId || null, event.attackerId || null]);
      }
    }

    // 4. Check pickup collisions
    this.checkPickupCollisions(players);

    // 5. Check footstep sounds
    this.checkFootstepSounds(now, players);

    // 6. Update timers
    this.updateTimers(dt, players);

    // 7. Update muzzle flash
    if (this.muzzleFlashActive && now >= this.muzzleFlashUntil) {
      this.muzzleFlashActive = false;
    }

    // 8. Respawn pickups
    this.respawnPickups(now);

    // 9. Check win condition
    this.checkWinCondition();
  }

  /**
   * Check if players pick up pillows
   * @param {Array} players - Cached array of player objects
   */
  checkPickupCollisions(players) {
    for (const player of players) {
      // Skip players who: are disconnected, are dead, or already have ammo
      if (!player.connected || player.hearts <= 0 || player.hasAmmo) continue;

      const playerRect = Physics.getPlayerRect(player);

      for (const pickup of this.pickups) {
        if (!pickup.active) continue;

        const pickupRect = {
          x: pickup.x - CONSTANTS.PROJECTILE_SIZE / 2,
          y: pickup.y - CONSTANTS.PROJECTILE_SIZE / 2,
          width: CONSTANTS.PROJECTILE_SIZE,
          height: CONSTANTS.PROJECTILE_SIZE,
        };

        if (Physics.rectsCollide(playerRect, pickupRect)) {
          console.log(`[GameRoom ${this.code}] Player ${player.name} picked up pillow ${pickup.id} at (${pickup.x}, ${pickup.y})`);

          // Push event BEFORE updating pickup.active to avoid race condition
          // Include pickup position in event for client sync
          this.events.push(['pickup', player.id, pickup.id, pickup.x, pickup.y]);

          // Player picks up the pillow
          player.hasAmmo = true;
          pickup.active = false;
          pickup.respawnAt = Date.now() + CONSTANTS.PILLOW_RESPAWN_TIME;
        }
      }
    }
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
          this.events.push(['sound', 'footstep', player.x, player.y]);
        }
      }
    }
  }

  /**
   * Update game timers
   * @param {number} dt - Delta time in seconds
   * @param {Array} players - Cached array of player objects
   */
  updateTimers(dt, players) {
    // Update time remaining
    this.timeRemaining -= dt;

    if (this.timeRemaining <= 0 && !this.suddenDeath) {
      this.startSuddenDeath();
    }

    // Handle arena shrinking in sudden death
    if (this.suddenDeath) {
      const now = Date.now();
      if (now - this.lastShrinkTime >= CONSTANTS.ARENA_SHRINK_INTERVAL) {
        this.arenaInset += CONSTANTS.ARENA_SHRINK_AMOUNT;
        this.lastShrinkTime = now;

        // Check if players are caught in the shrink zone
        for (const player of players) {
          if (!player.connected || player.hearts <= 0) continue;

          const halfSize = CONSTANTS.PLAYER_SIZE / 2;
          const minX = this.arenaInset + halfSize;
          const maxX = CONSTANTS.ARENA_WIDTH - this.arenaInset - halfSize;
          const minY = this.arenaInset + halfSize;
          const maxY = CONSTANTS.ARENA_HEIGHT - this.arenaInset - halfSize;

          // Push players into valid area
          if (player.x < minX) player.x = minX;
          if (player.x > maxX) player.x = maxX;
          if (player.y < minY) player.y = minY;
          if (player.y > maxY) player.y = maxY;
        }
      }
    }
  }

  /**
   * Respawn inactive pickups
   * @param {number} now - Current timestamp
   */
  respawnPickups(now) {
    for (const pickup of this.pickups) {
      if (!pickup.active && pickup.respawnAt > 0 && now >= pickup.respawnAt) {
        // Get new random position for respawn
        const newPos = this.getRandomSpawnPosition();
        pickup.x = newPos.x;
        pickup.y = newPos.y;
        pickup.active = true;
        pickup.respawnAt = 0;

        // Note: pickup-respawn events are broadcast via the pickups array in state packets.
        // This event is intentionally not processed by client event handlers but could be
        // used for future features like respawn animations or sounds.
      }
    }
  }

  /**
   * Check if game should end
   */
  checkWinCondition() {
    const alivePlayers = Array.from(this.gamePlayers.values())
      .filter(p => p.connected && p.hearts > 0);
    const totalPlayers = this.gamePlayers.size;

    // Solo mode: only end when player dies or time runs out
    if (totalPlayers === 1) {
      if (alivePlayers.length === 0) {
        this.endGame(null);  // Player died
      } else if (this.timeRemaining <= 0 && this.suddenDeath && this.arenaInset >= Math.min(CONSTANTS.ARENA_WIDTH, CONSTANTS.ARENA_HEIGHT) * 0.3) {
        // Solo player survived sudden death long enough (30% arena shrink) - they win!
        this.endGame(alivePlayers[0]);
      }
      return;
    }

    // Multiplayer: Game ends when 1 or fewer players remain
    if (alivePlayers.length <= 1) {
      const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;
      this.endGame(winner);
    }
  }

  /**
   * Start sudden death mode
   */
  startSuddenDeath() {
    this.suddenDeath = true;
    this.lastShrinkTime = Date.now();
    this.timeRemaining = 0;

    // Emit sudden death event
    this.io.to(this.code).emit('sudden-death');
    this.events.push(['sudden-death']);
  }

  /**
   * Build and emit state packet to all players
   */
  broadcastState() {
    const packet = this.buildStatePacket();

    // Debug: log first broadcast and every 20th after
    if (!this._broadcastCount) this._broadcastCount = 0;
    this._broadcastCount++;
    if (this._broadcastCount === 1 || this._broadcastCount % 20 === 0) {
      console.log(`[GameRoom ${this.code}] Broadcast #${this._broadcastCount}:`, {
        state: packet.s,
        playerCount: packet.p?.length,
        playerPositions: packet.p?.map(p => ({ id: p[0].substring(0, 8), x: p[1], y: p[2] }))
      });
    }

    this.io.to(this.code).emit('state', packet);

    // Clear events after broadcast (create new array to avoid reference issues
    // if previous array is still being processed)
    this.events = [];
  }

  /**
   * Build state packet for broadcast
   * @returns {Object} State packet
   */
  buildStatePacket() {
    const now = Date.now();

    // Create copy of events to avoid reference issues when array is cleared after broadcast
    const eventsCopy = this.events.slice();

    return {
      seq: this.stateSequence++,
      t: now,
      s: this.state,
      mf: this.muzzleFlashActive,
      time: Math.max(0, Math.floor(this.timeRemaining)),
      inset: this.arenaInset,
      p: this.buildPlayersArray(now),
      j: this.buildProjectilesArray(),
      k: this.buildPickupsArray(),
      e: eventsCopy,
    };
  }

  /**
   * Build players array for state packet
   * @param {number} now - Current timestamp
   * @returns {Array} Array of player arrays
   */
  buildPlayersArray(now) {
    const result = [];

    for (const player of this.gamePlayers.values()) {
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
        player.flashlightOnSince || 0, // Timestamp for flicker effect
      ]);
    }

    return result;
  }

  /**
   * Build projectiles array for state packet
   * @returns {Array} Array of projectile arrays
   */
  buildProjectilesArray() {
    return this.projectiles.map(p => [
      p.id,
      Math.round(p.x),
      Math.round(p.y),
      Math.round(p.vx),
      Math.round(p.vy),
    ]);
  }

  /**
   * Build pickups array for state packet
   * @returns {Array} Array of pickup arrays
   */
  buildPickupsArray() {
    return this.pickups.map(p => [
      p.id,
      p.x,
      p.y,
      p.active,
    ]);
  }

  /**
   * Process player input
   * @param {string} playerId - Player socket ID
   * @param {Object} inputData - Input data from client
   */
  handleInput(playerId, inputData) {
    // Validate playerId
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return;
    }

    // Validate inputData is an object
    if (inputData === null || typeof inputData !== 'object') {
      return;
    }

    // Rate limiting check - prevent input flooding (DOS protection)
    if (!this.checkInputRateLimit(playerId)) {
      return;
    }

    if (this.state !== 'playing') {
      // Log once per player
      if (!this._inputWarned) {
        this._inputWarned = new Set();
      }
      if (!this._inputWarned.has(playerId)) {
        console.log(`[GameRoom ${this.code}] handleInput ignored - state is ${this.state}, not playing`);
        this._inputWarned.add(playerId);
      }
      return;
    }

    const player = this.gamePlayers.get(playerId);
    if (!player || !player.connected || player.hearts <= 0) {
      console.log(`[GameRoom ${this.code}] handleInput ignored - player issue:`, {
        exists: !!player,
        connected: player?.connected,
        hearts: player?.hearts
      });
      return;
    }

    // Debug: log first input from each player
    if (!this._inputReceived) this._inputReceived = new Set();
    if (!this._inputReceived.has(playerId)) {
      console.log(`[GameRoom ${this.code}] First input from player ${playerId.substring(0, 8)}:`, inputData);
      this._inputReceived.add(playerId);
    }

    // Update movement input (with null check for input object)
    if (inputData.input !== undefined && inputData.input !== null && typeof inputData.input === 'object') {
      const input = inputData.input;
      player.input.up = input.up === true;
      player.input.down = input.down === true;
      player.input.left = input.left === true;
      player.input.right = input.right === true;
      player.input.sprint = input.sprint === true;
    }

    // Update facing direction (validate and normalize to -PI to PI range)
    if (inputData.facing !== undefined) {
      const facing = parseFloat(inputData.facing);
      if (Number.isFinite(facing)) {
        // Normalize angle to valid range (-PI to PI)
        let normalizedFacing = facing % (2 * Math.PI);
        if (normalizedFacing > Math.PI) {
          normalizedFacing -= 2 * Math.PI;
        } else if (normalizedFacing < -Math.PI) {
          normalizedFacing += 2 * Math.PI;
        }
        player.facing = normalizedFacing;
      }
    }

    // Handle flashlight toggle (inside inputData.input) with debounce
    if (inputData.input?.flashlight) {
      const now = Date.now();
      const FLASHLIGHT_TOGGLE_COOLDOWN = 100; // ms debounce

      if (now - player.lastFlashlightToggle >= FLASHLIGHT_TOGGLE_COOLDOWN) {
        player.flashlightOn = !player.flashlightOn;
        player.lastFlashlightToggle = now;
        // Track flashlight on time for flicker effect
        player.flashlightOnSince = player.flashlightOn ? now : 0;
        console.log(`[GameRoom ${this.code}] Player ${playerId.substring(0, 8)} flashlight toggled to: ${player.flashlightOn}`);
      }
    }

    // Handle throw action (inside inputData.input)
    if (inputData.input?.throw) {
      this.handleThrow(player);
    }
  }

  /**
   * Handle player throw action
   * @param {Object} player - Player object
   */
  handleThrow(player) {
    // Validate player object
    if (!player || typeof player !== 'object') {
      return;
    }

    // Limit projectiles per room to prevent DOS
    const MAX_PROJECTILES = 50;
    if (this.projectiles.length >= MAX_PROJECTILES) {
      console.log(`[GameRoom ${this.code}] Projectile limit reached, ignoring throw`);
      return;
    }

    const now = Date.now();

    // Check if player can throw
    if (!Combat.canThrow(player, now)) {
      console.log(`[GameRoom ${this.code}] Player ${player.name} cannot throw:`, {
        hasAmmo: player.hasAmmo,
        cooldown: now - (player.lastThrowTime || 0),
        stunned: player.stunnedUntil > now
      });
      return;
    }

    // Create projectile (with overflow protection)
    const projectileId = `proj_${this.nextProjectileId}`;
    this.nextProjectileId = (this.nextProjectileId % this.MAX_PROJECTILE_ID) + 1;
    const projectile = Combat.createProjectile(player, projectileId);
    console.log(`[GameRoom ${this.code}] Player ${player.name} threw projectile:`, projectile);

    this.projectiles.push(projectile);

    // Update player state
    player.hasAmmo = false;
    player.lastThrowTime = now;

    // Trigger muzzle flash
    this.muzzleFlashActive = true;
    this.muzzleFlashUntil = now + CONSTANTS.MUZZLE_FLASH_DURATION;

    // Add throw event
    this.events.push(['throw', player.id, projectile.x, projectile.y]);
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

    this.io.to(this.code).emit('game-resumed', { by: resumedBy });
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

    this.io.to(this.code).emit('game-over', results);
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

    const player = this.gamePlayers.get(playerId);
    if (player) {
      player.connected = false;
    }
    // Clean up input rate tracking to prevent memory leak
    this.inputRateTracking.delete(playerId);

    // Check if game should end due to disconnect
    if (this.state === 'playing') {
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
   * Reset room to lobby state
   */
  resetToLobby() {
    // Only allow reset to lobby from gameover state (or force reset)
    if (this.state !== 'gameover' && this.state !== 'lobby') {
      console.log(`[GameRoom ${this.code}] Warning: resetToLobby called from state: ${this.state}`);
    }
    this.state = 'lobby';
    this.gamePlayers.clear();
    this.syncGamePlayersObject();
    this.projectiles = [];
    this.pickups = [];
    this.events = [];
    this.timeRemaining = this.settings.timeLimit;
    this.arenaInset = 0;
    this.suddenDeath = false;
    this.muzzleFlashActive = false;
    this.pausedBy = null;
    this.returnToLobbyRequests.clear();

    // Reset state sequence to 0 for network sync
    this.stateSequence = 0;

    // Reset game loop flag
    this.gameLoopActive = false;

    // Clear rate tracking and debug sets
    this.inputRateTracking.clear();
    this._inputWarned = new Set();
    this._inputReceived = new Set();
    this._broadcastCount = 0;
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
  }
}

module.exports = GameRoom;
