// Socket.io wrapper class for game networking
export class Network {
  constructor(game) {
    console.log('[Network] Constructor called');
    this.game = game;
    this.socket = null;
    this.connected = false;
    this.inputSequence = 0;
    this._inputSentCount = 0;
  }

  // Connect to the game server
  connect() {
    console.log('[Network] connect() called');
    if (this.socket) {
      console.log('[Network] Socket already exists');
      return;
    }

    this.socket = io();
    console.log('[Network] Socket.io instance created');

    this.socket.on('connect', () => {
      this.connected = true;
      console.log('[Network] Connected to server:', this.socket.id);
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      console.log('Disconnected from server');
      this.game.onDisconnect();
    });

    // Set up all event handlers
    this.setupHandlers();
  }

  setupHandlers() {
    // Room creation response
    this.socket.on('room-created', (data) => {
      console.log('Room created:', data.code);
      this.game.myId = this.socket.id;
      this.game.roomCode = data.code;
      this.game.onRoomCreated(data);
    });

    // Join error
    this.socket.on('join-error', (data) => {
      console.log('Join error:', data.message);
      this.game.onJoinError(data.message);
    });

    // Lobby state update
    this.socket.on('lobby-update', (data) => {
      console.log('Lobby update:', data);
      this.game.myId = this.socket.id;
      this.game.roomCode = data.code;
      this.game.onLobbyUpdate(data);
    });

    // Player was kicked
    this.socket.on('kicked', () => {
      console.log('You were kicked from the room');
      this.game.onKicked();
    });

    // Countdown before game starts
    this.socket.on('countdown', (data) => {
      console.log('Countdown:', data.count);
      this.game.onCountdown(data.count);
    });

    // Game has started
    this.socket.on('game-start', (data) => {
      console.log('Game starting');
      this.game.onGameStart(data);
    });

    // Game state update (20Hz during gameplay)
    this.socket.on('state', (data) => {
      this.game.onServerState(data);
    });

    // Game paused
    this.socket.on('game-paused', (data) => {
      console.log('Game paused by:', data?.by);
      this.game.onGamePaused(data?.by);
    });

    // Game resumed
    this.socket.on('game-resumed', (data) => {
      console.log('Game resumed by:', data?.by);
      this.game.onGameResumed(data?.by);
    });

    // Player quit
    this.socket.on('player-quit', (data) => {
      console.log('Player quit:', data.name);
      this.game.onPlayerQuit(data);
    });

    // Game over
    this.socket.on('game-over', (data) => {
      console.log('Game over, winner:', data.winner);
      this.game.onGameOver(data);
    });
  }

  // --- Outgoing Events ---

  // Create a new room (host)
  createRoom(name) {
    if (!this.connected) return;
    this.socket.emit('create-room', { name });
  }

  // Join an existing room
  joinRoom(code, name) {
    if (!this.connected) return;
    this.socket.emit('join-room', { code: code.toUpperCase(), name });
  }

  // Toggle ready state in lobby
  toggleReady() {
    if (!this.connected) return;
    this.socket.emit('toggle-ready');
  }

  // Kick a player (host only)
  kickPlayer(playerId) {
    if (!this.connected) return;
    this.socket.emit('kick-player', { playerId });
  }

  // Update game settings (host only)
  updateSettings(settings) {
    if (!this.connected) return;
    this.socket.emit('update-settings', settings);
  }

  // Start the game (host only)
  startGame() {
    if (!this.connected) return;
    this.socket.emit('start-game');
  }

  // Send player input to server
  sendInput(input) {
    if (!this.connected) {
      if (this._inputSentCount === 0) {
        console.warn('[Network] sendInput called but not connected');
      }
      return;
    }

    const packet = {
      seq: this.inputSequence++,
      input: {
        up: input.up,
        down: input.down,
        left: input.left,
        right: input.right,
        sprint: input.sprint,
        throw: input.throw,
        flashlight: input.flashlight,
      },
      facing: input.facing,
    };

    this._inputSentCount++;
    if (this._inputSentCount === 1 || this._inputSentCount % 60 === 0) {
      const hasMovement = input.up || input.down || input.left || input.right;
      console.log('[Network] sendInput #' + this._inputSentCount + ':', {
        hasMovement,
        facing: input.facing?.toFixed(2),
        connected: this.connected
      });
    }

    this.socket.emit('input', packet);
  }

  // Request game pause
  pause() {
    if (!this.connected) return;
    this.socket.emit('pause');
  }

  // Request game resume
  resume() {
    if (!this.connected) return;
    this.socket.emit('resume');
  }

  // Quit the current game
  quit() {
    if (!this.connected) return;
    this.socket.emit('quit');
  }

  // Return to lobby after game over
  returnToLobby() {
    if (!this.connected) return;
    this.socket.emit('return-lobby');
  }

  // Get current socket ID
  getId() {
    return this.socket ? this.socket.id : null;
  }

  // Check if connected
  isConnected() {
    return this.connected;
  }
}
