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

    // Game state: 'menu', 'lobby', 'playing', 'paused', 'gameover', 'countdown'
    this.state = 'menu';

    // Valid state transitions map
    this.validTransitions = {
      'menu': ['lobby', 'menu'],
      'lobby': ['countdown', 'menu', 'lobby'],
      'countdown': ['playing', 'lobby', 'menu'],
      'playing': ['paused', 'gameover', 'menu'],
      'paused': ['playing', 'gameover', 'menu'],
      'gameover': ['lobby', 'menu']
    };

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

    // Spectator mode (when player is dead but game continues)
    this.isSpectating = false;

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

    // FPS tracking
    this.fpsHistory = [];
    this.fpsLastUpdate = 0;
    this.fpsUpdateInterval = 250; // Update FPS display every 250ms

    // Bind gameLoop once to avoid creating new function every frame
    this._boundGameLoop = this.gameLoop.bind(this);
  }

  // Validate and perform state transition
  transitionState(newState) {
    const validTargets = this.validTransitions[this.state];
    if (!validTargets || !validTargets.includes(newState)) {
      console.warn(`[Game] Invalid state transition from '${this.state}' to '${newState}'`);
      return false;
    }
    console.log(`[Game] State transition: ${this.state} -> ${newState}`);
    this.state = newState;
    return true;
  }

  // Check if a state transition is valid without performing it
  canTransitionTo(newState) {
    const validTargets = this.validTransitions[this.state];
    return validTargets && validTargets.includes(newState);
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

    // Show menu screen (force state since we're initializing)
    this.ui.showScreen('menu');
    this.state = 'menu';

    // Start game loop
    this.startGameLoop();
  }

  // Start the game loop (called on init and reconnect)
  startGameLoop() {
    if (this.running) {
      console.log('[Game] Game loop already running');
      return;
    }
    this.running = true;
    this.lastFrameTime = 0; // Reset to avoid large dt on first frame
    console.log('[Game] Starting game loop');
    this.animationFrameId = requestAnimationFrame(this._boundGameLoop);
  }

  // Stop the game loop
  stopGameLoop() {
    this.running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  // Main game loop
  gameLoop(timestamp) {
    if (!this.running) return;

    // Initialize lastFrameTime on first frame to avoid uninitialized value
    if (this.lastFrameTime === 0) {
      this.lastFrameTime = timestamp;
    }

    // Calculate delta time in seconds
    const dt = (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;

    // Cap dt to prevent large jumps
    const cappedDt = Math.min(dt, 0.1);

    // Track FPS
    if (dt > 0) {
      const instantFps = 1 / dt;
      this.fpsHistory.push(instantFps);
      // Keep last 60 samples for averaging
      if (this.fpsHistory.length > 60) {
        this.fpsHistory.shift();
      }
    }

    // Update FPS display periodically
    if (timestamp - this.fpsLastUpdate >= this.fpsUpdateInterval) {
      this.updateFpsDisplay();
      this.fpsLastUpdate = timestamp;
    }

    // Debug log every 60 frames (roughly 1 second)
    this._debugFrameCount++;
    const shouldLog = this._debugFrameCount % 60 === 0;

    if (this.state === 'playing') {
      // Update interpolation timer
      this.stateTime += cappedDt * 1000;

      // Poll input - consume toggles immediately in first call to avoid race condition
      // Spectators don't send input (they can't interact with the game)
      const now = performance.now();
      const shouldSend = now - this.lastInputSendTime >= this.inputSendInterval;
      const input = this.isSpectating ? null : this.input.getState(shouldSend); // Consume toggles only when sending
      if (shouldSend && !this.isSpectating) {
        this.network.sendInput(input);
        this.lastInputSendTime = now;
      }

      if (shouldLog && input) {
        console.log('[Game] Playing state - Input:', {
          up: input.up, down: input.down, left: input.left, right: input.right,
          facing: input.facing?.toFixed(2),
          hasLocalPlayer: !!this.localPlayer,
          hasServerState: !!this.serverState,
          localPlayerPos: this.localPlayer ? `(${this.localPlayer.x?.toFixed(0)}, ${this.localPlayer.y?.toFixed(0)})` : 'N/A'
        });
      } else if (shouldLog && this.isSpectating) {
        console.log('[Game] Spectating - watching game');
      }

      // Predict local player movement (skip when spectating)
      if (!this.isSpectating) {
        this.predictLocalPlayer(input, cappedDt);
      }

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

    this.animationFrameId = requestAnimationFrame(this._boundGameLoop);
  }

  // Handle incoming server state
  onServerState(state) {
    // Validate state object before accessing properties
    if (!state || typeof state !== 'object') return;

    // Validate packet has sequence number before processing
    if (state.seq === undefined) {
      console.warn('[Game] Received state packet without sequence number, ignoring');
      return;
    }

    // Check sequence number to ignore out-of-order packets (with wraparound handling)
    // MAX_SEQ is 2^32 - 1, so sequence numbers are 0 to MAX_SEQ inclusive
    const MAX_SEQ = 0xFFFFFFFF;
    const HALF_SEQ = 0x80000000; // Half of the sequence space (2^31)

    if (this.lastServerSeq !== -1) {
      // Calculate the forward distance from lastServerSeq to state.seq
      // This handles wraparound: if state.seq wrapped around, the difference will be small and positive
      // If state.seq is an old packet, the forward distance will be very large (> half the space)
      const forwardDist = (state.seq - this.lastServerSeq + MAX_SEQ + 1) & MAX_SEQ;

      // If forward distance is greater than half the sequence space, it's an old packet
      if (forwardDist > HALF_SEQ) {
        // Out of order packet, ignore
        return;
      }
    }
    this.lastServerSeq = state.seq;

    // Debug: log first state and every 20th after
    if (!this._stateCount) this._stateCount = 0;
    this._stateCount++;
    if (this._stateCount === 1 || this._stateCount % 20 === 0) {
      console.log('[Game] onServerState #' + this._stateCount + ':', {
        seq: state.seq,
        gameState: state.s,
        playerCount: state.p?.length,
        pickups: state.k?.length || 0,
        pickupsData: state.k,
        projectiles: state.j?.length || 0,
        projectilesData: state.j,
        myId: this.myId?.substring(0, 8)
      });
    }

    // Process events BEFORE updating serverState to avoid stale state reference
    // Events reference player positions from the incoming state
    if (state.e && state.e.length > 0) {
      for (const event of state.e) {
        this.handleEvent(event, state);
      }
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

    // Check if local player is dead (hearts <= 0) and enter spectator mode
    this.checkSpectatorMode(state);

    // Update HUD
    this.ui.updateHUD(state, this.isSpectating);
  }

  // Check if local player should enter spectator mode (dead but game continues)
  checkSpectatorMode(state) {
    if (!state || !state.p) return;

    const myPlayerData = state.p.find(p => p[0] === this.myId);
    if (!myPlayerData) return;

    const hearts = myPlayerData[5]; // hearts is at index 5

    // Enter spectator mode when dead (hearts <= 0)
    if (hearts <= 0 && !this.isSpectating) {
      this.isSpectating = true;
      console.log('[Game] Entered spectator mode');

      // Add spectating class to arena for CSS styling
      const arena = document.getElementById('arena');
      if (arena) {
        arena.classList.add('spectating');
      }

      // Show notification
      this.showNotification('You died! Now spectating...');
    }
  }

  // Handle game events from server
  handleEvent(event, state) {
    const [type, ...data] = event;

    switch (type) {
      case 'hit': {
        // [victimId, attackerId]
        const victimId = data[0];
        const victim = this.findPlayerInState(state, victimId);
        if (victim) {
          this.effects.showImpactFlash(victim.x, victim.y);
          this.effects.triggerScreenShake();

          // Play hit sound with position
          if (this.localPlayer) {
            this.audio.playPositional('hit-player', victim.x, victim.y,
              this.localPlayer.x, this.localPlayer.y);
          }
        } else {
          console.warn('[Game] handleEvent hit: Could not find victim in state, victimId:', victimId);
        }
        break;
      }

      case 'death': {
        // [playerId]
        const playerId = data[0];
        const player = this.findPlayerInState(state, playerId);
        if (player) {
          // Play death sound
          if (this.localPlayer) {
            this.audio.playPositional('death', player.x, player.y,
              this.localPlayer.x, this.localPlayer.y);
          }
        } else {
          console.warn('[Game] handleEvent death: Could not find player in state, playerId:', playerId);
        }
        break;
      }

      case 'throw': {
        // [playerId]
        const playerId = data[0];
        const player = this.findPlayerInState(state, playerId);
        if (player) {
          this.effects.triggerMuzzleFlash();

          if (playerId === this.myId) {
            this.audio.play('throw', 0.8);
          } else if (this.localPlayer) {
            this.audio.playPositional('throw', player.x, player.y,
              this.localPlayer.x, this.localPlayer.y, 0.8);
          }
        } else {
          console.warn('[Game] handleEvent throw: Could not find player in state, playerId:', playerId);
        }
        break;
      }

      case 'pickup': {
        // [playerId, pickupId] - get pickup position from state
        const playerId = data[0];
        const pickupId = data[1];
        if (playerId === this.myId) {
          this.audio.play('pickup');
        } else if (this.localPlayer && state?.k) {
          // Find the pickup position from state
          const pickup = state.k.find(p => p[0] === pickupId);
          if (pickup) {
            this.audio.playPositional('pickup', pickup[1], pickup[2],
              this.localPlayer.x, this.localPlayer.y);
          } else {
            console.warn('[Game] handleEvent pickup: Could not find pickup in state, pickupId:', pickupId);
          }
        } else if (this.localPlayer && !state?.k) {
          console.warn('[Game] handleEvent pickup: State has no pickups array');
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

      default: {
        console.warn('[Game] handleEvent: Unknown event type:', type, 'data:', data);
        break;
      }
    }
  }

  // Find player data in server state by ID
  findPlayerInState(state, playerId) {
    if (!state || !state.p) return null;

    const playerData = state.p.find(p => p && p[0] === playerId);
    if (!playerData || playerData.length < 10) return null;

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
      flashlightOnSince: playerData[9],
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
      // Normal mode: wrap around arena bounds like Snake (simplified to match server logic)
      if (this.localPlayer.x < -halfSize) {
        this.localPlayer.x += arenaWidth;
      } else if (this.localPlayer.x > arenaWidth + halfSize) {
        this.localPlayer.x -= arenaWidth;
      }

      if (this.localPlayer.y < -halfSize) {
        this.localPlayer.y += arenaHeight;
      } else if (this.localPlayer.y > arenaHeight + halfSize) {
        this.localPlayer.y -= arenaHeight;
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
        vx: 0,
        vy: 0,
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
    if (!this.transitionState('lobby')) {
      console.warn('[Game] Cannot transition to lobby from current state:', this.state);
      return;
    }
    this.isHost = true;
    this.ui.showScreen('lobby');
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
      if (this.transitionState('lobby')) {
        this.ui.showScreen('lobby');
      }
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
    // Force state to menu (kicked can happen from any state)
    this.state = 'menu';

    const errorEl = document.getElementById('menu-error');
    if (errorEl) {
      errorEl.textContent = 'You were kicked from the room';
    }
  }

  onCountdown(count) {
    console.log('[Game] onCountdown:', count);

    // Validate state transition (only from lobby, or already in countdown)
    if (this.state !== 'countdown' && !this.transitionState('countdown')) {
      console.warn('[Game] Cannot start countdown from current state:', this.state);
      return;
    }

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

    // Validate state transition
    if (!this.transitionState('playing')) {
      console.warn('[Game] Cannot start game from current state:', this.state);
      return;
    }

    this.lastServerSeq = -1; // Reset sequence for new game
    this.isSpectating = false; // Reset spectator mode for new game
    console.log('[Game] State set to playing, myId:', this.myId);

    // Remove spectating class from arena
    const arena = document.getElementById('arena');
    if (arena) {
      arena.classList.remove('spectating');
    }

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
        j: data.projectiles || [],
        k: data.pickups || [],
        e: data.events || [],
        s: 'playing',
        seq: 0,
        time: data.timeRemaining || 180,
        inset: 0,
        mf: false
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

    // Validate state transition
    if (!this.transitionState('lobby')) {
      console.warn('[Game] Cannot return to lobby from current state:', this.state);
      // Force state anyway since countdown was cancelled
      this.state = 'lobby';
    }

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
    // Validate state transition
    if (!this.transitionState('paused')) {
      console.warn('[Game] Cannot pause from current state:', this.state);
      return;
    }

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
    // Validate state transition
    if (!this.transitionState('playing')) {
      console.warn('[Game] Cannot resume from current state:', this.state);
      return;
    }

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
    // Validate state transition
    if (!this.transitionState('gameover')) {
      console.warn('[Game] Cannot transition to gameover from current state:', this.state);
      // Force state anyway since game is over
      this.state = 'gameover';
    }
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
    if (finalScoreboard && data.players) {
      finalScoreboard.innerHTML = '';

      // Sort by kills, then by deaths (ascending)
      const sorted = [...data.players].sort((a, b) => {
        if (b.kills !== a.kills) return b.kills - a.kills;
        return a.deaths - b.deaths;
      });

      for (const score of sorted) {
        const row = document.createElement('div');
        row.className = 'score-row';
        if (score.id === this.myId) row.classList.add('self');
        if (score.id === data.winner?.id) row.classList.add('winner');

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
    console.log('[Game] onDisconnect called, current state:', this.state);

    // Stop the game loop
    this.stopGameLoop();

    // Reset input state but DON'T destroy listeners - they'll be needed on reconnect
    if (this.input) {
      this.input.reset();
    }

    // Clear renderer
    if (this.renderer) {
      this.renderer.clear();
    }

    // Clear effects
    if (this.effects) {
      this.effects.clear();
    }

    this.ui.showScreen('menu');
    // Force state to menu on disconnect
    this.state = 'menu';
    this.localPlayer = null;
    this.serverState = null;
    this.prevServerState = null;
    this.lastServerSeq = -1;
    this.isSpectating = false;

    // Remove spectating class from arena
    const arena = document.getElementById('arena');
    if (arena) {
      arena.classList.remove('spectating');
    }
    // Note: roomCode and lobbyData are preserved for potential reconnection

    const errorEl = document.getElementById('menu-error');
    if (errorEl) {
      errorEl.textContent = 'Disconnected from server';
    }
  }

  // Called by network when reconnection is successful
  onReconnect() {
    console.log('[Game] onReconnect called, current state:', this.state);

    // Validate that we can restore state
    const canRestore = this.validateReconnectState();

    if (!canRestore) {
      console.log('[Game] Cannot restore previous state, staying in menu');
      // Clear any stale state
      this.roomCode = null;
      this.lobbyData = null;
      this.isHost = false;
      return;
    }

    // Restart the game loop
    this.startGameLoop();

    console.log('[Game] Reconnect complete, waiting for server state');
  }

  // Validate that the game state can be restored on reconnect
  validateReconnectState() {
    // Must have room code and player name stored in network
    if (!this.network.roomCode || !this.network.playerName) {
      console.log('[Game] No room/player info to restore');
      return false;
    }

    // Must be connected
    if (!this.network.connected) {
      console.log('[Game] Not connected, cannot restore');
      return false;
    }

    return true;
  }

  // Called when leaving the game voluntarily (quit button, etc.)
  leaveGame() {
    console.log('[Game] leaveGame called');

    // Clean up game state
    this.localPlayer = null;
    this.serverState = null;
    this.prevServerState = null;
    this.lastServerSeq = -1;
    this.roomCode = null;
    this.lobbyData = null;
    this.isHost = false;
    this.isSpectating = false;

    // Remove spectating class from arena
    const arena = document.getElementById('arena');
    if (arena) {
      arena.classList.remove('spectating');
    }

    // Clear network stored state
    this.network.roomCode = null;
    this.network.playerName = null;

    // Reset input
    if (this.input) {
      this.input.reset();
    }

    // Clear effects
    if (this.effects) {
      this.effects.clear();
    }

    // Clear renderer
    if (this.renderer) {
      this.renderer.clear();
    }

    // Force state to menu
    this.state = 'menu';
    this.ui.showScreen('menu');
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

  // Update FPS display
  updateFpsDisplay() {
    const fpsDisplay = document.getElementById('fps-display');
    if (!fpsDisplay) return;

    if (this.fpsHistory.length === 0) {
      fpsDisplay.textContent = '-- FPS';
      fpsDisplay.className = 'debug-info';
      return;
    }

    // Calculate average FPS from history
    const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
    const roundedFps = Math.round(avgFps);

    fpsDisplay.textContent = `${roundedFps} FPS`;

    // Color code based on performance
    fpsDisplay.classList.remove('good', 'warning', 'bad');
    if (roundedFps >= 55) {
      fpsDisplay.classList.add('good');
    } else if (roundedFps >= 30) {
      fpsDisplay.classList.add('warning');
    } else {
      fpsDisplay.classList.add('bad');
    }
  }

  // --- Cleanup ---

  // Full cleanup of all game resources and event listeners
  // Called when the game is being destroyed (e.g., page unload)
  destroy() {
    console.log('[Game] destroy called');

    // Stop the game loop
    this.stopGameLoop();

    // Cleanup input listeners
    if (this.input) {
      this.input.destroy();
    }

    // Cleanup UI listeners
    if (this.ui) {
      this.ui.cleanup();
    }

    // Cleanup document-level listeners
    this._cleanupDocumentListeners();

    // Cleanup network
    if (this.network) {
      this.network.destroy();
    }

    // Clear effects
    if (this.effects) {
      this.effects.clear();
    }

    // Clear renderer
    if (this.renderer) {
      this.renderer.clear();
    }
  }

  // --- Event Listeners Setup ---

  setupUIListeners() {
    // Track document-level event listeners for cleanup
    this._documentListeners = this._documentListeners || [];

    // Resume audio context on first user interaction
    const resumeAudio = async () => {
      if (!this.audioInitialized) {
        // Set flag BEFORE awaiting to prevent race condition with multiple calls
        this.audioInitialized = true;
        try {
          await this.audio.init();
          this.audio.resume();
          // Remove from tracked listeners and document
          this._removeDocumentListener('click', resumeAudio);
          this._removeDocumentListener('keydown', resumeAudio);
        } catch (err) {
          console.error('[Game] Audio init failed:', err);
          // Reset flag on failure so it can be retried
          this.audioInitialized = false;
          // Still remove listeners to prevent infinite retry
          this._removeDocumentListener('click', resumeAudio);
          this._removeDocumentListener('keydown', resumeAudio);
        }
      }
    };

    // Set up audio resume on any interaction (tracked for cleanup)
    this._addDocumentListener('click', resumeAudio);
    this._addDocumentListener('keydown', resumeAudio);

    // Set up controls menu
    this.setupControlsMenu();

    // Set up how to play modal
    this.setupHowToPlayModal();

    // Note: Button event listeners are handled by UI class (ui.js)
    // to avoid duplicate handlers
  }

  // Track and add a document-level event listener
  _addDocumentListener(event, handler) {
    document.addEventListener(event, handler);
    this._documentListeners.push({ event, handler });
  }

  // Remove a tracked document-level event listener
  _removeDocumentListener(event, handler) {
    document.removeEventListener(event, handler);
    this._documentListeners = this._documentListeners.filter(
      l => !(l.event === event && l.handler === handler)
    );
  }

  // Remove all tracked document-level event listeners
  _cleanupDocumentListeners() {
    if (this._documentListeners) {
      for (const { event, handler } of this._documentListeners) {
        document.removeEventListener(event, handler);
      }
      this._documentListeners = [];
    }
  }

  // --- Controls Menu ---

  setupControlsMenu() {
    const modal = document.getElementById('controls-modal');
    const openBtn = document.getElementById('controls-btn');
    const closeBtn = document.getElementById('close-controls-btn');
    const resetBtn = document.getElementById('reset-controls-btn');

    if (!modal || !openBtn) return;

    // Prevent duplicate setup
    if (this._controlsMenuSetup) return;
    this._controlsMenuSetup = true;

    // State for key rebinding (stored on instance for persistence)
    this._controlsModal = {
      listeningElement: null,
      listeningAction: null,
      listeningIndex: null,
      previouslyFocusedElement: null
    };

    const modalState = this._controlsModal;

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
      if (modalState.listeningElement) {
        modalState.listeningElement.classList.remove('listening');
      }

      modalState.listeningElement = element;
      modalState.listeningAction = action;
      modalState.listeningIndex = index;
      element.classList.add('listening');
      element.textContent = 'Press key...';
    };

    // Store handler references on instance for proper removal
    // Handle key press while listening
    this._controlsModalHandlers = this._controlsModalHandlers || {};

    this._controlsModalHandlers.handleKeyDown = (e) => {
      if (!modalState.listeningElement) return;

      e.preventDefault();
      e.stopPropagation();

      // Cancel on Escape
      if (e.code === 'Escape') {
        modalState.listeningElement.classList.remove('listening');
        modalState.listeningElement = null;
        renderControls();
        return;
      }

      // Set the new key
      const currentKeys = [...controls.get(modalState.listeningAction)];
      if (modalState.listeningIndex < currentKeys.length) {
        currentKeys[modalState.listeningIndex] = e.code;
      } else {
        currentKeys.push(e.code);
      }
      controls.set(modalState.listeningAction, currentKeys);

      modalState.listeningElement.classList.remove('listening');
      modalState.listeningElement = null;
      renderControls();
    };

    // Handle mouse button while listening
    this._controlsModalHandlers.handleMouseDown = (e) => {
      if (!modalState.listeningElement) return;

      e.preventDefault();
      e.stopPropagation();

      const mouseCode = `Mouse${e.button}`;

      // Set the new key
      const currentKeys = [...controls.get(modalState.listeningAction)];
      if (modalState.listeningIndex < currentKeys.length) {
        currentKeys[modalState.listeningIndex] = mouseCode;
      } else {
        currentKeys.push(mouseCode);
      }
      controls.set(modalState.listeningAction, currentKeys);

      modalState.listeningElement.classList.remove('listening');
      modalState.listeningElement = null;
      renderControls();
    };

    // Focus trap handler for accessibility
    this._controlsModalHandlers.handleFocusTrap = (e) => {
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

    const handlers = this._controlsModalHandlers;

    // Close modal - defined before open so it can be referenced
    const closeModal = () => {
      modal.classList.remove('active');
      if (modalState.listeningElement) {
        modalState.listeningElement.classList.remove('listening');
        modalState.listeningElement = null;
      }
      // Remove handlers using stored references
      document.removeEventListener('keydown', handlers.handleKeyDown, true);
      document.removeEventListener('mousedown', handlers.handleMouseDown, true);
      document.removeEventListener('keydown', handlers.handleFocusTrap);
      // Return focus to the element that opened the modal for accessibility
      if (modalState.previouslyFocusedElement) {
        modalState.previouslyFocusedElement.focus();
      }
    };

    // Open modal
    openBtn.addEventListener('click', () => {
      // Guard against duplicate listeners if modal is already open
      if (modal.classList.contains('active')) return;

      modalState.previouslyFocusedElement = document.activeElement;
      modal.classList.add('active');
      renderControls();
      // Add handlers using stored references
      document.addEventListener('keydown', handlers.handleKeyDown, true);
      document.addEventListener('mousedown', handlers.handleMouseDown, true);
      document.addEventListener('keydown', handlers.handleFocusTrap);
      // Focus first focusable element in modal for accessibility
      const firstFocusable = modal.querySelector('button:not([disabled]), [href], input:not([disabled])');
      if (firstFocusable) {
        firstFocusable.focus();
      }
    });

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

  // --- How to Play Modal ---

  setupHowToPlayModal() {
    const modal = document.getElementById('how-to-play-modal');
    const openBtn = document.getElementById('how-to-play-btn');
    const closeBtn = document.getElementById('close-how-to-play-btn');

    if (!modal || !openBtn) return;

    // Prevent duplicate setup
    if (this._howToPlayModalSetup) return;
    this._howToPlayModalSetup = true;

    // State for accessibility
    this._howToPlayModal = {
      previouslyFocusedElement: null
    };

    const modalState = this._howToPlayModal;

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

    // Close on Escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };

    // Close modal function
    const closeModal = () => {
      modal.classList.remove('active');
      document.removeEventListener('keydown', handleFocusTrap);
      document.removeEventListener('keydown', handleEscape);
      // Return focus to the element that opened the modal for accessibility
      if (modalState.previouslyFocusedElement) {
        modalState.previouslyFocusedElement.focus();
      }
    };

    // Open modal
    openBtn.addEventListener('click', () => {
      // Guard against duplicate listeners if modal is already open
      if (modal.classList.contains('active')) return;

      modalState.previouslyFocusedElement = document.activeElement;
      modal.classList.add('active');
      document.addEventListener('keydown', handleFocusTrap);
      document.addEventListener('keydown', handleEscape);
      // Focus first focusable element in modal for accessibility
      const firstFocusable = modal.querySelector('button:not([disabled]), [href], input:not([disabled])');
      if (firstFocusable) {
        firstFocusable.focus();
      }
    });

    // Close modal on button click
    closeBtn?.addEventListener('click', closeModal);

    // Close modal on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }
}

// Initialize and expose globally
const game = new Game();
window.game = game;
game.start();

export { game };
