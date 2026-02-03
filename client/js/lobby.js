// Lobby UI management - player list, settings, room codes
export class Lobby {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;  // Reference to parent UI for showScreen, showError, clearError
    this.copyTimeout = null;
    this.copyInProgress = false;
    this.boundHandlers = [];

    this.bindEvents();
  }

  update(lobbyData) {
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
      // Note: When nonHostPlayers is empty (solo host), [].every() returns true (vacuous truth).
      // This is intentional - it allows the host to start a solo game without waiting for
      // other players to ready up. The enoughPlayers check below ensures at least the host exists.
      const allNonHostReady = nonHostPlayers.every(p => p.ready);
      const enoughPlayers = lobbyData.players.length >= 2;

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

  bindEvents() {
    const readyBtn = document.getElementById('ready-btn');
    const startBtn = document.getElementById('start-btn');
    const leaveBtn = document.getElementById('leave-btn');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const playersList = document.getElementById('players-list');

    if (readyBtn) {
      const readyHandler = () => {
        this.game.network.toggleReady();
      };
      readyBtn.addEventListener('click', readyHandler);
      this.boundHandlers.push({ element: readyBtn, event: 'click', handler: readyHandler });
    }

    if (startBtn) {
      const startHandler = () => {
        this.game.network.startGame();
      };
      startBtn.addEventListener('click', startHandler);
      this.boundHandlers.push({ element: startBtn, event: 'click', handler: startHandler });
    }

    if (leaveBtn) {
      const leaveHandler = () => {
        this.game.network.quit();
        this.game.roomCode = null;
        this.game.lobbyData = null;
        this.game.isHost = false;
        this.ui.showScreen('menu');
      };
      leaveBtn.addEventListener('click', leaveHandler);
      this.boundHandlers.push({ element: leaveBtn, event: 'click', handler: leaveHandler });
    }

    if (copyCodeBtn) {
      const copyHandler = () => {
        // Guard against rapid clicks: ignore clicks while a clipboard operation is in progress.
        // This prevents multiple async clipboard.writeText promises from racing and causing
        // inconsistent button text states.
        if (this.copyInProgress) return;

        const codeDisplay = document.getElementById('room-code-display');
        const code = this.game.roomCode || codeDisplay?.textContent;
        if (code && code !== '----') {
          this.copyInProgress = true;
          navigator.clipboard.writeText(code).then(() => {
            this.copyInProgress = false;
            // Clear any existing timeout to reset the timer on successful copy.
            // This handles the case where a user clicks again after the guard is released
            // but before the timeout fires - the "Copied!" display will be extended.
            if (this.copyTimeout) {
              clearTimeout(this.copyTimeout);
            }
            copyCodeBtn.textContent = 'Copied!';
            this.copyTimeout = setTimeout(() => {
              copyCodeBtn.textContent = 'Copy';
              this.copyTimeout = null;
            }, 2000);
          }).catch(() => {
            this.copyInProgress = false;
            // Fallback: select the code text and inform user
            if (codeDisplay) {
              const range = document.createRange();
              range.selectNodeContents(codeDisplay);
              const sel = window.getSelection();
              if (sel) {
                sel.removeAllRanges();
                sel.addRange(range);
              }
              // Show feedback to user about manual copy
              if (this.copyTimeout) {
                clearTimeout(this.copyTimeout);
              }
              copyCodeBtn.textContent = 'Press Ctrl+C';
              this.copyTimeout = setTimeout(() => {
                copyCodeBtn.textContent = 'Copy';
                this.copyTimeout = null;
              }, 3000);
            }
          });
        }
      };
      copyCodeBtn.addEventListener('click', copyHandler);
      this.boundHandlers.push({ element: copyCodeBtn, event: 'click', handler: copyHandler });
    }

    // Kick button delegation
    if (playersList) {
      const kickHandler = (e) => {
        if (e.target.classList.contains('kick-btn')) {
          const playerId = e.target.dataset.id;
          if (playerId) {
            this.game.network.kickPlayer(playerId);
          }
        }
      };
      playersList.addEventListener('click', kickHandler);
      this.boundHandlers.push({ element: playersList, event: 'click', handler: kickHandler });
    }

    // Settings inputs
    const livesInput = document.getElementById('lives-setting');
    const timeInput = document.getElementById('time-setting');

    if (livesInput) {
      const livesHandler = () => {
        const lives = parseInt(livesInput.value, 10);
        if (lives >= 1 && lives <= 5) {
          this.game.network.updateSettings({ lives });
        }
      };
      livesInput.addEventListener('change', livesHandler);
      this.boundHandlers.push({ element: livesInput, event: 'change', handler: livesHandler });
    }

    if (timeInput) {
      const timeHandler = () => {
        const timeLimit = parseInt(timeInput.value, 10);
        if (timeLimit >= 60 && timeLimit <= 300) {
          this.game.network.updateSettings({ timeLimit });
        }
      };
      timeInput.addEventListener('change', timeHandler);
      this.boundHandlers.push({ element: timeInput, event: 'change', handler: timeHandler });
    }
  }

  cleanup() {
    if (this.copyTimeout) {
      clearTimeout(this.copyTimeout);
      this.copyTimeout = null;
    }
    this.copyInProgress = false;
    for (const { element, event, handler } of this.boundHandlers) {
      if (element) {
        element.removeEventListener(event, handler);
      }
    }
    this.boundHandlers = [];
  }
}
