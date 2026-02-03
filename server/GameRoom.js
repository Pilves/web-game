const CONSTANTS = require('./constants');
const Names = require('../shared/names.js');
const Physics = require('./Physics');
const Combat = require('./Combat');
const RateLimiter = require('./RateLimiter');
const PickupManager = require('./PickupManager');
const StateBroadcaster = require('./StateBroadcaster');
const InputHandler = require('./InputHandler');
const GameTimer = require('./GameTimer');
const PlayerManager = require('./PlayerManager');

const FOOTSTEP_INTERVAL = 300;

class GameRoom {
  constructor(io, code, host, settings = {}) {
    this.io = io;
    this.code = code;
    this.host = host;

    this.state = 'lobby';

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

    this.players = new Map();
    this.playerManager = new PlayerManager(code);

    this.projectiles = [];
    this.pickupManager = new PickupManager(code);
    this.events = [];

    this.gameTimer = new GameTimer(io, code);
    this.gameTimer.reset(this.settings);

    this.muzzleFlashActive = false;
    this.muzzleFlashUntil = 0;

    this.physicsInterval = null;
    this.broadcastInterval = null;
    this.countdownInterval = null;

    this.nextProjectileId = 1;
    this.MAX_PROJECTILE_ID = Number.MAX_SAFE_INTEGER;

    this.broadcaster = new StateBroadcaster(io, code);
    this.inputHandler = new InputHandler(code);

    this.pausedBy = null;
    this.returnToLobbyRequests = new Set();
    this.inputRateLimiter = new RateLimiter();
  }

  get timeRemaining() { return this.gameTimer.timeRemaining; }
  set timeRemaining(v) { this.gameTimer.timeRemaining = v; }
  get arenaInset() { return this.gameTimer.arenaInset; }
  set arenaInset(v) { this.gameTimer.arenaInset = v; }
  get suddenDeath() { return this.gameTimer.suddenDeath; }
  set suddenDeath(v) { this.gameTimer.suddenDeath = v; }

  get gamePlayers() { return this.playerManager.gamePlayers; }
  get gamePlayersObject() { return this.playerManager.gamePlayersObject; }
  set gamePlayersObject(v) { this.playerManager.gamePlayersObject = v; }

  syncGamePlayersObject() {
    this.playerManager.syncGamePlayersObject();
  }

  checkInputRateLimit(playerId) {
    return this.inputRateLimiter.checkWindowLimit(playerId, 1000, CONSTANTS.INPUT_RATE_LIMIT);
  }

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

