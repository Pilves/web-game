// Screen management and UI updates
import { Lobby } from './lobby.js';

export class UI {
  constructor(game) {
    this.game = game;
    this.currentScreen = null;
    this.pendingTransition = null;
    this.warningPlayed = false; // Track if 30-second warning sound has been played
    this.boundHandlers = {
      menu: [],
      game: []
    };

    // Cache screen elements to avoid querySelectorAll on every transition
    this._screenElements = document.querySelectorAll('.screen');

    this.lobby = new Lobby(game, this);
    this.bindMenuEvents();
    this.bindGameEvents();
  }

  showScreen(screenName) {
    // Cancel any pending transition and remove animation classes to prevent race conditions
    if (this.pendingTransition) {
      clearTimeout(this.pendingTransition);
      this.pendingTransition = null;
      // Remove animation classes from all screens to cancel ongoing CSS animations
      this._screenElements.forEach(s => {
        s.classList.remove('screen-fade-out', 'screen-fade-in');
      });
    }

    const newScreen = document.getElementById(`${screenName}-screen`);
    if (!newScreen) return;

    const currentScreen = this.currentScreen ? document.getElementById(`${this.currentScreen}-screen`) : null;

    // If transitioning from menu, re-enable menu buttons
    if (this.currentScreen === 'menu' && screenName !== 'menu') {
      this.enableMenuButtons();
    }

    // If there's a current screen, fade it out first
    if (currentScreen && currentScreen !== newScreen) {
      currentScreen.classList.add('screen-fade-out');

      // After fade out, switch screens
      this.pendingTransition = setTimeout(() => {
        this.pendingTransition = null;
        // Hide all screens (use cached elements)
        this._screenElements.forEach(s => {
          s.classList.remove('active', 'screen-fade-out', 'screen-fade-in');
        });

        // Show new screen with fade in
        newScreen.classList.add('active', 'screen-fade-in');
        this.currentScreen = screenName;
      }, 200); // Slightly shorter than CSS animation for smoother transition
    } else {
      // No current screen, just show the new one (use cached elements)
      this._screenElements.forEach(s => {
        s.classList.remove('active', 'screen-fade-out', 'screen-fade-in');
      });
      newScreen.classList.add('active', 'screen-fade-in');
      this.currentScreen = screenName;
    }
  }

  updateLobby(lobbyData) {
    this.lobby.update(lobbyData);
  }

  updateHUD(state, isSpectating = false) {
    if (!state) return;

    // Find local player data
    const playerData = state.p?.find(p => p[0] === this.game.myId);
    if (!playerData) return;

    const [id, x, y, facing, flashlight, hearts, hasAmmo, stunned, invincible] = playerData;

    // Update spectating indicator
    this.updateSpectatingIndicator(isSpectating);

    // Update hearts display
    // Note: Heart symbols are rendered using Unicode characters. Spacing between hearts
    // is controlled by CSS letter-spacing on #hearts-display (see styles.css).
    // If hearts appear too close together, adjust letter-spacing in CSS.
    const heartsDisplay = document.getElementById('hearts-display');
    if (heartsDisplay) {
      const heartCount = Math.max(0, hearts);
      heartsDisplay.textContent = '\u2665'.repeat(heartCount);
      heartsDisplay.setAttribute('aria-label', heartCount + ' ' + (heartCount === 1 ? 'life' : 'lives') + ' remaining');
    }

    // Update ammo display
    // Note: Ammo indicator uses Unicode circles. Styling and size are controlled
    // by CSS on #ammo-display (see styles.css).
    const ammoDisplay = document.getElementById('ammo-display');
    if (ammoDisplay) {
      ammoDisplay.textContent = hasAmmo ? '\u25CF' : '\u25CB';
      ammoDisplay.classList.toggle('has-ammo', !!hasAmmo);
      ammoDisplay.setAttribute('aria-label', hasAmmo ? 'Pillow ready to throw' : 'No ammo');
    }

    // Update timer
    const timerDisplay = document.getElementById('timer-display');
    if (timerDisplay && state.time !== undefined) {
      const minutes = Math.floor(state.time / 60);
      const seconds = state.time % 60;
      timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      // Add warning class when time is low
      const isWarning = state.time <= 30;
      timerDisplay.classList.toggle('warning', isWarning);
      // Play warning sound once when crossing the 30-second threshold
      if (isWarning && !this.warningPlayed) {
        this.warningPlayed = true;
        this.game.audio?.play('warning');
      } else if (!isWarning) {
        // Reset flag when timer is above 30 seconds (for new rounds)
        this.warningPlayed = false;
      }
      // Enable aria-live for screen readers when time is critical
      timerDisplay.setAttribute('aria-live', isWarning ? 'polite' : 'off');
      timerDisplay.setAttribute('aria-label', `${minutes} minutes ${seconds} seconds remaining`);
    }

    // Update player name display
    const nameDisplay = document.getElementById('player-name-display');
    if (nameDisplay) {
      const playerInfo = this.game.lobbyData?.players?.find(p => p.id === this.game.myId);
      if (playerInfo) {
        nameDisplay.textContent = playerInfo.name;
      }
    }

    // Update scoreboard
    this.updateScoreboard(state);
  }

