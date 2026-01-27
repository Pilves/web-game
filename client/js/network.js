// Socket.io wrapper class for game networking
export class Network {
  constructor(game) {
    console.log('[Network] Constructor called');
    this.game = game;
    this.socket = null;
    this.connected = false;
    this.inputSequence = 0;
    this._inputSentCount = 0;

    // Store for reconnection
    this.roomCode = null;
    this.playerName = null;

    // Track event handlers for cleanup
    this.handlers = {};

    // Track if handlers are set up (to prevent duplicates)
    this.handlersSetup = false;

    // Track if we're currently rejoining (to prevent user interaction during rejoin)
    this.rejoining = false;

    // Guard flag to prevent race conditions during handler removal
    this._removingHandlers = false;
  }

  // Connect to the game server
  connect() {
    console.log('[Network] connect() called');
    if (this.socket) {
      console.log('[Network] Socket already exists');
      return;
    }

    // Detect if running under a subpath (e.g., /game/) and configure socket.io accordingly
    const basePath = new URL(document.baseURI).pathname.replace(/\/$/, '');
    const socketPath = basePath ? `${basePath}/socket.io` : '/socket.io';
    this.socket = io({ path: socketPath });
    console.log('[Network] Socket.io instance created with path:', socketPath);

    // Set up lifecycle handlers (tracked in this.handlers for proper cleanup)
    this.handlers['connect'] = () => {
      this.connected = true;
      console.log('[Network] Connected to server:', this.socket.id);
    };
    this.socket.on('connect', this.handlers['connect']);

    this.handlers['disconnect'] = () => {
      console.log('[Network] Disconnected from server');
      this.connected = false;
      // Don't null socket - allow reconnection
      this.game.onDisconnect();
    };
    this.socket.on('disconnect', this.handlers['disconnect']);

    // Handle reconnection
    this.handlers['reconnect'] = async () => {
      console.log('[Network] Reconnected');
      this.connected = true;
      this.inputSequence = 0;  // Reset sequence on reconnect

      // Clean up old game handlers and set up new ones to prevent duplicates (HIGH-1 fix)
      // Note: We only remove game handlers, not lifecycle handlers (connect/disconnect/reconnect)
      this.removeGameHandlers();
      this.setupHandlers();

      // Notify game of reconnection for state validation
      this.game.onReconnect();

      // Try to rejoin previous room if we have roomCode and playerName
      // and game has validated that state can be restored
      if (this.roomCode && this.playerName && this.game.validateReconnectState()) {
        console.log('[Network] Attempting to rejoin room:', this.roomCode);
        // Prevent user interaction during rejoin (MED-14 fix)
        this.rejoining = true;
        try {
          this.joinRoom(this.roomCode, this.playerName);
        } catch (error) {
          console.error('[Network] Failed to rejoin room:', error);
          this.game.ui?.showError('Failed to rejoin room after reconnection');
          // Clear stored state on failure
          this.roomCode = null;
          this.playerName = null;
        } finally {
          this.rejoining = false;
        }
      } else {
        console.log('[Network] No valid room state to restore');
      }
    };
    this.socket.on('reconnect', this.handlers['reconnect']);

    // Set up all game event handlers
    this.setupHandlers();
  }

  // Lifecycle handler names (connect/disconnect/reconnect) - these persist across reconnections
  static LIFECYCLE_HANDLERS = ['connect', 'disconnect', 'reconnect'];

  // Remove game event handlers only (used before reconnect to prevent duplicates)
  // Lifecycle handlers (connect/disconnect/reconnect) are NOT removed - they persist
  removeGameHandlers() {
    // Guard against race condition: if reconnect fires while removing handlers,
    // prevent duplicate handler additions by checking/setting the guard flag
    if (this._removingHandlers) {
      console.log('[Network] removeGameHandlers already in progress, skipping');
      return;
    }

    if (this.socket && this.handlersSetup) {
      this._removingHandlers = true;
      try {
        for (const [event, handler] of Object.entries(this.handlers)) {
          // Skip lifecycle handlers - they should persist
          if (Network.LIFECYCLE_HANDLERS.includes(event)) continue;
          this.socket.off(event, handler);
          delete this.handlers[event];
        }
        this.handlersSetup = false;
      } finally {
        this._removingHandlers = false;
      }
    }
  }

