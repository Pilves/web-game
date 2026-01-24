// Main Game class that orchestrates everything
import { Network } from './network.js';
import { Input } from './input.js';
import { Renderer } from './renderer.js';
import { Audio, audio } from './audio.js';
import { Effects, effects } from './effects.js';
import { UI } from './ui.js';
import { Vision } from './vision.js';
import { CONFIG, controls } from './config.js';
import { ControlsManager } from './config.js';

class Game {
  constructor() {
    console.log('[Game] Constructor called');

    // Initialize all subsystems
    this.network = new Network(this);
    this.input = new Input(this);
    this.renderer = null; // Initialized after DOM ready
    this.audio = audio;
    this.effects = effects;
    this.ui = null; // Initialized after DOM ready
    this.vision = null; // Initialized after DOM ready

    // Game state: 'menu', 'lobby', 'playing', 'paused', 'gameover'
    this.state = 'menu';

    // Debug frame counter
    this._debugFrameCount = 0;

    // Player identification
    this.myId = null;
    this.roomCode = null;

    // Server state for interpolation
    this.serverState = null;
    this.prevServerState = null;
    this.stateTime = 0;

    // Local player for client-side prediction
    this.localPlayer = null;

    // Lobby data
    this.lobbyData = null;
    this.isHost = false;

    // Timing
    this.lastFrameTime = 0;
    this.running = false;

    // Audio context resume flag
    this.audioInitialized = false;
  }

  // Start the game
  start() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    console.log('[Game] init() called');

    // Initialize subsystems that need DOM
    this.effects.init();
    this.renderer = new Renderer(this);
    this.ui = new UI(this);
    this.vision = new Vision(this);

    console.log('[Game] Subsystems initialized:', {
      renderer: !!this.renderer,
      ui: !!this.ui,
      vision: !!this.vision,
      arena: !!document.getElementById('arena')
    });

    // Connect to server
    this.network.connect();

    // Set up UI event listeners
    this.setupUIListeners();

    // Show menu screen
    this.showScreen('menu');

    // Start game loop
    this.running = true;
    console.log('[Game] Starting game loop');
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  // Main game loop
  gameLoop(timestamp) {
    if (!this.running) return;

    // Calculate delta time in seconds
    const dt = this.lastFrameTime ? (timestamp - this.lastFrameTime) / 1000 : 0;
    this.lastFrameTime = timestamp;

    // Cap dt to prevent large jumps
    const cappedDt = Math.min(dt, 0.1);

    // Debug log every 60 frames (roughly 1 second)
    this._debugFrameCount++;
    const shouldLog = this._debugFrameCount % 60 === 0;

    if (this.state === 'playing') {
      // Update interpolation timer
      this.stateTime += cappedDt * 1000;

      // Poll input and send to server
      const input = this.input.getState();
      this.network.sendInput(input);

      if (shouldLog) {
        console.log('[Game] Playing state - Input:', {
          up: input.up, down: input.down, left: input.left, right: input.right,
          facing: input.facing?.toFixed(2),
          hasLocalPlayer: !!this.localPlayer,
          hasServerState: !!this.serverState,
          localPlayerPos: this.localPlayer ? `(${this.localPlayer.x?.toFixed(0)}, ${this.localPlayer.y?.toFixed(0)})` : 'N/A'
        });
      }

      // Predict local player movement
      this.predictLocalPlayer(input, cappedDt);

      // Render game state (if renderer is available)
      if (this.renderer) {
        this.renderer.render(
          this.prevServerState,
          this.serverState,
          this.stateTime,
          this.localPlayer
        );
      }
    } else if (shouldLog && this.state !== 'menu') {
      console.log('[Game] Current state:', this.state, '| myId:', this.myId);
    }

    requestAnimationFrame((t) => this.gameLoop(t));
  }