  updateScoreboard(state) {
    const scoreboard = document.getElementById('scoreboard');
    if (!scoreboard || !state.p) return;

    // Clear existing
    scoreboard.innerHTML = '';

    // Add each player
    for (const pData of state.p) {
      const [id, , , , , hearts] = pData;
      const playerInfo = this.game.lobbyData?.players?.find(p => p.id === id);

      const item = document.createElement('div');
      item.className = 'scoreboard-item';
      if (id === this.game.myId) item.classList.add('self');
      if (hearts <= 0) item.classList.add('eliminated');

      const name = playerInfo?.name || 'Player';
      const color = playerInfo?.color || '#ffffff';

      const colorSpan = document.createElement('span');
      colorSpan.className = 'player-color';
      colorSpan.style.background = color;
      item.appendChild(colorSpan);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = name;
      item.appendChild(nameSpan);

      const heartsSpan = document.createElement('span');
      heartsSpan.className = 'player-hearts';
      heartsSpan.textContent = '\u2665'.repeat(Math.max(0, hearts));
      item.appendChild(heartsSpan);

      scoreboard.appendChild(item);
    }
  }

  updateSpectatingIndicator(isSpectating) {
    // Find or create spectating indicator element
    let indicator = document.getElementById('spectating-indicator');

    if (isSpectating) {
      if (!indicator) {
        // Create indicator if it doesn't exist
        indicator = document.createElement('div');
        indicator.id = 'spectating-indicator';
        indicator.className = 'spectating-indicator';
        indicator.textContent = 'SPECTATING';
        indicator.setAttribute('aria-live', 'polite');

        // Add to HUD top
        const hudLeft = document.getElementById('hud-left');
        if (hudLeft) {
          hudLeft.appendChild(indicator);
        }
      }
      indicator.style.display = 'block';
    } else if (indicator) {
      indicator.style.display = 'none';
    }
  }

  showPauseMenu() {
    const overlay = document.getElementById('pause-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
    }
  }

