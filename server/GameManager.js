const CONSTANTS = require('./constants');
const GameRoom = require('./GameRoom');
const RateLimiter = require('./RateLimiter');

class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();      // roomCode -> GameRoom
    this.players = new Map();    // socket.id -> player object
    this.roomCreationCooldown = new Map(); // socket.id -> timestamp (rate limiting)
    this.rateLimiter = new RateLimiter();
  }

  checkEventRateLimit(socketId, event, cooldownMs = 500) {
    return this.rateLimiter.checkCooldown(`${socketId}:${event}`, cooldownMs);
  }

  cleanupRateLimits(socketId) {
    this.rateLimiter.cleanup(`${socketId}:`);
  }

  cleanupStaleRateLimits() {
    this.rateLimiter.cleanupStale();
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
    const maxPossibleCodes = Math.pow(chars.length, CONSTANTS.ROOM_CODE_LENGTH);
    const maxIterations = Math.min(1000, maxPossibleCodes);
    let code;
    let iterations = 0;

    do {
      code = '';
      for (let i = 0; i < CONSTANTS.ROOM_CODE_LENGTH; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      iterations++;

      if (iterations >= maxIterations) {
        console.error(`[GameManager] Failed to generate unique room code after ${maxIterations} attempts. Active rooms: ${this.rooms.size}`);
        return null;
      }
    } while (this.rooms.has(code));

    return code;
  }

  getNextColor(room) {
    const usedColors = new Set(
      Array.from(room.players.values()).map(p => p.color)
    );
    for (const color of CONSTANTS.PLAYER_COLORS) {
      if (!usedColors.has(color)) {
        return color;
      }
    }
    return CONSTANTS.PLAYER_COLORS[0]; // Fallback
  }

  isNameUnique(room, name, excludeSocketId = null) {
    for (const [socketId, player] of room.players) {
      if (socketId !== excludeSocketId && player.name.toLowerCase() === name.toLowerCase()) {
        return false;
      }
    }
    return true;
  }

  createRoom(socket, data) {
    if (this.rooms.size >= CONSTANTS.MAX_ROOMS) {
      socket.emit('join-error', { message: 'Server is full. Try again later.' });
      return;
    }

    if (this.roomCreationCooldown.has(socket.id)) {
      socket.emit('join-error', { message: 'Please wait before creating another room' });
      return;
    }

    const { name } = data || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      socket.emit('join-error', { message: 'Please enter a valid name' });
      return;
    }

    const playerName = name.trim().substring(0, 20).replace(/[^a-zA-Z0-9 _-]/g, '');

    let code = null;
    let room = null;
    const maxAttempts = 10;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      code = this.generateRoomCode();

      if (!code) {
        socket.emit('join-error', { message: 'Server is busy. Please try again later.' });
        return;
      }

      if (!this.rooms.has(code)) {
        room = new GameRoom(this.io, code, socket.id);
        this.rooms.set(code, room);
        break;
      }
    }

    if (!room) {
      socket.emit('join-error', { message: 'Server is busy. Please try again later.' });
      return;
    }

    this.roomCreationCooldown.set(socket.id, Date.now());
    setTimeout(() => this.roomCreationCooldown.delete(socket.id), CONSTANTS.ROOM_CREATION_COOLDOWN);

    const player = {
      id: socket.id,
      name: playerName,
      color: CONSTANTS.PLAYER_COLORS[0],
      ready: false,
      roomCode: code,
    };

    this.players.set(socket.id, player);
    room.players.set(socket.id, player);
    socket.join(code);

    socket.emit('room-created', { code });
    this.broadcastLobbyUpdate(room);
  }

  joinRoom(socket, data) {
    const { code, name } = data || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      socket.emit('join-error', { message: 'Please enter a valid name' });
      return;
    }

    if (!code || typeof code !== 'string') {
      socket.emit('join-error', { message: 'Please enter a room code' });
      return;
    }

    const roomCode = String(code || '').toUpperCase().trim();
    if (!/^[A-Z]{4}$/.test(roomCode)) {
      socket.emit('join-error', { message: 'Invalid room code format' });
      return;
    }

    const playerName = name.trim().substring(0, 20).replace(/[^a-zA-Z0-9 _-]/g, '');

    const room = this.rooms.get(roomCode);
    if (!room) {
      socket.emit('join-error', { message: 'Room not found' });
      return;
    }

    if (room.players.size >= CONSTANTS.MAX_PLAYERS) {
      socket.emit('join-error', { message: 'Room is full' });
      return;
    }

    if (room.state !== 'lobby') {
      socket.emit('join-error', { message: 'Game already in progress' });
      return;
    }

    if (!this.isNameUnique(room, playerName)) {
      socket.emit('join-error', { message: 'Name already taken in this room' });
      return;
    }

    const color = this.getNextColor(room);

    const player = {
      id: socket.id,
      name: playerName,
      color: color,
      ready: false,
      roomCode: roomCode,
    };

    // Re-verify room still exists before mutations
    const roomVerify = this.rooms.get(roomCode);
    if (!roomVerify || roomVerify !== room) {
      socket.emit('join-error', { message: 'Room no longer available' });
      return;
    }

    if (roomVerify.players.size >= CONSTANTS.MAX_PLAYERS) {
      socket.emit('join-error', { message: 'Room is full' });
      return;
    }

    if (roomVerify.state !== 'lobby') {
      socket.emit('join-error', { message: 'Game already in progress' });
      return;
    }

    this.players.set(socket.id, player);
    roomVerify.players.set(socket.id, player);
    socket.join(roomCode);

    socket.emit('room-joined', { code: roomCode });
    this.broadcastLobbyUpdate(roomVerify);
  }

  toggleReady(socket) {
    if (!this.checkEventRateLimit(socket.id, 'toggle-ready', 500)) return;

    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room || room.state !== 'lobby') return;

    // Host is always "ready" conceptually, but we allow toggle
    player.ready = !player.ready;

    this.broadcastLobbyUpdate(room);
  }

  kickPlayer(socket, data) {
    if (!this.checkEventRateLimit(socket.id, 'kick-player', 500)) return;

    const { playerId } = data || {};
    if (!playerId) return;

    const hostPlayer = this.players.get(socket.id);
    if (!hostPlayer) return;

    const room = this.rooms.get(hostPlayer.roomCode);
    if (!room) return;

    // Only host can kick
    if (room.host !== socket.id) {
      return;
    }

    // Cannot kick yourself
    if (playerId === socket.id) {
      return;
    }

    // Only kick during lobby
    if (room.state !== 'lobby') {
      return;
    }

    const kickedPlayer = room.players.get(playerId);
    if (!kickedPlayer) return;

    room.players.delete(playerId);
    this.players.delete(playerId);

    const kickedSocket = this.io.sockets.sockets.get(playerId);
    if (kickedSocket) {
      kickedSocket.leave(room.code);
      kickedSocket.emit('kicked');
    }

    this.broadcastLobbyUpdate(room);
  }

  updateSettings(socket, data) {
    if (!this.checkEventRateLimit(socket.id, 'update-settings', 200)) return;

    if (!data || typeof data !== 'object') return;

    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    // Only host can update settings
    if (room.host !== socket.id) return;

    // Only update during lobby
    if (room.state !== 'lobby') return;

    const { lives, timeLimit } = data;

    if (lives !== undefined) {
      const livesNum = parseInt(lives, 10);
      if (!isNaN(livesNum) && livesNum >= 1 && livesNum <= CONSTANTS.MAX_LIVES) {
        room.settings.lives = livesNum;
      }
    }

    if (timeLimit !== undefined) {
      const timeLimitNum = parseInt(timeLimit, 10);
      if (!isNaN(timeLimitNum) &&
          timeLimitNum >= CONSTANTS.MIN_TIME_LIMIT &&
          timeLimitNum <= CONSTANTS.MAX_TIME_LIMIT) {
        room.settings.timeLimit = timeLimitNum;
      }
    }

    this.broadcastLobbyUpdate(room);
  }

  startGame(socket) {
    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    // Only host can start
    if (room.host !== socket.id) {
      return;
    }

    // Must be in lobby
    if (room.state !== 'lobby') {
      return;
    }

    // Need at least MIN_PLAYERS players
    if (room.players.size < CONSTANTS.MIN_PLAYERS) {
      socket.emit('join-error', { message: `Need at least ${CONSTANTS.MIN_PLAYERS} players to start` });
      return;
    }

    const readyCount = Array.from(room.players.values())
      .filter(p => p.id !== room.host && p.ready).length;
    const nonHostCount = room.players.size - 1;

    // All non-host players must be ready
    if (nonHostCount > 0 && readyCount < nonHostCount) {
      socket.emit('join-error', { message: 'All players must be ready' });
      return;
    }

    room.startCountdown();
  }

  handleInput(socket, data) {
    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    room.handleInput(socket.id, data);
  }

  pauseGame(socket) {
    if (!this.checkEventRateLimit(socket.id, 'pause', 1000)) return;

    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    room.pause(socket.id);
  }

  resumeGame(socket) {
    if (!this.checkEventRateLimit(socket.id, 'resume', 1000)) return;

    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    room.resume(socket.id);
  }

  quitGame(socket) {
    if (!this.checkEventRateLimit(socket.id, 'quit', 1000)) return;

    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    this.io.to(room.code).emit('player-quit', {
      playerId: socket.id,
      name: player.name,
    });

    room.removePlayer(socket.id);

    const roomAfterRemove = this.rooms.get(player.roomCode);
    if (!roomAfterRemove) {
      return;
    }

    if (roomAfterRemove.state === 'playing' || roomAfterRemove.state === 'paused') {
      const activePlayers = Array.from(roomAfterRemove.gamePlayers?.values() || [])
        .filter(p => p.connected).length;

      if (activePlayers < CONSTANTS.MIN_PLAYERS) {
        roomAfterRemove.endGame();
      }
    }
  }

  returnToLobby(socket) {
    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    // Only allow return from gameover state
    if (room.state !== 'gameover') return;

    if (!room.players || !(room.players instanceof Map)) {
      console.error(`[GameManager] returnToLobby: room.players is invalid for room ${room.code}`);
      return;
    }

    player.ready = false;

    if (!room.returnToLobbyRequests || !(room.returnToLobbyRequests instanceof Set)) {
      room.returnToLobbyRequests = new Set();
    }

    room.returnToLobbyRequests.add(socket.id);

    if (socket.id === room.host || room.returnToLobbyRequests.size === room.players.size) {
      room.resetToLobby();

      for (const p of room.players.values()) {
        p.ready = false;
      }

      this.broadcastLobbyUpdate(room);
    }
  }

  handleDisconnect(socket) {
    this.cleanupRateLimits(socket.id);

    this.roomCreationCooldown.delete(socket.id);

    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) {
      this.players.delete(socket.id);
      return;
    }

    if (room.state === 'playing' || room.state === 'paused') {
      room.handlePlayerDisconnect(socket.id);
    }

    if (room.inputRateLimiter) {
      room.inputRateLimiter.remove(socket.id);
    }

    room.players.delete(socket.id);
    this.players.delete(socket.id);

    if (room.returnToLobbyRequests) {
      room.returnToLobbyRequests.delete(socket.id);
    }

    if (room.players.size === 0) {
      room.cleanup();
      this.rooms.delete(room.code);
      return;
    }

    if (room.host === socket.id) {
      const newHost = room.players.keys().next().value;
      if (newHost) {
        room.host = newHost;
      }
    }

    if (room.state === 'lobby') {
      this.broadcastLobbyUpdate(room);
    } else {
      this.io.to(room.code).emit('player-quit', {
        playerId: socket.id,
        name: player.name,
      });

      const activePlayers = room.getActivePlayers ? room.getActivePlayers().length : Array.from(room.gamePlayers.values()).filter(p => p.connected).length;
      if (activePlayers < CONSTANTS.MIN_PLAYERS &&
          (room.state === 'playing' || room.state === 'paused')) {
        room.endGame();
      }
    }
  }

  broadcastLobbyUpdate(room) {
    const lobbyPacket = {
      code: room.code,
      host: room.host,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        ready: p.ready,
      })),
      settings: {
        lives: room.settings.lives,
        timeLimit: room.settings.timeLimit,
      },
    };

    this.io.to(room.code).emit('lobby-update', lobbyPacket);
  }
}

module.exports = GameManager;
