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

    // Game settings
    this.settings = {
      lives: settings.lives || CONSTANTS.DEFAULT_LIVES,
      timeLimit: settings.timeLimit || CONSTANTS.DEFAULT_TIME_LIMIT,
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

    // Projectile ID counter
    this.nextProjectileId = 1;

    // Pickup ID counter
    this.nextPickupId = 1;

    // Pause state
    this.pausedBy = null;

    // Return to lobby requests
    this.returnToLobbyRequests = new Set();
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
   * Add player from lobby to game state
   * @param {Object} socket - Player socket
   * @param {string} name - Player name
   * @param {string} color - Player color
   */
  addPlayer(socket, name, color) {
    const player = {
      id: socket.id,
      name: name,
      color: color,
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
      const spawn = CONSTANTS.SPAWN_POINTS[index] || CONSTANTS.SPAWN_POINTS[0];

      const gamePlayer = {
        id: player.id,
        name: player.name,
        color: player.color,
        x: spawn.x,
        y: spawn.y,
        vx: 0,
        vy: 0,
        facing: 0, // radians, 0 = right
        flashlightOn: true,
        hearts: this.settings.lives,
        hasAmmo: false,
        stunnedUntil: 0,
        invincibleUntil: 0,
        lastThrowTime: 0,
        lastFootstepTime: 0,
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

    // Initialize pickups at random positions (avoiding obstacles)
    this.pickups = [];
    for (let i = 0; i < CONSTANTS.PILLOWS_ON_MAP; i++) {
      const spawn = this.getRandomSpawnPosition();
      this.pickups.push({
        id: this.nextPickupId++,
        x: spawn.x,
        y: spawn.y,
        active: true,
        respawnAt: 0,
      });
    }

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
    this.state = 'countdown';
    this.initializeGame();

    let count = 3;

    // Emit initial countdown
    this.io.to(this.code).emit('countdown', { count });

    this.countdownInterval = setInterval(() => {
      count--;

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
   * Start the game (called after countdown)
   */
  startGame() {
    this.state = 'playing';

    const gameStartData = {
      players: this.buildPlayersArray(),
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
    const PHYSICS_DT = 1000 / CONSTANTS.PHYSICS_TICK_RATE;
    const BROADCAST_DT = 1000 / CONSTANTS.BROADCAST_RATE;

    // Physics loop - 60Hz
    this.physicsInterval = setInterval(() => {
      if (this.state !== 'playing') return;
      this.physicsTick(PHYSICS_DT / 1000); // pass delta in seconds
    }, PHYSICS_DT);

    // Broadcast loop - 20Hz
    this.broadcastInterval = setInterval(() => {
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

    // 1. Apply inputs to player velocities
    for (const player of this.gamePlayers.values()) {
      if (!player.connected || player.hearts <= 0) continue;
      Physics.applyInput(player, player.input, dt);
    }

    // 2. Move players
    for (const player of this.gamePlayers.values()) {
      if (!player.connected || player.hearts <= 0) continue;
      Physics.movePlayer(player, dt, CONSTANTS.OBSTACLES, this.arenaInset);
    }

    // 3. Update projectiles
    const projectileResult = Combat.updateProjectiles(
      this.projectiles,
      dt,
      CONSTANTS.OBSTACLES,
      Object.fromEntries(this.gamePlayers),
      this.arenaInset
    );

    this.projectiles = projectileResult.updatedProjectiles;

    // Add projectile events to events array
    for (const event of projectileResult.events) {
      this.events.push([event.type, event.victimId || null, event.attackerId || null]);

      // Track deaths
      if (event.type === 'death') {
        this.events.push(['death', event.victimId, event.attackerId]);
      }
    }

    // 4. Check pickup collisions
    this.checkPickupCollisions();

    // 5. Check footstep sounds
    this.checkFootstepSounds(now);

    // 6. Update timers
    this.updateTimers(dt);

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
   */
  checkPickupCollisions() {
    for (const player of this.gamePlayers.values()) {
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
          // Player picks up the pillow
          player.hasAmmo = true;
          pickup.active = false;
          pickup.respawnAt = Date.now() + CONSTANTS.PILLOW_RESPAWN_TIME;

          // Add pickup event
          this.events.push(['pickup', player.id, pickup.id]);
        }
      }
    }
  }

  /**
   * Check and emit footstep sounds for sprinting players
   * @param {number} now - Current timestamp
   */
  checkFootstepSounds(now) {
    for (const player of this.gamePlayers.values()) {
      if (!player.connected || player.hearts <= 0) continue;

      // Check if player is sprinting and moving
      const isMoving = player.input.up || player.input.down || player.input.left || player.input.right;
      const isSprinting = player.input.sprint && isMoving;

      if (isSprinting) {
        // Check if enough time has passed since last footstep
        if (now - player.lastFootstepTime >= FOOTSTEP_INTERVAL) {
          player.lastFootstepTime = now;

          // Add footstep sound event
          this.events.push(['sound', 'footstep', player.id, player.x, player.y]);
        }
      }
    }
  }

  /**
   * Update game timers
   * @param {number} dt - Delta time in seconds
   */
  updateTimers(dt) {
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
        for (const player of this.gamePlayers.values()) {
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

        // Add respawn event
        this.events.push(['respawn', pickup.id, pickup.x, pickup.y]);
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
        this.endGame(null); // Player died
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

    // Clear events after broadcast
    this.events = [];
  }

  /**
   * Build state packet for broadcast
   * @returns {Object} State packet
   */
  buildStatePacket() {
    const now = Date.now();

    return {
      t: now,
      s: this.state,
      mf: this.muzzleFlashActive,
      time: Math.max(0, Math.ceil(this.timeRemaining)),
      inset: this.arenaInset,
      p: this.buildPlayersArray(),
      j: this.buildProjectilesArray(),
      k: this.buildPickupsArray(),
      e: this.events,
    };
  }

  /**
   * Build players array for state packet
   * @returns {Array} Array of player arrays
   */
  buildPlayersArray() {
    const now = Date.now();
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

    // Update movement input
    if (inputData.input !== undefined) {
      const input = inputData.input;
      player.input.up = !!input.up;
      player.input.down = !!input.down;
      player.input.left = !!input.left;
      player.input.right = !!input.right;
      player.input.sprint = !!input.sprint;
    }

    // Update facing direction
    if (inputData.facing !== undefined) {
      player.facing = inputData.facing;
    }

    // Handle flashlight toggle (inside inputData.input)
    if (inputData.input?.flashlight) {
      player.flashlightOn = !player.flashlightOn;
      console.log(`[GameRoom ${this.code}] Player ${playerId.substring(0, 8)} flashlight toggled to: ${player.flashlightOn}`);
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
    const now = Date.now();

    // Check if player can throw
    if (!Combat.canThrow(player, now)) {
      return;
    }

    // Create projectile
    const projectileId = `proj_${this.nextProjectileId++}`;
    const projectile = Combat.createProjectile(player, projectileId);

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
    if (this.state !== 'playing') return;

    // Only host can pause (optional: any player can pause)
    // For now, any player can pause
    this.state = 'paused';
    this.pausedBy = playerId;

    const player = this.gamePlayers.get(playerId);
    const playerName = player ? player.name : 'Unknown';

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
    if (this.state !== 'paused') return;

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
    const player = this.gamePlayers.get(playerId);
    if (player) {
      player.connected = false;
    }
  }

  /**
   * Remove player from game
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
   * Reset room to lobby state
   */
  resetToLobby() {
    this.state = 'lobby';
    this.gamePlayers.clear();
    this.projectiles = [];
    this.pickups = [];
    this.events = [];
    this.timeRemaining = this.settings.timeLimit;
    this.arenaInset = 0;
    this.suddenDeath = false;
    this.muzzleFlashActive = false;
    this.pausedBy = null;
    this.returnToLobbyRequests.clear();
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
