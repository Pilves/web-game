// Main Game class that orchestrates everything
import { Network } from './network.js';
import { Input } from './input.js';
import { Renderer } from './renderer.js';
import { audio } from './audio.js';
import { effects } from './effects.js';
import { UI } from './ui.js';
import { Vision } from './vision.js';
import { CONFIG, controls, ControlsManager } from './config.js';

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

    // Arena inset (for sudden death shrinking)
    this.arenaInset = 0;

    // Lobby data
    this.lobbyData = null;
    this.isHost = false;

    // Network sequence tracking
    this.lastServerSeq = -1;

    // Timing
    this.lastFrameTime = 0;
    this.running = false;

    // Input throttling (20Hz = 50ms)
    this.lastInputSendTime = 0;
    this.inputSendInterval = 50;

    // Audio context resume flag
    this.audioInitialized = false;

    // Bind gameLoop once to avoid creating new function every frame
    this._boundGameLoop = this.gameLoop.bind(this);
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
    this.ui.showScreen('menu');
    this.state = 'menu';

    // Start game loop
    this.running = true;
    console.log('[Game] Starting game loop');
    requestAnimationFrame(this._boundGameLoop);
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

      // Poll input - movement every frame, send throttled
      const input = this.input.getState(false); // Don't consume toggles yet
      const now = performance.now();
      if (now - this.lastInputSendTime >= this.inputSendInterval) {
        // Get input with toggle consumption for sending
        const sendInput = this.input.getState(true); // Consume toggles
        this.network.sendInput(sendInput);
        this.lastInputSendTime = now;
      }

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

    requestAnimationFrame(this._boundGameLoop);
  }

  // Handle incoming server state
  onServerState(state) {
    // Validate state object before accessing properties
    if (!state || typeof state !== 'object') return;

    // Check sequence number to ignore out-of-order packets
    if (state.seq !== undefined && state.seq <= this.lastServerSeq) {
      // Out of order packet, ignore
      return;
    }
    if (state.seq !== undefined) {
      this.lastServerSeq = state.seq;
    }

    // Debug: log first state and every 20th after
    if (!this._stateCount) this._stateCount = 0;
    this._stateCount++;
    if (this._stateCount === 1 || this._stateCount % 20 === 0) {
      console.log('[Game] onServerState #' + this._stateCount + ':', {
        seq: state.seq,
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

    // Update arena inset from server state (for sudden death)
    if (state.inset !== undefined) {
      this.arenaInset = state.inset;
    }

    // Reconcile local player position with server
    this.reconcileLocalPlayer(state);

    // Process events (hits, deaths, sounds)
    if (state.e && state.e.length > 0) {
      for (const event of state.e) {
        this.handleEvent(event);
      }
    }

    // Update HUD
    this.ui.updateHUD(state);
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
        // [playerId, pickupId] - get pickup position from state
        const playerId = data[0];
        const pickupId = data[1];
        if (playerId === this.myId) {
          this.audio.play('pickup');
        } else if (this.localPlayer && this.serverState?.k) {
          // Find the pickup position from state
          const pickup = this.serverState.k.find(p => p[0] === pickupId);
          if (pickup) {
            this.audio.playPositional('pickup', pickup[1], pickup[2],
              this.localPlayer.x, this.localPlayer.y);
          }
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

    // Initialize velocity if not present
    if (this.localPlayer.vx === undefined) this.localPlayer.vx = 0;
    if (this.localPlayer.vy === undefined) this.localPlayer.vy = 0;

    // Handle stunned state - apply friction but don't allow new input
    if (this.localPlayer.stunned) {
      // Apply friction while stunned (same as server: PLAYER_FRICTION = 0.85)
      const PLAYER_FRICTION = 0.85;
      this.localPlayer.vx *= PLAYER_FRICTION;
      this.localPlayer.vy *= PLAYER_FRICTION;

      // Apply velocity
      this.localPlayer.x += this.localPlayer.vx * dt;
      this.localPlayer.y += this.localPlayer.vy * dt;

      // Update facing direction
      this.localPlayer.facing = input.facing;

      // Handle boundary and collision
      this.applyBoundaryAndCollision();
      return;
    }

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

    // Store velocity for stun friction continuity
    this.localPlayer.vx = vx;
    this.localPlayer.vy = vy;

    // Apply velocity
    this.localPlayer.x += vx * dt;
    this.localPlayer.y += vy * dt;

    // Update facing direction
    this.localPlayer.facing = input.facing;

    // Handle boundary and collision
    this.applyBoundaryAndCollision();
  }

  // Apply boundary wrapping/clamping and obstacle collision
  applyBoundaryAndCollision() {
    const halfSize = CONFIG.PLAYER_SIZE / 2;
    const arenaWidth = CONFIG.ARENA_WIDTH;
    const arenaHeight = CONFIG.ARENA_HEIGHT;

    // Check if sudden death is active (arena is shrinking)
    if (this.arenaInset > 0) {
      // During sudden death, clamp to shrinking arena bounds
      const minX = this.arenaInset + halfSize;
      const maxX = arenaWidth - this.arenaInset - halfSize;
      const minY = this.arenaInset + halfSize;
      const maxY = arenaHeight - this.arenaInset - halfSize;

      if (this.localPlayer.x < minX) {
        this.localPlayer.x = minX;
        this.localPlayer.vx = 0;
      }
      if (this.localPlayer.x > maxX) {
        this.localPlayer.x = maxX;
        this.localPlayer.vx = 0;
      }
      if (this.localPlayer.y < minY) {
        this.localPlayer.y = minY;
        this.localPlayer.vy = 0;
      }
      if (this.localPlayer.y > maxY) {
        this.localPlayer.y = maxY;
        this.localPlayer.vy = 0;
      }
    } else {
      // Normal mode: wrap around arena bounds like Snake
      if (this.localPlayer.x < -halfSize) {
        this.localPlayer.x = arenaWidth + halfSize + (this.localPlayer.x + halfSize);
      } else if (this.localPlayer.x > arenaWidth + halfSize) {
        this.localPlayer.x = -halfSize + (this.localPlayer.x - arenaWidth - halfSize);
      }

      if (this.localPlayer.y < -halfSize) {
        this.localPlayer.y = arenaHeight + halfSize + (this.localPlayer.y + halfSize);
      } else if (this.localPlayer.y > arenaHeight + halfSize) {
        this.localPlayer.y = -halfSize + (this.localPlayer.y - arenaHeight - halfSize);
      }
    }

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

  // --- Network Event Handlers ---

  onRoomCreated(data) {
    this.isHost = true;
    this.ui.showScreen('lobby');
    this.state = 'lobby';
    this.updateRoomCodeDisplay(data.code);
  }

  onJoinError(message) {
    // Use ui.showError to display error and re-enable menu buttons
    this.ui.showError(message);
  }

  onLobbyUpdate(data) {
    this.lobbyData = data;
    this.isHost = data.host === this.myId;

    // Show lobby if not already there
    if (this.state === 'menu') {
      this.ui.showScreen('lobby');
      this.state = 'lobby';
    }

    this.ui.updateLobby(data);
  }

  onKicked() {
    this.roomCode = null;
    this.lobbyData = null;
    this.isHost = false;

    // Network sequence tracking
    this.lastServerSeq = -1;
    this.ui.showScreen('menu');
    this.state = 'menu';

    const errorEl = document.getElementById('menu-error');
    if (errorEl) {
      errorEl.textContent = 'You were kicked from the room';
    }
  }

  onCountdown(count) {
    console.log('[Game] onCountdown:', count);
    this.state = 'countdown';
    this.ui.showScreen('game');

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
    this.lastServerSeq = -1; // Reset sequence for new game
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

  onCountdownCancelled(reason) {
    console.log('[Game] Countdown cancelled:', reason);
    this.state = 'lobby';
    this.ui.showScreen('lobby');

    // Hide countdown overlay
    const overlay = document.getElementById('countdown-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }

    // Show notification
    this.showNotification(reason || 'Countdown cancelled');
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

  onSuddenDeath() {
    // Show sudden death notification
    this.showNotification('SUDDEN DEATH - Arena is shrinking!');

    // Play alarm sound if available
    this.audio.play('sudden-death');

    // Add visual effect to arena (optional CSS class)
    const arena = document.getElementById('arena');
    if (arena) {
      arena.classList.add('sudden-death');
    }
  }

  onGameOver(data) {
    this.state = 'gameover';
    this.ui.showScreen('gameover');

    // Update winner text
    const winnerText = document.getElementById('winner-text');
    if (winnerText) {
      if (data.winner) {
        // data.winner is an object with {id, name, color, kills}
        const winnerName = data.winner.name || 'Someone';
        winnerText.textContent = `${winnerName} Wins!`;

        // Play victory sound
        if (data.winner.id === this.myId) {
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

        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.textContent = score.name;
        row.appendChild(nameSpan);

        const killsSpan = document.createElement('span');
        killsSpan.className = 'kills';
        killsSpan.textContent = `${score.kills} kills`;
        row.appendChild(killsSpan);

        const deathsSpan = document.createElement('span');
        deathsSpan.className = 'deaths';
        deathsSpan.textContent = `${score.deaths} deaths`;
        row.appendChild(deathsSpan);

        finalScoreboard.appendChild(row);
      }
    }

    // Clear effects
    this.effects.clear();
  }

  onDisconnect() {
    this.ui.showScreen('menu');
    this.state = 'menu';
    this.roomCode = null;
    this.lobbyData = null;
    this.localPlayer = null;
    this.serverState = null;
    this.prevServerState = null;
    this.lastServerSeq = -1;

    const errorEl = document.getElementById('menu-error');
    if (errorEl) {
      errorEl.textContent = 'Disconnected from server';
    }
  }

  // --- UI Helpers ---

  updateRoomCodeDisplay(code) {
    const display = document.getElementById('room-code-display');
    if (display) {
      display.textContent = code;
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
        // Remove listeners after init to prevent memory leaks
        document.removeEventListener('click', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
      }
    };

    // Set up audio resume on any interaction
    document.addEventListener('click', resumeAudio);
    document.addEventListener('keydown', resumeAudio);

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

    // Store the element that had focus before modal opened
    let previouslyFocusedElement = null;

    // Focus trap handler for accessibility
    const handleFocusTrap = (e) => {
      if (e.key !== 'Tab') return;

      const focusableElements = modal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    };

    // Open modal
    openBtn.addEventListener('click', () => {
      previouslyFocusedElement = document.activeElement;
      modal.classList.add('active');
      renderControls();
      document.addEventListener('keydown', handleKeyDown, true);
      document.addEventListener('mousedown', handleMouseDown, true);
      document.addEventListener('keydown', handleFocusTrap);
      // Focus first focusable element in modal for accessibility
      const firstFocusable = modal.querySelector('button:not([disabled]), [href], input:not([disabled])');
      if (firstFocusable) {
        firstFocusable.focus();
      }
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
      document.removeEventListener('keydown', handleFocusTrap);
      // Return focus to the element that opened the modal for accessibility
      if (previouslyFocusedElement) {
        previouslyFocusedElement.focus();
      }
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