  hidePauseMenu() {
    const overlay = document.getElementById('pause-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  togglePause() {
    if (this.game.state === 'playing') {
      this.game.network.pause();
    } else if (this.game.state === 'paused') {
      this.game.network.resume();
    }
  }

  showGameOver(winner, scores) {
    // Update winner text
    const winnerText = document.getElementById('winner-text');
    if (winnerText) {
      if (winner) {
        const winnerInfo = this.game.lobbyData?.players?.find(p => p.id === winner);
        const winnerName = winnerInfo?.name || 'Someone';
        winnerText.textContent = `${winnerName} Wins!`;
      } else {
        winnerText.textContent = "It's a Draw!";
      }
    }

    // Update final scoreboard
    const finalScoreboard = document.getElementById('final-scoreboard');
    if (finalScoreboard && scores) {
      finalScoreboard.innerHTML = '';

      // Sort by kills, then by deaths (ascending)
      const sorted = [...scores].sort((a, b) => {
        if (b.kills !== a.kills) return b.kills - a.kills;
        return a.deaths - b.deaths;
      });

      for (const score of sorted) {
        const row = document.createElement('div');
        row.className = 'score-row';
        if (score.id === this.game.myId) row.classList.add('self');
        if (score.id === winner) row.classList.add('winner');

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

    this.showScreen('gameover');
  }

  showCountdown(count) {
    const overlay = document.getElementById('countdown-overlay');
    const number = document.getElementById('countdown-number');

    if (overlay && number) {
      overlay.style.display = 'flex';
      number.textContent = count;
    }
  }

  hideCountdown() {
    const overlay = document.getElementById('countdown-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  bindMenuEvents() {
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const playerNameInput = document.getElementById('player-name');
    const roomCodeInput = document.getElementById('room-code-input');

    if (createRoomBtn) {
      const createHandler = () => {
        const name = playerNameInput?.value.trim() || (typeof PLAYER_NAMES !== 'undefined' ? PLAYER_NAMES.generateName() : 'Player');
        if (name) {
          this.clearError();
          // Disable button to prevent spam-clicking
          createRoomBtn.disabled = true;
          createRoomBtn.classList.add('loading');
          this.game.network.createRoom(name);
        }
      };
      createRoomBtn.addEventListener('click', createHandler);
      this.boundHandlers.menu.push({ element: createRoomBtn, event: 'click', handler: createHandler });
    }

    if (joinRoomBtn) {
      const joinHandler = () => {
        const name = playerNameInput?.value.trim() || (typeof PLAYER_NAMES !== 'undefined' ? PLAYER_NAMES.generateName() : 'Player');
        const code = roomCodeInput?.value.trim().toUpperCase();

        if (!code || code.length !== 4) {
          this.showError('Please enter a valid 4-letter room code');
          return;
        }

        this.clearError();
        // Disable button to prevent spam-clicking
        joinRoomBtn.disabled = true;
        joinRoomBtn.classList.add('loading');
        this.game.network.joinRoom(code, name);
      };
      joinRoomBtn.addEventListener('click', joinHandler);
      this.boundHandlers.menu.push({ element: joinRoomBtn, event: 'click', handler: joinHandler });
    }

    // Allow Enter key to submit room code
    if (roomCodeInput) {
      const roomCodeKeyHandler = (e) => {
        if (e.key === 'Enter') {
          joinRoomBtn?.click();
        }
      };
      roomCodeInput.addEventListener('keydown', roomCodeKeyHandler);
      this.boundHandlers.menu.push({ element: roomCodeInput, event: 'keydown', handler: roomCodeKeyHandler });
    }

    // Allow Enter key to create room from name input
    if (playerNameInput) {
      const nameKeyHandler = (e) => {
        if (e.key === 'Enter' && !roomCodeInput?.value.trim()) {
          createRoomBtn?.click();
        }
      };
      playerNameInput.addEventListener('keydown', nameKeyHandler);
      this.boundHandlers.menu.push({ element: playerNameInput, event: 'keydown', handler: nameKeyHandler });
    }
  }

  bindGameEvents() {
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const quitBtn = document.getElementById('quit-btn');
    const playAgainBtn = document.getElementById('play-again-btn');

    if (pauseBtn) {
      const pauseHandler = () => {
        this.game.network.pause();
      };
      pauseBtn.addEventListener('click', pauseHandler);
      this.boundHandlers.game.push({ element: pauseBtn, event: 'click', handler: pauseHandler });
    }

    if (resumeBtn) {
      const resumeHandler = () => {
        this.game.network.resume();
      };
      resumeBtn.addEventListener('click', resumeHandler);
      this.boundHandlers.game.push({ element: resumeBtn, event: 'click', handler: resumeHandler });
    }

    if (quitBtn) {
      const quitHandler = () => {
        this.game.network.quit();
        this.game.localPlayer = null;
        this.game.serverState = null;
        this.game.prevServerState = null;
        if (this.game.effects) {
          this.game.effects.clear();
        }
      };
      quitBtn.addEventListener('click', quitHandler);
      this.boundHandlers.game.push({ element: quitBtn, event: 'click', handler: quitHandler });
    }

    if (playAgainBtn) {
      const playAgainHandler = () => {
        if (this.game.autoReturnInterval) {
          clearInterval(this.game.autoReturnInterval);
          this.game.autoReturnInterval = null;
        }
        this.game.network.returnToLobby();
        this.game.localPlayer = null;
        this.game.serverState = null;
        this.game.prevServerState = null;
        // Transition game state from gameover to lobby
        if (!this.game.transitionState('lobby')) {
          // Force state if transition fails
          this.game.state = 'lobby';
        }
        this.showScreen('lobby');
      };
      playAgainBtn.addEventListener('click', playAgainHandler);
      this.boundHandlers.game.push({ element: playAgainBtn, event: 'click', handler: playAgainHandler });
    }
  }

  showError(message) {
    const errorEl = document.getElementById('menu-error');
    if (errorEl) {
      errorEl.textContent = message;
    }
    // Re-enable menu buttons on error
    this.enableMenuButtons();
  }

  clearError() {
    const errorEl = document.getElementById('menu-error');
    if (errorEl) {
      errorEl.textContent = '';
    }
  }

  // Re-enable menu buttons after async operation completes
  enableMenuButtons() {
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');

    if (createRoomBtn) {
      createRoomBtn.disabled = false;
      createRoomBtn.classList.remove('loading');
    }
    if (joinRoomBtn) {
      joinRoomBtn.disabled = false;
      joinRoomBtn.classList.remove('loading');
    }
  }

  // Cleanup all event listeners to prevent memory leaks
  cleanup() {
    // Clear pending timeouts and reset state flags
    if (this.pendingTransition) {
      clearTimeout(this.pendingTransition);
      this.pendingTransition = null;
    }
    this.warningPlayed = false;

    // Cleanup lobby (copyTimeout, copyInProgress, lobby event listeners)
    this.lobby.cleanup();

    // Remove spectating indicator if it exists
    const spectatingIndicator = document.getElementById('spectating-indicator');
    if (spectatingIndicator) {
      spectatingIndicator.remove();
    }

    // Remove all bound event listeners (menu and game)
    for (const category of Object.values(this.boundHandlers)) {
      for (const { element, event, handler } of category) {
        if (element) {
          element.removeEventListener(event, handler);
        }
      }
    }
    this.boundHandlers = { menu: [], game: [] };
  }
}