  // Remove ALL event handlers including lifecycle handlers (used by destroy())
  removeAllHandlers() {
    if (this.socket) {
      for (const [event, handler] of Object.entries(this.handlers)) {
        this.socket.off(event, handler);
      }
      this.handlers = {};
      this.handlersSetup = false;
    }
  }

  setupHandlers() {
    // Prevent duplicate handlers (HIGH-1 fix)
    if (this.handlersSetup) {
      console.log('[Network] Handlers already set up, skipping');
      return;
    }

    // Room creation response
    this.handlers['room-created'] = (data) => {
      // MED-12 fix: validate payload before accessing properties
      if (!data || !data.code) {
        console.warn('[Network] Invalid room-created data received:', data);
        return;
      }
      console.log('Room created:', data.code);
      this.roomCode = data.code;
      this.game.myId = this.socket.id;
      this.game.roomCode = data.code;
      this.game.onRoomCreated(data);
    };
    this.socket.on('room-created', this.handlers['room-created']);

    // Join error
    this.handlers['join-error'] = (data) => {
      // MED-12 fix: validate payload before accessing properties
      const message = data?.message ?? 'Unknown error';
      console.log('Join error:', message);
      this.game.onJoinError(message);
    };
    this.socket.on('join-error', this.handlers['join-error']);

    // Room joined confirmation (sent directly to joining player)
    this.handlers['room-joined'] = (data) => {
      // MED-12 fix: validate payload before accessing properties
      if (!data || !data.code) {
        console.warn('[Network] Invalid room-joined data received:', data);
        return;
      }
      console.log('Room joined:', data.code);
      this.roomCode = data.code;
      this.game.myId = this.socket.id;
      this.game.roomCode = data.code;
      // Transition to lobby screen immediately
      if (this.game.state === 'menu') {
        this.game.ui.showScreen('lobby');
        this.game.state = 'lobby';
      }
    };
    this.socket.on('room-joined', this.handlers['room-joined']);

    // Lobby state update
    this.handlers['lobby-update'] = (data) => {
      // MED-12 fix: validate payload before accessing properties
      if (!data) {
        console.warn('[Network] Invalid lobby-update data received');
        return;
      }
      console.log('Lobby update:', data);
      this.game.myId = this.socket.id;
      this.game.roomCode = data.code;
      this.game.onLobbyUpdate(data);
    };
    this.socket.on('lobby-update', this.handlers['lobby-update']);

    // Player was kicked
    this.handlers['kicked'] = () => {
      console.log('You were kicked from the room');
      this.game.onKicked();
    };
    this.socket.on('kicked', this.handlers['kicked']);

    // Countdown before game starts
    this.handlers['countdown'] = (data) => {
      // MED-12 fix: validate payload before accessing properties
      if (!data || typeof data.count === 'undefined') {
        console.warn('[Network] Invalid countdown data received:', data);
        return;
      }
      console.log('Countdown:', data.count);
      this.game.onCountdown(data.count);
    };
    this.socket.on('countdown', this.handlers['countdown']);

    // Countdown cancelled (not enough players)
    this.handlers['countdown-cancelled'] = (data) => {
      // MED-12 fix: validate payload before accessing properties
      const reason = data?.reason ?? 'Unknown reason';
      console.log('Countdown cancelled:', reason);
      this.game.onCountdownCancelled(reason);
    };
    this.socket.on('countdown-cancelled', this.handlers['countdown-cancelled']);

    // Game has started
    this.handlers['game-start'] = (data) => {
      // MED-12 fix: validate payload before accessing properties
      if (!data) {
        console.warn('[Network] Invalid game-start data received');
        return;
      }
      console.log('Game starting');
      this.game.onGameStart(data);
    };
    this.socket.on('game-start', this.handlers['game-start']);

    // Game state update (20Hz during gameplay)
    this.handlers['state'] = (data) => {
      // MED-12 fix: validate payload (state updates are frequent, so minimal logging)
      if (!data) return;
      this.game.onServerState(data);
    };
    this.socket.on('state', this.handlers['state']);

    // Game paused
    this.handlers['game-paused'] = (data) => {
      console.log('Game paused by:', data?.by);
      this.game.onGamePaused(data?.by);
    };
    this.socket.on('game-paused', this.handlers['game-paused']);

    // Game resumed
    this.handlers['game-resumed'] = (data) => {
      console.log('Game resumed by:', data?.by);
      this.game.onGameResumed(data?.by);
    };
    this.socket.on('game-resumed', this.handlers['game-resumed']);

    // Player quit
    this.handlers['player-quit'] = (data) => {
      // MED-12 fix: validate payload before accessing properties
      if (!data) {
        console.warn('[Network] Invalid player-quit data received');
        return;
      }
      console.log('Player quit:', data.name ?? 'Unknown');
      this.game.onPlayerQuit(data);
    };
    this.socket.on('player-quit', this.handlers['player-quit']);

    // Game over
    this.handlers['game-over'] = (data) => {
      // MED-12 fix: validate payload before accessing properties
      if (!data) {
        console.warn('[Network] Invalid game-over data received');
        return;
      }
      console.log('Game over, winner:', data.winner ?? 'Unknown');
      this.game.onGameOver(data);
    };
    this.socket.on('game-over', this.handlers['game-over']);

    // Sudden death started
    this.handlers['sudden-death'] = () => {
      console.log('Sudden death started');
      this.game.onSuddenDeath();
    };
    this.socket.on('sudden-death', this.handlers['sudden-death']);

    // Mark handlers as set up (HIGH-1 fix)
    this.handlersSetup = true;
  }

