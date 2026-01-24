// Screen management and UI updates
export class UI {
  constructor(game) {
    this.game = game;
    this.currentScreen = null;

    this.bindMenuEvents();
    this.bindLobbyEvents();
    this.bindGameEvents();
  }

  showScreen(screenName) {
    const currentScreen = document.querySelector('.screen.active');
    const newScreen = document.getElementById(`${screenName}-screen`);

    if (!newScreen) return;

    // If transitioning from menu, re-enable menu buttons
    if (this.currentScreen === 'menu' && screenName !== 'menu') {
      this.enableMenuButtons();
    }

    // If there's a current screen, fade it out first
    if (currentScreen && currentScreen !== newScreen) {
      currentScreen.classList.add('screen-fade-out');

      // After fade out, switch screens
      setTimeout(() => {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(s => {
          s.classList.remove('active', 'screen-fade-out', 'screen-fade-in');
        });

        // Show new screen with fade in
        newScreen.classList.add('active', 'screen-fade-in');
        this.currentScreen = screenName;
      }, 200); // Slightly shorter than CSS animation for smoother transition
    } else {
      // No current screen, just show the new one
      document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active', 'screen-fade-out', 'screen-fade-in');
      });
      newScreen.classList.add('active', 'screen-fade-in');
      this.currentScreen = screenName;
    }
  }

  updateLobby(lobbyData) {
    if (!lobbyData || !lobbyData.players) return;

    // Update room code display
    const codeDisplay = document.getElementById('room-code-display');
    if (codeDisplay) {
      codeDisplay.textContent = lobbyData.code || '----';
    }

    // Update players list
    const playersList = document.getElementById('players-list');
    if (playersList) {
      playersList.innerHTML = '';

      for (const player of lobbyData.players) {
        const item = document.createElement('div');
        item.className = 'player-item';
        item.setAttribute('role', 'listitem');
        if (player.ready) item.classList.add('ready');
        if (player.id === this.game.myId) item.classList.add('self');
        if (player.id === lobbyData.host) item.classList.add('host');

        const isHost = this.game.isHost;
        const canKick = isHost && player.id !== this.game.myId;

        // Build aria-label for the player item
        const statusText = player.ready ? 'Ready' : 'Not Ready';
        const hostText = player.id === lobbyData.host ? ', Host' : '';
        const selfText = player.id === this.game.myId ? ' (You)' : '';
        item.setAttribute('aria-label', `${player.name}${selfText}${hostText}, ${statusText}`);

        const colorSpan = document.createElement('span');
        colorSpan.className = 'player-color';
        colorSpan.style.background = player.color;
        colorSpan.setAttribute('aria-hidden', 'true');
        item.appendChild(colorSpan);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'player-name';
        nameSpan.textContent = player.name;
        item.appendChild(nameSpan);

        const statusSpan = document.createElement('span');
        statusSpan.className = 'player-status';
        statusSpan.textContent = player.ready ? 'Ready' : 'Not Ready';
        item.appendChild(statusSpan);

        if (player.id === lobbyData.host) {
          const hostBadge = document.createElement('span');
          hostBadge.className = 'host-badge';
          hostBadge.textContent = 'HOST';
          item.appendChild(hostBadge);
        }

        if (canKick) {
          const kickBtn = document.createElement('button');
          kickBtn.className = 'kick-btn';
          kickBtn.dataset.id = player.id;
          kickBtn.textContent = 'Kick';
          kickBtn.setAttribute('aria-label', `Kick ${player.name} from lobby`);
          item.appendChild(kickBtn);
        }

        playersList.appendChild(item);
      }
    }

    // Update settings visibility (host only can edit)
    const settingsDiv = document.getElementById('lobby-settings');
    if (settingsDiv) {
      settingsDiv.style.display = this.game.isHost ? 'block' : 'none';
    }

    // Update settings inputs
    const livesInput = document.getElementById('lives-setting');
    const timeInput = document.getElementById('time-setting');

    if (livesInput && lobbyData.settings) {
      livesInput.value = lobbyData.settings.lives;
      livesInput.disabled = !this.game.isHost;
    }

    if (timeInput && lobbyData.settings) {
      timeInput.value = lobbyData.settings.timeLimit;
      timeInput.disabled = !this.game.isHost;
    }

    // Update start button (host only, enabled when all ready and 1+ players for solo testing)
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
      // For solo play: host just needs to be ready (or we skip ready check for host)
      // For multiplayer: all non-host players must be ready
      const nonHostPlayers = lobbyData.players.filter(p => p.id !== lobbyData.host);
      const allNonHostReady = nonHostPlayers.every(p => p.ready);
      const enoughPlayers = lobbyData.players.length >= 1; // Allow solo

      startBtn.disabled = !this.game.isHost || !allNonHostReady || !enoughPlayers;
      startBtn.style.display = this.game.isHost ? 'inline-block' : 'none';
    }

    // Update ready button text
    const readyBtn = document.getElementById('ready-btn');
    if (readyBtn) {
      const myPlayer = lobbyData.players.find(p => p.id === this.game.myId);
      readyBtn.textContent = myPlayer?.ready ? 'Not Ready' : 'Ready';
    }

    // Update lobby status
    const statusEl = document.getElementById('lobby-status');
    if (statusEl) {
      const readyCount = lobbyData.players.filter(p => p.ready).length;
      statusEl.textContent = `${readyCount}/${lobbyData.players.length} players ready`;
    }
  }

  updateHUD(state) {
    if (!state) return;

    // Find local player data
    const playerData = state.p?.find(p => p[0] === this.game.myId);
    if (!playerData) return;

    const [id, x, y, facing, flashlight, hearts, hasAmmo, stunned, invincible] = playerData;

    // Update hearts display
    const heartsDisplay = document.getElementById('hearts-display');
    if (heartsDisplay) {
      const heartCount = Math.max(0, hearts);
      heartsDisplay.textContent = '\u2665'.repeat(heartCount);
      heartsDisplay.setAttribute('aria-label', heartCount + ' ' + (heartCount === 1 ? 'life' : 'lives') + ' remaining');
    }

    // Update ammo display
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
      createRoomBtn.addEventListener('click', () => {
        const name = playerNameInput?.value.trim() || 'Player';
        if (name) {
          this.clearError();
          // Disable button to prevent spam-clicking
          createRoomBtn.disabled = true;
          createRoomBtn.classList.add('loading');
          this.game.network.createRoom(name);
        }
      });
    }

    if (joinRoomBtn) {
      joinRoomBtn.addEventListener('click', () => {
        const name = playerNameInput?.value.trim() || 'Player';
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
      });
    }

    // Allow Enter key to submit room code
    if (roomCodeInput) {
      roomCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          joinRoomBtn?.click();
        }
      });
    }

    // Allow Enter key to create room from name input
    if (playerNameInput) {
      playerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !roomCodeInput?.value.trim()) {
          createRoomBtn?.click();
        }
      });
    }
  }

  bindLobbyEvents() {
    const readyBtn = document.getElementById('ready-btn');
    const startBtn = document.getElementById('start-btn');
    const leaveBtn = document.getElementById('leave-btn');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const playersList = document.getElementById('players-list');

    if (readyBtn) {
      readyBtn.addEventListener('click', () => {
        this.game.network.toggleReady();
      });
    }

    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.game.network.startGame();
      });
    }

    if (leaveBtn) {
      leaveBtn.addEventListener('click', () => {
        this.game.network.quit();
        this.game.roomCode = null;
        this.game.lobbyData = null;
        this.game.isHost = false;
        this.showScreen('menu');
      });
    }

    if (copyCodeBtn) {
      copyCodeBtn.addEventListener('click', () => {
        const codeDisplay = document.getElementById('room-code-display');
        const code = this.game.roomCode || codeDisplay?.textContent;
        if (code && code !== '----') {
          navigator.clipboard.writeText(code).then(() => {
            copyCodeBtn.textContent = 'Copied!';
            setTimeout(() => {
              copyCodeBtn.textContent = 'Copy';
            }, 2000);
          }).catch(() => {
            // Fallback: select the code text and inform user
            if (codeDisplay) {
              const range = document.createRange();
              range.selectNodeContents(codeDisplay);
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(range);
              // Show feedback to user about manual copy
              copyCodeBtn.textContent = 'Press Ctrl+C';
              setTimeout(() => {
                copyCodeBtn.textContent = 'Copy';
              }, 3000);
            }
          });
        }
      });
    }

    // Kick button delegation
    if (playersList) {
      playersList.addEventListener('click', (e) => {
        if (e.target.classList.contains('kick-btn')) {
          const playerId = e.target.dataset.id;
          if (playerId) {
            this.game.network.kickPlayer(playerId);
          }
        }
      });
    }

    // Settings inputs
    const livesInput = document.getElementById('lives-setting');
    const timeInput = document.getElementById('time-setting');

    if (livesInput) {
      livesInput.addEventListener('change', () => {
        const lives = parseInt(livesInput.value, 10);
        if (lives >= 1 && lives <= 5) {
          this.game.network.updateSettings({ lives });
        }
      });
    }

    if (timeInput) {
      timeInput.addEventListener('change', () => {
        const timeLimit = parseInt(timeInput.value, 10);
        if (timeLimit >= 60 && timeLimit <= 300) {
          this.game.network.updateSettings({ timeLimit });
        }
      });
    }
  }

  bindGameEvents() {
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const quitBtn = document.getElementById('quit-btn');
    const playAgainBtn = document.getElementById('play-again-btn');

    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        this.game.network.pause();
      });
    }

    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        this.game.network.resume();
      });
    }

    if (quitBtn) {
      quitBtn.addEventListener('click', () => {
        this.game.network.quit();
        this.game.localPlayer = null;
        this.game.serverState = null;
        this.game.prevServerState = null;
        if (this.game.effects) {
          this.game.effects.clear();
        }
      });
    }

    if (playAgainBtn) {
      playAgainBtn.addEventListener('click', () => {
        this.game.network.returnToLobby();
        this.game.localPlayer = null;
        this.game.serverState = null;
        this.game.prevServerState = null;
        this.showScreen('lobby');
      });
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
}
