const CONSTANTS = require('./constants');
const GameRoom = require('./GameRoom');

/**
 * GameManager handles room management, player tracking, and coordinates
 * between lobby and game states for the LIGHTS OUT game.
 */
class GameManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();      // roomCode -> GameRoom
    this.players = new Map();    // socket.id -> player object
    this.roomCreationCooldown = new Map(); // socket.id -> timestamp (rate limiting)
    this.eventRateLimits = new Map(); // socketId:event -> lastTime (rate limiting for lobby events)
  }

  /**
   * Check if an event is rate limited for a socket
   * @param {string} socketId - The socket ID
   * @param {string} event - The event name
   * @param {number} cooldownMs - Cooldown in milliseconds (default 500ms)
   * @returns {boolean} - true if allowed, false if rate limited
   */
  checkEventRateLimit(socketId, event, cooldownMs = 500) {
    const key = `${socketId}:${event}`;
    const now = Date.now();
    const last = this.eventRateLimits.get(key) || 0;
    if (now - last < cooldownMs) {
      return false; // Rate limited
    }
    this.eventRateLimits.set(key, now);
    return true;
  }

  /**
   * Clean up rate limit entries for a disconnected socket
   * @param {string} socketId - The socket ID to clean up
   */
  cleanupRateLimits(socketId) {
    const prefix = `${socketId}:`;
    for (const key of this.eventRateLimits.keys()) {
      if (key.startsWith(prefix)) {
        this.eventRateLimits.delete(key);
      }
    }
  }

  /**
   * Clean up stale rate limit entries periodically
   * Call this periodically (e.g., every 5 minutes) to clean stale entries
   */
  cleanupStaleRateLimits() {
    const now = Date.now();
    const STALE_THRESHOLD = 300000; // 5 minutes
    for (const [key, timestamp] of this.eventRateLimits) {
      if (now - timestamp >= STALE_THRESHOLD) {
        this.eventRateLimits.delete(key);
      }
    }
  }

  /**
   * Generate a unique 4-letter room code
   */
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excluded I and O to avoid confusion
    let code;
    do {
      code = '';
      for (let i = 0; i < CONSTANTS.ROOM_CODE_LENGTH; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  /**
   * Get the next available player color for a room
   */
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

  /**
   * Check if a name is unique within a room
   */
  isNameUnique(room, name, excludeSocketId = null) {
    for (const [socketId, player] of room.players) {
      if (socketId !== excludeSocketId && player.name.toLowerCase() === name.toLowerCase()) {
        return false;
      }
    }
    return true;
  }

  /**
   * Create a new room with the socket as host
   */
  createRoom(socket, data) {
    // Rate limiting: Check if server is at maximum room capacity
    if (this.rooms.size >= CONSTANTS.MAX_ROOMS) {
      socket.emit('join-error', { message: 'Server is full. Try again later.' });
      return;
    }

    // Rate limiting: Check room creation cooldown
    if (this.roomCreationCooldown.has(socket.id)) {
      socket.emit('join-error', { message: 'Please wait before creating another room' });
      return;
    }

    const { name } = data || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      socket.emit('join-error', { message: 'Please enter a valid name' });
      return;
    }

    const playerName = name.trim().substring(0, 20).replace(/[<>"'&]/g, ''); // Limit name length and sanitize
    const code = this.generateRoomCode();

    // Set room creation cooldown
    this.roomCreationCooldown.set(socket.id, Date.now());
    setTimeout(() => this.roomCreationCooldown.delete(socket.id), CONSTANTS.ROOM_CREATION_COOLDOWN);

    // Create the game room
    const room = new GameRoom(this.io, code, socket.id);
    this.rooms.set(code, room);

    // Create player object
    const player = {
      id: socket.id,
      name: playerName,
      color: CONSTANTS.PLAYER_COLORS[0],
      ready: false,
      roomCode: code,
    };

    // Add player to tracking
    this.players.set(socket.id, player);
    room.players.set(socket.id, player);

    // Join socket.io room for broadcasting
    socket.join(code);

    // Notify client
    socket.emit('room-created', { code });
    this.broadcastLobbyUpdate(room);

    console.log(`Room ${code} created by ${playerName} (${socket.id})`);
  }

  /**
   * Join an existing room
   */
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

    const playerName = name.trim().substring(0, 20).replace(/[<>"'&]/g, ''); // Sanitize

    // Check if room exists
    const room = this.rooms.get(roomCode);
    if (!room) {
      socket.emit('join-error', { message: 'Room not found' });
      return;
    }

    // Check room capacity
    if (room.players.size >= CONSTANTS.MAX_PLAYERS) {
      socket.emit('join-error', { message: 'Room is full' });
      return;
    }

    // Check if game is in progress
    if (room.state !== 'lobby') {
      socket.emit('join-error', { message: 'Game already in progress' });
      return;
    }

    // Check name uniqueness
    if (!this.isNameUnique(room, playerName)) {
      socket.emit('join-error', { message: 'Name already taken in this room' });
      return;
    }

    // Get next available color
    const color = this.getNextColor(room);

    // Create player object
    const player = {
      id: socket.id,
      name: playerName,
      color: color,
      ready: false,
      roomCode: roomCode,
    };

    // Add player to tracking
    this.players.set(socket.id, player);
    room.players.set(socket.id, player);

    // Join socket.io room
    socket.join(roomCode);

    // Notify the joining player directly first (ensures they receive it)
    socket.emit('room-joined', { code: roomCode });

    // Then notify all players in room (including the new player via room broadcast)
    this.broadcastLobbyUpdate(room);

    console.log(`${playerName} (${socket.id}) joined room ${roomCode}`);
  }

  /**
   * Toggle player ready state
   */
  toggleReady(socket) {
    // Rate limit: 500ms cooldown
    if (!this.checkEventRateLimit(socket.id, 'toggle-ready', 500)) return;

    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room || room.state !== 'lobby') return;

    // Host is always "ready" conceptually, but we allow toggle
    player.ready = !player.ready;

    this.broadcastLobbyUpdate(room);
  }

  /**
   * Host kicks a player from the room
   */
  kickPlayer(socket, data) {
    // Rate limit: 500ms cooldown
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

    // Remove from room
    room.players.delete(playerId);
    this.players.delete(playerId);

    // Get the kicked player's socket and remove from socket.io room
    const kickedSocket = this.io.sockets.sockets.get(playerId);
    if (kickedSocket) {
      kickedSocket.leave(room.code);
      // Emit 'kicked' event so client can handle it properly
      kickedSocket.emit('kicked');
    }

    this.broadcastLobbyUpdate(room);

    console.log(`${kickedPlayer.name} was kicked from room ${room.code}`);
  }

  /**
   * Host updates game settings
   */
  updateSettings(socket, data) {
    // Rate limit: 200ms cooldown (faster for UI responsiveness)
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

    // Validate and update lives
    if (lives !== undefined) {
      const livesNum = parseInt(lives, 10);
      if (!isNaN(livesNum) && livesNum >= 1 && livesNum <= CONSTANTS.MAX_LIVES) {
        room.settings.lives = livesNum;
      }
    }

    // Validate and update time limit
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

  /**
   * Host starts the game
   */
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

    // Check if enough players are ready (excluding host)
    const readyCount = Array.from(room.players.values())
      .filter(p => p.id !== room.host && p.ready).length;
    const nonHostCount = room.players.size - 1;

    // All non-host players must be ready
    if (nonHostCount > 0 && readyCount < nonHostCount) {
      socket.emit('join-error', { message: 'All players must be ready' });
      return;
    }

    // Start countdown - use room's countdown which initializes game state
    room.startCountdown();
  }

  /**
   * Handle player input during game
   */
  handleInput(socket, data) {
    const player = this.players.get(socket.id);
    if (!player) {
      console.log('[GameManager] handleInput: player not found for socket', socket.id.substring(0, 8));
      return;
    }

    const room = this.rooms.get(player.roomCode);
    if (!room) {
      console.log('[GameManager] handleInput: room not found for code', player.roomCode);
      return;
    }

    // Forward to GameRoom
    room.handleInput(socket.id, data);
  }

  /**
   * Handle pause request
   */
  pauseGame(socket) {
    // Rate limit: 1000ms cooldown (prevent pause spam)
    if (!this.checkEventRateLimit(socket.id, 'pause', 1000)) return;

    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    room.pause(socket.id);
  }

  /**
   * Handle resume request
   */
  resumeGame(socket) {
    // Rate limit: 1000ms cooldown (prevent resume spam)
    if (!this.checkEventRateLimit(socket.id, 'resume', 1000)) return;

    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    room.resume(socket.id);
  }

  /**
   * Handle player quitting the game
   */
  quitGame(socket) {
    // Rate limit: 1000ms cooldown (prevent quit spam)
    if (!this.checkEventRateLimit(socket.id, 'quit', 1000)) return;

    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    // Notify room that player quit
    this.io.to(room.code).emit('player-quit', {
      playerId: socket.id,
      name: player.name,
    });

    // Remove player from game state but keep in room for potential return
    room.removePlayer(socket.id);

    // HIGH-13: Re-check room existence and state before calling endGame (TOCTOU defense)
    // The room could have been deleted or state changed during removePlayer()
    const roomAfterRemove = this.rooms.get(player.roomCode);
    if (!roomAfterRemove) {
      return; // Room was deleted during removePlayer
    }

    // Check if game should end (not enough players)
    if (roomAfterRemove.state === 'playing' || roomAfterRemove.state === 'paused') {
      const activePlayers = Array.from(roomAfterRemove.gamePlayers?.values() || [])
        .filter(p => p.connected).length;

      if (activePlayers < CONSTANTS.MIN_PLAYERS) {
        roomAfterRemove.endGame();
      }
    }
  }

  /**
   * Return to lobby after game over
   */
  returnToLobby(socket) {
    const player = this.players.get(socket.id);
    if (!player) return;

    const room = this.rooms.get(player.roomCode);
    if (!room) return;

    // Only allow return from gameover state
    if (room.state !== 'gameover') return;

    // Reset player ready state
    player.ready = false;

    // Check if all players have requested return to lobby
    room.returnToLobbyRequests.add(socket.id);

    // If host requests or all remaining players request, return to lobby
    if (socket.id === room.host || room.returnToLobbyRequests.size === room.players.size) {
      room.resetToLobby();

      // Reset all players' ready state
      for (const p of room.players.values()) {
        p.ready = false;
      }

      this.broadcastLobbyUpdate(room);
    }
  }

  /**
   * Handle player disconnect
   */
  handleDisconnect(socket) {
    // Clean up rate limit entries for this socket
    this.cleanupRateLimits(socket.id);

    // LOW-10: Clean up room creation cooldown for this socket
    this.roomCreationCooldown.delete(socket.id);

    const player = this.players.get(socket.id);
    if (!player) {
      console.log(`Unknown player disconnected: ${socket.id}`);
      return;
    }

    const room = this.rooms.get(player.roomCode);
    if (!room) {
      this.players.delete(socket.id);
      return;
    }

    console.log(`${player.name} (${socket.id}) disconnected from room ${room.code}`);

    // HIGH-14: Handle in-game disconnect BEFORE removing player from maps
    // This ensures handlePlayerDisconnect has access to player data for proper state sync
    if (room.state === 'playing' || room.state === 'paused') {
      room.handlePlayerDisconnect(socket.id);
    }

    // LOW-18: Clean up input rate tracking in GameRoom (for lobby disconnects too)
    if (room.inputRateTracking) {
      room.inputRateTracking.delete(socket.id);
    }

    // Remove player from room (after handling disconnect)
    room.players.delete(socket.id);
    this.players.delete(socket.id);

    // Clean up returnToLobbyRequests
    if (room.returnToLobbyRequests) {
      room.returnToLobbyRequests.delete(socket.id);
    }

    // If room is empty, delete it
    if (room.players.size === 0) {
      room.cleanup();
      this.rooms.delete(room.code);
      console.log(`Room ${room.code} deleted (empty)`);
      return;
    }

    // If host left, assign new host
    if (room.host === socket.id) {
      // Get first remaining player as new host
      const newHost = room.players.keys().next().value;
      if (newHost) {
        room.host = newHost;
        console.log(`New host for room ${room.code}: ${room.players.get(newHost).name}`);
      }
    }

    // Notify remaining players
    if (room.state === 'lobby') {
      this.broadcastLobbyUpdate(room);
    } else {
      // Notify about disconnect during game
      this.io.to(room.code).emit('player-quit', {
        playerId: socket.id,
        name: player.name,
      });

      // Check if game should end
      const activePlayers = room.getActivePlayers ? room.getActivePlayers().length : Array.from(room.gamePlayers.values()).filter(p => p.connected).length;
      if (activePlayers < CONSTANTS.MIN_PLAYERS &&
          (room.state === 'playing' || room.state === 'paused')) {
        room.endGame();
      }
    }
  }

  /**
   * Broadcast lobby state to all players in the room
   */
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
