// Main Game class that orchestrates everything
import { Network } from './network.js';
import { Input } from './input.js';
import { Renderer } from './renderer.js';
import { audio } from './audio.js';
import { effects } from './effects.js';
import { UI } from './ui.js';
import { Vision } from './vision.js';
import { CONFIG, debugLog } from './config.js';
import { setupControlsMenu as initControlsMenu, setupHowToPlayModal as initHowToPlayModal } from './modals.js';
import { predictLocalPlayer, reconcileWithServer, initLocalPlayer } from './prediction.js';
import { handleEvent as dispatchEvent, findPlayerInState } from './events.js';
import { StateManager } from './state.js';
import * as lifecycle from './lifecycle.js';
import { GameLoop } from './gameloop.js';

class Game {
  constructor() {
    debugLog('[Game]', 'Constructor called');

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

    // Player identification
    this.myId = null;
    this.roomCode = null;

    // State management (server state, interpolation, spectator mode)
    this.stateManager = new StateManager();

    // Local player for client-side prediction
    this.localPlayer = null;

    // Lobby data
    this.lobbyData = null;
    this.isHost = false;

    // Game loop (rAF, FPS tracking, input throttling)
    this.gameLoop = new GameLoop();

    // Audio context resume flag
    this.audioInitialized = false;
  }

  // --- State delegation to StateManager ---
  get serverState() { return this.stateManager.serverState; }
  set serverState(v) { this.stateManager.serverState = v; }
  get prevServerState() { return this.stateManager.prevServerState; }
  set prevServerState(v) { this.stateManager.prevServerState = v; }
  get stateTime() { return this.stateManager.stateTime; }
  set stateTime(v) { this.stateManager.stateTime = v; }
  get lastServerSeq() { return this.stateManager.lastServerSeq; }
  set lastServerSeq(v) { this.stateManager.lastServerSeq = v; }
  get isSpectating() { return this.stateManager.isSpectating; }
  set isSpectating(v) { this.stateManager.isSpectating = v; }
  get arenaInset() { return this.stateManager.arenaInset; }
  set arenaInset(v) { this.stateManager.arenaInset = v; }

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
    debugLog('[Game]', 'init() called');

    // Initialize subsystems that need DOM
    this.effects.init();
    this.renderer = new Renderer(this);
    this.ui = new UI(this);
    this.vision = new Vision(this);

