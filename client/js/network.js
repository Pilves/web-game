// Socket.io wrapper class for game networking
export class Network {
  constructor(game) {
    this.game = game;
    this.socket = null;
    this.connected = false;
    this.inputSequence = 0;

    this.roomCode = null;
    this.playerName = null;
    this.handlers = {};
    this.handlersSetup = false;
    this.rejoining = false;
    this._removingHandlers = false;
  }

  connect() {
    if (this.socket) return;

    const basePath = new URL(document.baseURI).pathname.replace(/\/$/, '');
    const socketPath = basePath ? `${basePath}/socket.io` : '/socket.io';
    this.socket = io({ path: socketPath });

    this.handlers['connect'] = () => {
      this.connected = true;
    };
    this.socket.on('connect', this.handlers['connect']);

    this.handlers['disconnect'] = () => {
      this.connected = false;
      this.game.onDisconnect();
    };
    this.socket.on('disconnect', this.handlers['disconnect']);

    this.handlers['reconnect'] = async () => {
      this.connected = true;
      this.inputSequence = 0;

      this.removeGameHandlers();
      this.setupHandlers();

      this.game.onReconnect();

      if (this.roomCode && this.playerName && this.game.validateReconnectState()) {
        this.rejoining = true;
        try {
          this.joinRoom(this.roomCode, this.playerName);
        } catch (error) {
          console.error('[Network] Failed to rejoin room:', error);
          this.game.ui?.showError('Failed to rejoin room after reconnection');
          this.roomCode = null;
          this.playerName = null;
        } finally {
          this.rejoining = false;
        }
      }
    };
    this.socket.on('reconnect', this.handlers['reconnect']);

    this.setupHandlers();
  }

  static LIFECYCLE_HANDLERS = ['connect', 'disconnect', 'reconnect'];