  // Handle incoming server state
  onServerState(state) {
    // Debug: log first state and every 20th after
    if (!this._stateCount) this._stateCount = 0;
    this._stateCount++;
    if (this._stateCount === 1 || this._stateCount % 20 === 0) {
      console.log('[Game] onServerState #' + this._stateCount + ':', {
        gameState: state.s,
        playerCount: state.p?.length,
        players: state.p?.map(p => ({ id: p[0].substring(0, 8), x: p[1], y: p[2] })),
        projectiles: state.j?.length || 0,
        events: state.e?.length || 0,
        myId: this.myId?.substring(0, 8)
      });
    }

    // Store previous state for interpolation
    this.prevServerState = this.serverState;
    this.serverState = state;
    this.stateTime = 0;

    // Reconcile local player position with server
    this.reconcileLocalPlayer(state);

    // Process events (hits, deaths, sounds)
    if (state.e && state.e.length > 0) {
      for (const event of state.e) {
        this.handleEvent(event);
      }
    }

    // Update HUD
    this.updateHUD(state);
  }

  // Handle game events from server
  handleEvent(event) {
    const [type, ...data] = event;

    switch (type) {
      case 'hit': {
        // [victimId, attackerId]
        const victimId = data[0];
        const victim = this.findPlayerInState(this.serverState, victimId);
        if (victim) {
          this.effects.showImpactFlash(victim.x, victim.y);
          this.effects.triggerScreenShake();

          // Play hit sound with position
          if (this.localPlayer) {
            this.audio.playPositional('hit-player', victim.x, victim.y,
              this.localPlayer.x, this.localPlayer.y);
          }
        }
        break;
      }

      case 'death': {
        // [playerId]
        const playerId = data[0];
        const player = this.findPlayerInState(this.serverState, playerId);
        if (player) {
          // Play death sound
          if (this.localPlayer) {
            this.audio.playPositional('death', player.x, player.y,
              this.localPlayer.x, this.localPlayer.y);
          }
        }
        break;
      }

      case 'throw': {
        // [playerId]
        const playerId = data[0];
        const player = this.findPlayerInState(this.serverState, playerId);
        if (player) {
          this.effects.triggerMuzzleFlash();

          if (playerId === this.myId) {
            this.audio.play('throw', 0.8);
          } else if (this.localPlayer) {
            this.audio.playPositional('throw', player.x, player.y,
              this.localPlayer.x, this.localPlayer.y, 0.8);
          }
        }
        break;
      }

      case 'pickup': {
        // [playerId, x, y]
        const playerId = data[0];
        if (playerId === this.myId) {
          this.audio.play('pickup');
        } else if (this.localPlayer) {
          this.audio.playPositional('pickup', data[1], data[2],
            this.localPlayer.x, this.localPlayer.y);
        }
        break;
      }

      case 'sound': {
        // [soundType, x, y]
        const [soundType, x, y] = data;
        this.effects.showSoundRipple(x, y, soundType);

        if (this.localPlayer) {
          this.audio.playPositional(soundType, x, y,
            this.localPlayer.x, this.localPlayer.y);
        }
        break;
      }

      case 'flashlight': {
        // [playerId, on]
        const playerId = data[0];
        if (playerId === this.myId) {
          this.audio.play('flashlight', 0.5);
        }
        break;
      }
    }
  }

  // Find player data in server state by ID
  findPlayerInState(state, playerId) {
    if (!state || !state.p) return null;

    const playerData = state.p.find(p => p[0] === playerId);
    if (!playerData) return null;

    // Return object with named properties
    return {
      id: playerData[0],
      x: playerData[1],
      y: playerData[2],
      facing: playerData[3],
      flashlight: playerData[4],
      hearts: playerData[5],
      hasAmmo: playerData[6],
      stunned: playerData[7],
      invincible: playerData[8],
    };
  }