    debugLog('[Game]', 'Subsystems initialized:', {
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
    this.gameLoop.start((cappedDt, timestamp) => {
      this._tick(cappedDt);
    });
  }

  // Stop the game loop
  stopGameLoop() {
    this.gameLoop.stop();
  }

  // Per-frame tick (called by GameLoop)
  _tick(cappedDt) {
    const shouldLog = this.gameLoop.shouldDebugLog();

    if (this.state === 'playing') {
      // Update interpolation timer
      this.stateManager.advanceInterpolation(cappedDt * 1000);

      // Poll input
      const shouldSend = this.gameLoop.shouldSendInput();
      const input = this.isSpectating ? null : this.input.getState(shouldSend);
      if (shouldSend && !this.isSpectating) {
        this.network.sendInput(input);
        this.gameLoop.markInputSent();
      }

      if (CONFIG.DEBUG && shouldLog && input) {
        console.log('[Game] Playing state - Input:', {
          up: input.up, down: input.down, left: input.left, right: input.right,
          facing: input.facing?.toFixed(2),
          hasLocalPlayer: !!this.localPlayer,
          hasServerState: !!this.serverState,
          localPlayerPos: this.localPlayer ? `(${this.localPlayer.x?.toFixed(0)}, ${this.localPlayer.y?.toFixed(0)})` : 'N/A'
        });
      } else if (CONFIG.DEBUG && shouldLog && this.isSpectating) {
        console.log('[Game] Spectating - watching game');
      }

      // Predict local player movement
      if (!this.isSpectating && this.localPlayer) {
        this.predictLocalPlayer(input, cappedDt);
      }

      // Render game state
      if (this.renderer) {
        this.renderer.render(
          this.prevServerState,
          this.serverState,
          this.stateTime,
          this.localPlayer
        );
      }
    } else if (CONFIG.DEBUG && shouldLog && this.state !== 'menu') {
      console.log('[Game] Current state:', this.state, '| myId:', this.myId);
    }
  }

  // Handle incoming server state
  onServerState(state) {
    // Process events BEFORE updating serverState to avoid stale state reference
    if (state && state.e && state.e.length > 0) {
      const playerMap = new Map();
      if (state.p) {
        for (const p of state.p) {
          if (p && p[0]) playerMap.set(p[0], p);
        }
      }
      for (const event of state.e) {
        this.handleEvent(event, state, playerMap);
      }
    }

    // Delegate sequence validation, storage, and interpolation to StateManager
    if (!this.stateManager.processServerState(state)) return;

    // Reconcile local player position with server
    this.reconcileLocalPlayer(state);

    // Check if local player is dead and enter spectator mode
    if (this.stateManager.checkSpectatorMode(this.myId)) {
      const arena = document.getElementById('arena');
      if (arena) {
        arena.classList.add('spectating');
      }
      this.showNotification('You died! Now spectating...');
    }

    // Update HUD
    this.ui.updateHUD(state, this.isSpectating);
  }

  // Handle game events from server (delegated to events.js)
  handleEvent(event, state, playerMap = null) {
    dispatchEvent(event, state, this.myId, this.localPlayer, playerMap);
  }

  // Find player data in server state by ID (delegated to events.js)
  findPlayerInState(state, playerId, playerMap = null) {
    return findPlayerInState(state, playerId, playerMap);
  }

  // Predict local player movement (delegated to prediction.js)
  predictLocalPlayer(input, dt) {
    predictLocalPlayer(this.localPlayer, input, dt, this.arenaInset);
  }

  // Reconcile local player with server state (delegated to prediction.js)
  reconcileLocalPlayer(serverState) {
    const serverPlayer = this.findPlayerInState(serverState, this.myId);
    if (!serverPlayer) {
      console.warn('[Game] reconcileLocalPlayer: Could not find my player in server state. myId:', this.myId);
      return;
    }

    if (!this.localPlayer) {
      this.localPlayer = initLocalPlayer(serverPlayer);
      debugLog('[Game]', 'Local player initialized:', this.localPlayer);
      return;
    }

    reconcileWithServer(this.localPlayer, serverPlayer);
  }

  // --- Network Event Handlers (delegated to lifecycle.js) ---

  onRoomCreated(data) { lifecycle.onRoomCreated(this, data); }
  onJoinError(message) { lifecycle.onJoinError(this, message); }
  onLobbyUpdate(data) { lifecycle.onLobbyUpdate(this, data); }
  onKicked() { lifecycle.onKicked(this); }
  onCountdown(count) { lifecycle.onCountdown(this, count); }
  onGameStart(data) { lifecycle.onGameStart(this, data); }
  onCountdownCancelled(reason) { lifecycle.onCountdownCancelled(this, reason); }
  onGamePaused(pausedBy) { lifecycle.onGamePaused(this, pausedBy); }
  onGameResumed(data) { lifecycle.onGameResumed(this, data); }
  onPlayerQuit(data) { lifecycle.onPlayerQuit(this, data); }
  onSuddenDeath() { lifecycle.onSuddenDeath(this); }
  onGameOver(data) { lifecycle.onGameOver(this, data); }
  onReturnToLobby() { lifecycle.onReturnToLobby(this); }
  onDisconnect() { lifecycle.onDisconnect(this); }
  onReconnect() { lifecycle.onReconnect(this); }

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

    // Destroy vision (clears caches)
    if (this.vision) {
      this.vision.destroy();
    }

    // Destroy renderer (full cleanup including DOM elements)
    if (this.renderer) {
      this.renderer.destroy();
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
        // Remove listeners IMMEDIATELY after setting flag to prevent accumulation on rapid clicks
        this._removeDocumentListener('click', resumeAudio);
        this._removeDocumentListener('keydown', resumeAudio);
        try {
          await this.audio.init();
          this.audio.resume();
        } catch (err) {
          console.error('[Game] Audio init failed:', err);
          // Reset flag on failure so it can be retried on next user interaction
          // Note: listeners are already removed, so user needs to trigger another action
          this.audioInitialized = false;
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

  // --- Controls Menu (delegated to modals.js) ---

  setupControlsMenu() {
    initControlsMenu();
  }

  // --- How to Play Modal (delegated to modals.js) ---

  setupHowToPlayModal() {
    initHowToPlayModal();
  }
}

// Initialize
const game = new Game();
game.start();

export { game };