  addPlayer(socket, name, color) {
    if (!socket || typeof socket.id !== 'string' || socket.id.length === 0) {
      return;
    }

    const sanitizedName = (typeof name === 'string' && name.trim().length > 0)
      ? name.trim().slice(0, 20)
      : Names.generateName();

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

  initializeGame() {
    this.playerManager.initializePlayers(this.players, this.settings);
    this.pickupManager.initialize(this.arenaInset);

    this.projectiles = [];
    this.events = [];
    this.gameTimer.reset(this.settings);
    this.muzzleFlashActive = false;
    this.muzzleFlashUntil = 0;
  }

  startCountdown() {
    if (!this.isValidStateTransition(this.state, 'countdown')) {
      return;
    }
    this.state = 'countdown';
    this.initializeGame();

    let count = 3;
    this.io.to(this.code).emit('countdown', { count });

    this.countdownInterval = setInterval(() => {
      count--;

      if (this.players.size < CONSTANTS.MIN_PLAYERS) {
        this.cancelCountdown('Not enough players');
        return;
      }

      if (count > 0) {
        this.io.to(this.code).emit('countdown', { count });
      } else if (count === 0) {
        this.io.to(this.code).emit('countdown', { count: 0 });
      } else {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
        this.startGame();
      }
    }, 1000);
  }

  cancelCountdown(reason) {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.state = 'lobby';
    this.gamePlayers.clear();
    this.gamePlayersObject = {};
    this.projectiles = [];
    this.pickupManager.reset();
    this.events = [];
    this.inputHandler.reset();
    this.io.to(this.code).emit('countdown-cancelled', { reason });
  }

  startGame() {
    if (!this.isValidStateTransition(this.state, 'playing')) {
      return;
    }

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

    this.io.to(this.code).emit('game-start', gameStartData);

    this.startGameLoop();
  }

  startGameLoop() {
    this.cleanup();
    this.gameLoopActive = true;

    const PHYSICS_DT = 1000 / CONSTANTS.PHYSICS_TICK_RATE;
    const BROADCAST_DT = 1000 / CONSTANTS.BROADCAST_RATE;

    this.physicsInterval = setInterval(() => {
      if (this.state !== 'playing' || !this.gameLoopActive) return;
      this.physicsTick(PHYSICS_DT / 1000); // pass delta in seconds
    }, PHYSICS_DT);

    this.broadcastInterval = setInterval(() => {
      if (!this.gameLoopActive) return;
      if (this.state !== 'playing' && this.state !== 'paused') return;
      this.broadcastState();
    }, BROADCAST_DT);
  }

  physicsTick(dt) {
    const now = Date.now();
    const players = Array.from(this.gamePlayers.values());

    for (const player of players) {
      if (!player.connected || player.hearts <= 0) continue;
      Physics.applyInput(player, player.input, dt);
    }

    for (const player of players) {
      if (!player.connected || player.hearts <= 0) continue;
      Physics.movePlayer(player, dt, CONSTANTS.OBSTACLES, this.arenaInset);
    }

    const projectileResult = Combat.updateProjectiles(
      this.projectiles,
      dt,
      CONSTANTS.OBSTACLES,
      this.gamePlayers,
      this.arenaInset
    );

    this.projectiles = projectileResult.updatedProjectiles;

    for (const event of projectileResult.events) {
      if (event.type === 'hit' || event.type === 'death') {
        this.events.push([event.type, event.victimId || null, event.attackerId || null]);
      } else if (event.type === 'wall-hit' || event.type === 'obstacle-hit') {
        this.events.push([event.type, event.projectileId || null, Math.round(event.x || 0), Math.round(event.y || 0)]);
      } else {
        this.events.push([event.type, event.victimId || null, event.attackerId || null]);
      }
    }

    this.pickupManager.checkCollisions(players, this.events);
    this.checkFootstepSounds(now, players);
    this.updateTimers(dt, players);

    if (this.muzzleFlashActive && now >= this.muzzleFlashUntil) {
      this.muzzleFlashActive = false;
    }

    this.pickupManager.respawn(now, this.arenaInset);
    this.checkWinCondition();
  }


  checkFootstepSounds(now, players) {
    for (const player of players) {
      if (!player.connected || player.hearts <= 0) continue;

      const isMoving = player.input.up || player.input.down || player.input.left || player.input.right;
      const isSprinting = player.input.sprint && isMoving;

      if (isSprinting) {
        if (now - player.lastFootstepTime >= FOOTSTEP_INTERVAL) {
          player.lastFootstepTime = now;

          this.events.push(['sound', 'footstep', Math.round(player.x), Math.round(player.y)]);
        }
      }
    }
  }

  updateTimers(dt, players) {
    this.gameTimer.update(dt, players, this.events);
  }


  checkWinCondition() {
    const result = this.gameTimer.checkWinCondition(this.gamePlayers);
    if (result && result.shouldEnd) {
      this.endGame(result.winner);
    }
  }

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

    this.events = [];
  }

  buildPlayersArray(now) {
    return this.broadcaster.serializePlayers(this.gamePlayers, now);
  }

  buildPickupsArray() {
    return this.broadcaster.serializePickups(this.pickupManager);
  }

  handleInput(playerId, inputData) {
    this.inputHandler.processInput(playerId, inputData, this.gamePlayers, this);
  }

  pause(playerId) {
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return;
    }

    if (!this.isValidStateTransition(this.state, 'paused')) {
      return;
    }

    const player = this.gamePlayers.get(playerId);
    if (!player) {
      return;
    }

    this.state = 'paused';
    this.pausedBy = playerId;

    const playerName = player.name || 'Unknown';

    this.io.to(this.code).emit('game-paused', {
      by: playerId,
      name: playerName,
    });
  }

  resume(playerId) {
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return;
    }

    if (!this.isValidStateTransition(this.state, 'playing')) {
      return;
    }

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

  endGame(winner = null) {
    if (!this.isValidStateTransition(this.state, 'gameover')) {
      return;
    }

    this.gameLoopActive = false;
    this.state = 'gameover';

    this.cleanup();

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

    this.inputHandler.reset();
    this.autoReturnTimeout = setTimeout(() => {
      if (this.state === 'gameover') {
        this.io.to(this.code).emit('auto-return-lobby');
        this.resetToLobby();
      }
    }, 15 * 1000);
  }

  handlePlayerDisconnect(playerId) {
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return;
    }

    // Game already ended, just clean up
    if (!this.gameLoopActive && this.state !== 'playing') {
      this.inputRateLimiter.remove(playerId);
      return;
    }

    this.playerManager.handleDisconnect(playerId);
    this.inputRateLimiter.remove(playerId);

    if (this.state === 'playing' && this.gameLoopActive) {
      this.checkWinCondition();
    }
  }

  removePlayer(playerId) {
    if (typeof playerId !== 'string' || playerId.length === 0) {
      return;
    }

    this.playerManager.removePlayer(playerId);
  }

  getActivePlayers() {
    return this.playerManager.getActivePlayers();
  }

  resetToLobby() {
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

    this.broadcaster.reset();
    this.gameLoopActive = false;
    this.inputRateLimiter.clear();
    this.inputHandler.reset();
  }

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