  // Predict local player movement (client-side prediction)
  predictLocalPlayer(input, dt) {
    if (!this.localPlayer) return;

    // Don't predict if stunned
    if (this.localPlayer.stunned) return;

    // Calculate speed based on sprint
    const speed = input.sprint ? CONFIG.PLAYER_SPRINT_SPEED : CONFIG.PLAYER_SPEED;

    // Calculate velocity from input
    let vx = 0;
    let vy = 0;

    if (input.up) vy -= 1;
    if (input.down) vy += 1;
    if (input.left) vx -= 1;
    if (input.right) vx += 1;

    // Normalize diagonal movement
    const length = Math.hypot(vx, vy);
    if (length > 0) {
      vx = (vx / length) * speed;
      vy = (vy / length) * speed;
    }

    // Apply velocity
    this.localPlayer.x += vx * dt;
    this.localPlayer.y += vy * dt;

    // Update facing direction
    this.localPlayer.facing = input.facing;

    // Clamp to arena bounds
    const halfSize = CONFIG.PLAYER_SIZE / 2;
    this.localPlayer.x = Math.max(halfSize, Math.min(CONFIG.ARENA_WIDTH - halfSize, this.localPlayer.x));
    this.localPlayer.y = Math.max(halfSize, Math.min(CONFIG.ARENA_HEIGHT - halfSize, this.localPlayer.y));

    // Simple obstacle collision
    for (const obstacle of CONFIG.OBSTACLES) {
      this.resolveCollision(this.localPlayer, obstacle);
    }
  }

  // Simple AABB collision resolution
  resolveCollision(player, obstacle) {
    const halfSize = CONFIG.PLAYER_SIZE / 2;
    const playerRect = {
      left: player.x - halfSize,
      right: player.x + halfSize,
      top: player.y - halfSize,
      bottom: player.y + halfSize,
    };

    const obstRect = {
      left: obstacle.x,
      right: obstacle.x + obstacle.width,
      top: obstacle.y,
      bottom: obstacle.y + obstacle.height,
    };

    // Check for overlap
    if (playerRect.right > obstRect.left &&
        playerRect.left < obstRect.right &&
        playerRect.bottom > obstRect.top &&
        playerRect.top < obstRect.bottom) {

      // Calculate overlap on each axis
      const overlapLeft = playerRect.right - obstRect.left;
      const overlapRight = obstRect.right - playerRect.left;
      const overlapTop = playerRect.bottom - obstRect.top;
      const overlapBottom = obstRect.bottom - playerRect.top;

      // Find minimum overlap
      const minOverlapX = Math.min(overlapLeft, overlapRight);
      const minOverlapY = Math.min(overlapTop, overlapBottom);

      // Push out on the axis with less overlap
      if (minOverlapX < minOverlapY) {
        if (overlapLeft < overlapRight) {
          player.x = obstRect.left - halfSize;
        } else {
          player.x = obstRect.right + halfSize;
        }
      } else {
        if (overlapTop < overlapBottom) {
          player.y = obstRect.top - halfSize;
        } else {
          player.y = obstRect.bottom + halfSize;
        }
      }
    }
  }