  removeGameHandlers() {
    if (this._removingHandlers) return;

    if (this.socket && this.handlersSetup) {
      this._removingHandlers = true;
      try {
        for (const [event, handler] of Object.entries(this.handlers)) {
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
    if (this.handlersSetup) return;

    this.handlers['room-created'] = (data) => {
      if (!data || !data.code) {
        console.warn('[Network] Invalid room-created data received:', data);
        return;
      }
      this.roomCode = data.code;
      this.game.myId = this.socket.id;
      this.game.roomCode = data.code;
      this.game.onRoomCreated(data);
    };
    this.socket.on('room-created', this.handlers['room-created']);

    this.handlers['join-error'] = (data) => {
      const message = data?.message ?? 'Unknown error';
      this.game.onJoinError(message);
    };
    this.socket.on('join-error', this.handlers['join-error']);

    this.handlers['room-joined'] = (data) => {
      if (!data || !data.code) {
        console.warn('[Network] Invalid room-joined data received:', data);
        return;
      }
      this.roomCode = data.code;
      this.game.myId = this.socket.id;
      this.game.roomCode = data.code;
      if (this.game.state === 'menu') {
        this.game.ui.showScreen('lobby');
        this.game.state = 'lobby';
      }
    };
    this.socket.on('room-joined', this.handlers['room-joined']);

    this.handlers['lobby-update'] = (data) => {
      if (!data) {
        console.warn('[Network] Invalid lobby-update data received');
        return;
      }
      this.game.myId = this.socket.id;
      this.game.roomCode = data.code;
      this.game.onLobbyUpdate(data);
    };
    this.socket.on('lobby-update', this.handlers['lobby-update']);

    this.handlers['kicked'] = () => {
      this.game.onKicked();
    };
    this.socket.on('kicked', this.handlers['kicked']);

    this.handlers['countdown'] = (data) => {
      if (!data || typeof data.count === 'undefined') {
        console.warn('[Network] Invalid countdown data received:', data);
        return;
      }
      this.game.onCountdown(data.count);
    };
    this.socket.on('countdown', this.handlers['countdown']);

    this.handlers['countdown-cancelled'] = (data) => {
      const reason = data?.reason ?? 'Unknown reason';
      this.game.onCountdownCancelled(reason);
    };
    this.socket.on('countdown-cancelled', this.handlers['countdown-cancelled']);

    this.handlers['game-start'] = (data) => {
      if (!data) {
        console.warn('[Network] Invalid game-start data received');
        return;
      }
      this.game.onGameStart(data);
    };
    this.socket.on('game-start', this.handlers['game-start']);

    this.handlers['state'] = (data) => {
      if (!data) return;
      this.game.onServerState(data);
    };
    this.socket.on('state', this.handlers['state']);

    this.handlers['game-paused'] = (data) => {
      this.game.onGamePaused(data?.by);
    };
    this.socket.on('game-paused', this.handlers['game-paused']);

    this.handlers['game-resumed'] = (data) => {
      this.game.onGameResumed(data);
    };
    this.socket.on('game-resumed', this.handlers['game-resumed']);

    this.handlers['player-quit'] = (data) => {
      if (!data) {
        console.warn('[Network] Invalid player-quit data received');
        return;
      }
      this.game.onPlayerQuit(data);
    };
    this.socket.on('player-quit', this.handlers['player-quit']);

    this.handlers['game-over'] = (data) => {
      if (!data) {
        console.warn('[Network] Invalid game-over data received');
        return;
      }
      this.game.onGameOver(data);
    };
    this.socket.on('game-over', this.handlers['game-over']);

    this.handlers['sudden-death'] = () => {
      this.game.onSuddenDeath();
    };
    this.socket.on('sudden-death', this.handlers['sudden-death']);
    this.handlers['auto-return-lobby'] = () => {
      if (this.game.autoReturnInterval) {
        clearInterval(this.game.autoReturnInterval);
        this.game.autoReturnInterval = null;
      }
      this.game.onReturnToLobby();
    };
    this.socket.on('auto-return-lobby', this.handlers['auto-return-lobby']);

    this.handlersSetup = true;
  }

  destroy() {
    if (this.socket) {
      this.removeAllHandlers();
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.roomCode = null;
    this.playerName = null;
    this.rejoining = false;
  }

  createRoom(name) {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    if (this.rejoining) {
      this.game.ui?.showError('Reconnecting, please wait...');
      return;
    }
    this.playerName = name;
    this.socket.emit('create-room', { name });
  }

  joinRoom(code, name) {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    if (code == null || typeof code !== 'string') {
      this.game.ui?.showError('Invalid room code');
      return;
    }
    this.roomCode = code.toUpperCase();
    this.playerName = name;
    this.socket.emit('join-room', { code: this.roomCode, name });
  }

  toggleReady() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    if (this.rejoining) {
      this.game.ui?.showError('Reconnecting, please wait...');
      return;
    }
    this.socket.emit('toggle-ready');
  }

  kickPlayer(playerId) {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    if (this.rejoining) {
      this.game.ui?.showError('Reconnecting, please wait...');
      return;
    }
    this.socket.emit('kick-player', { playerId });
  }

  updateSettings(settings) {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    if (this.rejoining) {
      this.game.ui?.showError('Reconnecting, please wait...');
      return;
    }
    this.socket.emit('update-settings', settings);
  }

  startGame() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    if (this.rejoining) {
      this.game.ui?.showError('Reconnecting, please wait...');
      return;
    }
    this.socket.emit('start-game');
  }

  sendInput(input) {
    if (!this.connected || !this.socket) {
      if (this._inputSentCount === 0) {
        console.warn('[Network] sendInput called but not connected');
      }
      return;
    }

    if (input == null || typeof input !== 'object') {
      console.warn('[Network] sendInput called with invalid input:', input);
      return;
    }

    if (this.inputSequence > Number.MAX_SAFE_INTEGER - 1000) {
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

    this.socket.emit('input', packet);
  }

  pause() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    this.socket.emit('pause');
  }

  resume() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    this.socket.emit('resume');
  }

  quit() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    this.socket.emit('quit');
  }

  returnToLobby() {
    if (!this.connected || !this.socket) {
      this.game.ui?.showError('Not connected to server');
      return;
    }
    this.socket.emit('return-lobby');
  }

  getId() {
    return this.socket ? this.socket.id : null;
  }

  isConnected() {
    return this.connected;
  }
}