  // Clean up all handlers and disconnect
  destroy() {
    if (this.socket) {
      // Remove ALL handlers including lifecycle handlers (connect/disconnect/reconnect)
      this.removeAllHandlers();
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.roomCode = null;
    this.playerName = null;
    this.rejoining = false;
  }

  // --- Outgoing Events ---

  // Create a new room (host)
  createRoom(name) {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    // MED-14 fix: prevent user interaction during rejoin
    if (this.rejoining) {
      this.game.ui?.showError('Reconnecting, please wait...');
      return;
    }
    this.playerName = name;
    this.socket.emit('create-room', { name });
  }

  // Join an existing room
  joinRoom(code, name) {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    // Validate code before calling toUpperCase
    if (code == null || typeof code !== 'string') {
      this.game.ui?.showError('Invalid room code');
      return;
    }
    this.roomCode = code.toUpperCase();
    this.playerName = name;
    this.socket.emit('join-room', { code: this.roomCode, name });
  }

  // Toggle ready state in lobby
  toggleReady() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    // MED-14 fix: prevent user interaction during rejoin
    if (this.rejoining) {
      this.game.ui?.showError('Reconnecting, please wait...');
      return;
    }
    this.socket.emit('toggle-ready');
  }

  // Kick a player (host only)
  kickPlayer(playerId) {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    // MED-14 fix: prevent user interaction during rejoin
    if (this.rejoining) {
      this.game.ui?.showError('Reconnecting, please wait...');
      return;
    }
    this.socket.emit('kick-player', { playerId });
  }

  // Update game settings (host only)
  updateSettings(settings) {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    // MED-14 fix: prevent user interaction during rejoin
    if (this.rejoining) {
      this.game.ui?.showError('Reconnecting, please wait...');
      return;
    }
    this.socket.emit('update-settings', settings);
  }

  // Start the game (host only)
  startGame() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    // MED-14 fix: prevent user interaction during rejoin
    if (this.rejoining) {
      this.game.ui?.showError('Reconnecting, please wait...');
      return;
    }
    this.socket.emit('start-game');
  }

  // Send player input to server
  sendInput(input) {
    if (!this.connected || !this.socket) {
      if (this._inputSentCount === 0) {
        console.warn('[Network] sendInput called but not connected');
      }
      return;
    }

    // Validate input object
    if (input == null || typeof input !== 'object') {
      console.warn('[Network] sendInput called with invalid input:', input);
      return;
    }

    // Safeguard against sequence number overflow - reset when approaching MAX_SAFE_INTEGER
    // This prevents loss of precision after ~9 quadrillion increments
    if (this.inputSequence > Number.MAX_SAFE_INTEGER - 1000) {
      console.log('[Network] Input sequence approaching MAX_SAFE_INTEGER, resetting to 0');
      this.inputSequence = 0;
    }

    const packet = {
      seq: this.inputSequence++,
      input: {
        up: !!input.up,
        down: !!input.down,
        left: !!input.left,
        right: !!input.right,
        sprint: !!input.sprint,
        throw: !!input.throw,
        flashlight: !!input.flashlight,
      },
      facing: input.facing ?? 0,
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
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    this.socket.emit('pause');
  }

  // Request game resume
  resume() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    this.socket.emit('resume');
  }

  // Quit the current game
  quit() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    this.socket.emit('quit');
  }

  // Return to lobby after game over
  returnToLobby() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
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