  // Reconcile local player with server state
  reconcileLocalPlayer(serverState) {
    const serverPlayer = this.findPlayerInState(serverState, this.myId);
    if (!serverPlayer) {
      console.warn('[Game] reconcileLocalPlayer: Could not find my player in server state. myId:', this.myId);
      return;
    }

    // Initialize local player if needed
    if (!this.localPlayer) {
      this.localPlayer = {
        x: serverPlayer.x,
        y: serverPlayer.y,
        facing: serverPlayer.facing,
        stunned: serverPlayer.stunned,
      };
      console.log('[Game] Local player initialized:', this.localPlayer);
      return;
    }

    // Update stunned state from server
    this.localPlayer.stunned = serverPlayer.stunned;

    // Calculate difference between predicted and server position
    const dx = serverPlayer.x - this.localPlayer.x;
    const dy = serverPlayer.y - this.localPlayer.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 5) {
      // Small difference: gradual smooth correction
      this.localPlayer.x += dx * 0.3;
      this.localPlayer.y += dy * 0.3;
    } else if (distance < 50) {
      // Medium difference: faster correction
      this.localPlayer.x += dx * 0.5;
      this.localPlayer.y += dy * 0.5;
    } else {
      // Large difference (lag spike or teleport): snap to server
      this.localPlayer.x = serverPlayer.x;
      this.localPlayer.y = serverPlayer.y;
    }
  }

  // Update HUD elements
  updateHUD(state) {
    if (!state) return;

    // Find local player data
    const player = this.findPlayerInState(state, this.myId);
    if (!player) return;

    // Update hearts display
    const heartsDisplay = document.getElementById('hearts-display');
    if (heartsDisplay) {
      heartsDisplay.textContent = '\u2665'.repeat(Math.max(0, player.hearts));
    }

    // Update ammo display
    const ammoDisplay = document.getElementById('ammo-display');
    if (ammoDisplay) {
      ammoDisplay.textContent = player.hasAmmo ? '\u25CF' : '\u25CB';
      ammoDisplay.classList.toggle('has-ammo', player.hasAmmo);
    }

    // Update timer
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay && state.time !== undefined) {
      const minutes = Math.floor(state.time / 60);
      const seconds = state.time % 60;
      timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    // Update scoreboard
    this.updateScoreboard(state);
  }

  // Update bottom scoreboard
  updateScoreboard(state) {
    const scoreboard = document.getElementById('scoreboard');
    if (!scoreboard || !state.p) return;

    // Clear existing
    scoreboard.innerHTML = '';

    // Add each player
    for (const pData of state.p) {
      const [id, , , , , hearts] = pData;
      const playerInfo = this.lobbyData?.players?.find(p => p.id === id);

      const item = document.createElement('div');
      item.className = 'scoreboard-item';
      if (id === this.myId) item.classList.add('self');
      if (hearts <= 0) item.classList.add('eliminated');

      const name = playerInfo?.name || 'Player';
      const color = playerInfo?.color || '#ffffff';

      item.innerHTML = `
        <span class="player-color" style="background: ${color}"></span>
        <span class="player-name">${name}</span>
        <span class="player-hearts">${'\u2665'.repeat(Math.max(0, hearts))}</span>
      `;

      scoreboard.appendChild(item);
    }
  }

  // --- Network Event Handlers ---

  onRoomCreated(data) {
    this.isHost = true;
    this.showScreen('lobby');
    this.updateRoomCodeDisplay(data.code);
  }

  onJoinError(message) {
    const errorEl = document.getElementById('menu-error');
    if (errorEl) {
      errorEl.textContent = message;
    }
  }

  onLobbyUpdate(data) {
    this.lobbyData = data;
    this.isHost = data.host === this.myId;

    // Show lobby if not already there
    if (this.state === 'menu') {
      this.showScreen('lobby');
    }

    this.updateLobbyUI(data);
  }

  onKicked() {
    this.roomCode = null;
    this.lobbyData = null;
    this.isHost = false;
    this.showScreen('menu');

    const errorEl = document.getElementById('menu-error');
    if (errorEl) {
      errorEl.textContent = 'You were kicked from the room';
    }
  }

  onCountdown(count) {
    console.log('[Game] onCountdown:', count);
    this.state = 'countdown';
    this.showScreen('game');

    const overlay = document.getElementById('countdown-overlay');
    const number = document.getElementById('countdown-number');

    console.log('[Game] Countdown overlay elements:', { overlay: !!overlay, number: !!number });

    if (overlay && number) {
      overlay.style.display = 'flex';
      number.textContent = count;

      // Play countdown sound
      this.audio.play('countdown');
    }
  }

  onGameStart(data) {
    console.log('[Game] onGameStart called with RAW data:', data);
    console.log('[Game] onGameStart parsed:', {
      hasData: !!data,
      hasPlayers_p: !!data?.p,
      hasPlayers_players: !!data?.players,
      playerCount_p: data?.p?.length,
      playerCount_players: data?.players?.length,
      hasPickups_k: !!data?.k,
      hasPickups_pickups: !!data?.pickups,
      hasObstacles: !!data?.obstacles,
      settings: data?.settings
    });

    this.state = 'playing';
    console.log('[Game] State set to playing, myId:', this.myId);

    // Hide countdown overlay
    const overlay = document.getElementById('countdown-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }

    // Initialize local player from first state
    // NOTE: game-start sends 'players' not 'p', but state updates send 'p'
    // Convert game-start format to state format for compatibility
    if (data && (data.p || data.players)) {
      console.log('[Game] Processing initial player state');
      // If data uses 'players' format, convert to 'p' format for onServerState
      const stateData = data.p ? data : {
        ...data,
        p: data.players,
        j: [],  // no projectiles at start
        k: data.pickups,
        e: [],  // no events at start
        s: 'playing'
      };
      this.onServerState(stateData);
    } else {
      console.warn('[Game] WARNING: No player data in game-start event!');
    }

    // Play start sound
    this.audio.play('start');

    // Reset input
    this.input.reset();

    console.log('[Game] Game started. localPlayer:', this.localPlayer);
  }

  onGamePaused(pausedBy) {
    this.state = 'paused';

    const overlay = document.getElementById('pause-overlay');
    const pausedByText = document.getElementById('paused-by-text');

    if (overlay) {
      overlay.style.display = 'flex';
    }

    if (pausedByText) {
      const playerName = this.lobbyData?.players?.find(p => p.id === pausedBy)?.name || 'Someone';
      pausedByText.textContent = `Paused by: ${playerName}`;
    }
  }

  onGameResumed(resumedBy) {
    this.state = 'playing';

    const overlay = document.getElementById('pause-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  onPlayerQuit(data) {
    // Show notification
    this.showNotification(`${data.name} left the game`);
  }

  onGameOver(data) {
    this.state = 'gameover';
    this.showScreen('gameover');

    // Update winner text
    const winnerText = document.getElementById('winner-text');
    if (winnerText) {
      if (data.winner) {
        const winnerName = this.lobbyData?.players?.find(p => p.id === data.winner)?.name || 'Someone';
        winnerText.textContent = `${winnerName} Wins!`;

        // Play victory sound
        if (data.winner === this.myId) {
          this.audio.play('victory');
        }
      } else {
        winnerText.textContent = "It's a Draw!";
      }
    }

    // Update final scoreboard
    const finalScoreboard = document.getElementById('final-scoreboard');
    if (finalScoreboard && data.scores) {
      finalScoreboard.innerHTML = '';

      // Sort by kills, then by deaths (ascending)
      const sorted = [...data.scores].sort((a, b) => {
        if (b.kills !== a.kills) return b.kills - a.kills;
        return a.deaths - b.deaths;
      });

      for (const score of sorted) {
        const row = document.createElement('div');
        row.className = 'score-row';
        if (score.id === this.myId) row.classList.add('self');
        if (score.id === data.winner) row.classList.add('winner');

        row.innerHTML = `
          <span class="player-name">${score.name}</span>
          <span class="kills">${score.kills} kills</span>
          <span class="deaths">${score.deaths} deaths</span>
        `;

        finalScoreboard.appendChild(row);
      }
    }

    // Clear effects
    this.effects.clear();
  }

  onDisconnect() {
    this.showScreen('menu');
    this.state = 'menu';
    this.roomCode = null;
    this.lobbyData = null;
    this.localPlayer = null;
    this.serverState = null;
    this.prevServerState = null;

    const errorEl = document.getElementById('menu-error');
    if (errorEl) {
      errorEl.textContent = 'Disconnected from server';
    }
  }

  // --- UI Helpers ---

  showScreen(screenName) {
    console.log('[Game] showScreen:', screenName, '| current state:', this.state);
    this.state = screenName === 'game' ? this.state : screenName;

    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    // Show target screen
    const screen = document.getElementById(`${screenName}-screen`);
    if (screen) {
      screen.classList.add('active');
      console.log('[Game] Screen activated:', screenName);
    } else {
      console.error('[Game] ERROR: Screen not found:', `${screenName}-screen`);
    }
  }

  updateRoomCodeDisplay(code) {
    const display = document.getElementById('room-code-display');
    if (display) {
      display.textContent = code;
    }
  }

  updateLobbyUI(data) {
    this.updateRoomCodeDisplay(data.code);

    // Update players list
    const playersList = document.getElementById('players-list');
    if (playersList) {
      playersList.innerHTML = '';

      for (const player of data.players) {
        const item = document.createElement('div');
        item.className = 'player-item';
        if (player.ready) item.classList.add('ready');
        if (player.id === this.myId) item.classList.add('self');
        if (player.id === data.host) item.classList.add('host');

        item.innerHTML = `
          <span class="player-color" style="background: ${player.color}"></span>
          <span class="player-name">${player.name}</span>
          <span class="player-status">${player.ready ? 'Ready' : 'Not Ready'}</span>
          ${player.id === data.host ? '<span class="host-badge">HOST</span>' : ''}
          ${this.isHost && player.id !== this.myId ? `<button class="kick-btn" data-id="${player.id}">Kick</button>` : ''}
        `;

        playersList.appendChild(item);
      }
    }

    // Update settings (host only can edit)
    const livesInput = document.getElementById('lives-setting');
    const timeInput = document.getElementById('time-setting');
    const settingsDiv = document.getElementById('lobby-settings');

    if (settingsDiv) {
      settingsDiv.style.display = this.isHost ? 'block' : 'none';
    }

    if (livesInput) {
      livesInput.value = data.settings.lives;
      livesInput.disabled = !this.isHost;
    }

    if (timeInput) {
      timeInput.value = data.settings.timeLimit;
      timeInput.disabled = !this.isHost;
    }

    // Update start button (host only, enabled when all non-host ready and 1+ players for solo)
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
      const nonHostPlayers = data.players.filter(p => p.id !== data.host);
      const allNonHostReady = nonHostPlayers.every(p => p.ready);
      const enoughPlayers = data.players.length >= 1; // Allow solo

      startBtn.disabled = !this.isHost || !allNonHostReady || !enoughPlayers;
      startBtn.style.display = this.isHost ? 'inline-block' : 'none';
    }

    // Update ready button text
    const readyBtn = document.getElementById('ready-btn');
    if (readyBtn) {
      const myPlayer = data.players.find(p => p.id === this.myId);
      readyBtn.textContent = myPlayer?.ready ? 'Not Ready' : 'Ready';
    }

    // Update lobby status
    const statusEl = document.getElementById('lobby-status');
    if (statusEl) {
      const readyCount = data.players.filter(p => p.ready).length;
      statusEl.textContent = `${readyCount}/${data.players.length} players ready`;
    }
  }

  showNotification(message) {
    const container = document.getElementById('notifications');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    container.appendChild(notification);

    // Remove after animation
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  // Toggle pause menu
  togglePause() {
    if (this.state === 'playing') {
      this.network.pause();
    } else if (this.state === 'paused') {
      this.network.resume();
    }
  }

  // --- Event Listeners Setup ---

  setupUIListeners() {
    // Resume audio context on first user interaction
    const resumeAudio = async () => {
      if (!this.audioInitialized) {
        await this.audio.init();
        this.audio.resume();
        this.audioInitialized = true;
      }
    };

    // Set up audio resume on any interaction
    document.addEventListener('click', resumeAudio, { once: false });
    document.addEventListener('keydown', resumeAudio, { once: false });

    // Set up controls menu
    this.setupControlsMenu();

    // Note: Button event listeners are handled by UI class (ui.js)
    // to avoid duplicate handlers
  }

  // --- Controls Menu ---

  setupControlsMenu() {
    const modal = document.getElementById('controls-modal');
    const openBtn = document.getElementById('controls-btn');
    const closeBtn = document.getElementById('close-controls-btn');
    const resetBtn = document.getElementById('reset-controls-btn');

    if (!modal || !openBtn) return;

    // State for key rebinding
    let listeningElement = null;
    let listeningAction = null;
    let listeningIndex = null;

    // Render the current controls
    const renderControls = () => {
      const rows = modal.querySelectorAll('.control-row');
      rows.forEach(row => {
        const action = row.dataset.action;
        const keysContainer = row.querySelector('.control-keys');
        const keys = controls.get(action);

        keysContainer.innerHTML = '';

        keys.forEach((key, index) => {
          const btn = document.createElement('button');
          btn.className = 'key-btn';
          btn.textContent = ControlsManager.getKeyDisplayName(key);
          btn.dataset.index = index;
          btn.addEventListener('click', () => startListening(btn, action, index));

          // Right-click to remove
          btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (keys.length > 1) {
              const newKeys = keys.filter((_, i) => i !== index);
              controls.set(action, newKeys);
              renderControls();
            }
          });

          keysContainer.appendChild(btn);
        });

        // Add "+" button to add more keys (max 3)
        if (keys.length < 3) {
          const addBtn = document.createElement('button');
          addBtn.className = 'key-btn add-key';
          addBtn.textContent = '+';
          addBtn.addEventListener('click', () => startListening(addBtn, action, keys.length));
          keysContainer.appendChild(addBtn);
        }
      });
    };

    // Start listening for a key press
    const startListening = (element, action, index) => {
      // Cancel previous listening
      if (listeningElement) {
        listeningElement.classList.remove('listening');
      }

      listeningElement = element;
      listeningAction = action;
      listeningIndex = index;
      element.classList.add('listening');
      element.textContent = 'Press key...';
    };

    // Handle key press while listening
    const handleKeyDown = (e) => {
      if (!listeningElement) return;

      e.preventDefault();
      e.stopPropagation();

      // Cancel on Escape
      if (e.code === 'Escape') {
        listeningElement.classList.remove('listening');
        listeningElement = null;
        renderControls();
        return;
      }

      // Set the new key
      const currentKeys = [...controls.get(listeningAction)];
      if (listeningIndex < currentKeys.length) {
        currentKeys[listeningIndex] = e.code;
      } else {
        currentKeys.push(e.code);
      }
      controls.set(listeningAction, currentKeys);

      listeningElement.classList.remove('listening');
      listeningElement = null;
      renderControls();
    };

    // Handle mouse button while listening
    const handleMouseDown = (e) => {
      if (!listeningElement) return;

      e.preventDefault();
      e.stopPropagation();

      const mouseCode = `Mouse${e.button}`;

      // Set the new key
      const currentKeys = [...controls.get(listeningAction)];
      if (listeningIndex < currentKeys.length) {
        currentKeys[listeningIndex] = mouseCode;
      } else {
        currentKeys.push(mouseCode);
      }
      controls.set(listeningAction, currentKeys);

      listeningElement.classList.remove('listening');
      listeningElement = null;
      renderControls();
    };

    // Open modal
    openBtn.addEventListener('click', () => {
      modal.classList.add('active');
      renderControls();
      document.addEventListener('keydown', handleKeyDown, true);
      document.addEventListener('mousedown', handleMouseDown, true);
    });

    // Close modal
    const closeModal = () => {
      modal.classList.remove('active');
      if (listeningElement) {
        listeningElement.classList.remove('listening');
        listeningElement = null;
      }
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
    };

    closeBtn?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Reset controls
    resetBtn?.addEventListener('click', () => {
      controls.reset();
      renderControls();
    });
  }
}

// Initialize and expose globally
const game = new Game();
window.game = game;
game.start();

export { game };
