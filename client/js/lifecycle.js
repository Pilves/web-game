// Network event callbacks that drive game state transitions
// Each function receives the game object as first parameter

import { audio } from './audio.js';
import { effects } from './effects.js';

export function onRoomCreated(game, data) {
  if (!game.transitionState('lobby')) {
    console.warn('[Lifecycle] Cannot transition to lobby from current state:', game.state);
    return;
  }
  game.isHost = true;
  game.ui.showScreen('lobby');
  game.updateRoomCodeDisplay(data.code);
}

export function onJoinError(game, message) {
  game.ui.showError(message);
}

export function onLobbyUpdate(game, data) {
  game.lobbyData = data;
  game.isHost = data.host === game.myId;

  if (game.state === 'menu') {
    if (game.transitionState('lobby')) {
      game.ui.showScreen('lobby');
    }
  }

  game.ui.updateLobby(data);
}

export function onKicked(game) {
  game.roomCode = null;
  game.lobbyData = null;
  game.isHost = false;
  game.lastServerSeq = -1;
  game.ui.showScreen('menu');
  game.state = 'menu';

  const errorEl = document.getElementById('menu-error');
  if (errorEl) {
    errorEl.textContent = 'You were kicked from the room';
  }
}

export function onCountdown(game, count) {
  console.log('[Lifecycle] onCountdown:', count);

  if (game.state !== 'countdown' && !game.transitionState('countdown')) {
    console.warn('[Lifecycle] Cannot start countdown from current state:', game.state);
    return;
  }

  game.ui.showScreen('game');

  const overlay = document.getElementById('countdown-overlay');
  const number = document.getElementById('countdown-number');

  if (overlay && number) {
    overlay.style.display = 'flex';
    number.textContent = count;
    audio.play('countdown');
  }
}

export function onGameStart(game, data) {
  console.log('[Lifecycle] onGameStart called');

  if (!game.transitionState('playing')) {
    console.warn('[Lifecycle] Cannot start game from current state:', game.state);
    return;
  }

  game.lastServerSeq = -1;
  game.isSpectating = false;

  const arena = document.getElementById('arena');
  if (arena) {
    arena.classList.remove('spectating');
  }

  const overlay = document.getElementById('countdown-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }

  // Convert game-start format to state format
  if (data && (data.p || data.players)) {
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
    game.onServerState(stateData);
  } else {
    console.warn('[Lifecycle] WARNING: No player data in game-start event!');
  }

  audio.play('start');
  game.input.reset();
  console.log('[Lifecycle] Game started. localPlayer:', game.localPlayer);
}

export function onCountdownCancelled(game, reason) {
  console.log('[Lifecycle] Countdown cancelled:', reason);

  if (!game.transitionState('lobby')) {
    game.state = 'lobby';
  }

  game.ui.showScreen('lobby');

  const overlay = document.getElementById('countdown-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }

  game.showNotification(reason || 'Countdown cancelled');
}

export function onGamePaused(game, pausedBy) {
  if (!game.transitionState('paused')) {
    console.warn('[Lifecycle] Cannot pause from current state:', game.state);
    return;
  }

  const overlay = document.getElementById('pause-overlay');
  const pausedByText = document.getElementById('paused-by-text');

  if (overlay) {
    overlay.style.display = 'flex';
  }

  if (pausedByText) {
    const playerName = game.lobbyData?.players?.find(p => p.id === pausedBy)?.name || 'Someone';
    pausedByText.textContent = `Paused by: ${playerName}`;
  }
}

export function onGameResumed(game, data) {
  if (!game.transitionState('playing')) {
    console.warn('[Lifecycle] Cannot resume from current state:', game.state);
    return;
  }

  const overlay = document.getElementById('pause-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }

  // Show who resumed the game to all players
  const playerName = data?.name
    || game.lobbyData?.players?.find(p => p.id === data?.by)?.name
    || 'Someone';
  game.showNotification(`${playerName} resumed the game`);
}

export function onPlayerQuit(game, data) {
  game.showNotification(`${data.name} left the game`);
}

export function onSuddenDeath(game) {
  game.showNotification('SUDDEN DEATH - Arena is shrinking!');
  audio.play('sudden-death');

  const arena = document.getElementById('arena');
  if (arena) {
    arena.classList.add('sudden-death');
  }
}

export function onGameOver(game, data) {
  if (!game.transitionState('gameover')) {
    game.state = 'gameover';
  }
  game.ui.showScreen('gameover');

  const winnerText = document.getElementById('winner-text');
  if (winnerText) {
    if (data.winner) {
      const winnerName = data.winner.name || 'Someone';
      winnerText.textContent = `${winnerName} Wins!`;
      if (data.winner.id === game.myId) {
        audio.play('victory');
      }
    } else {
      winnerText.textContent = "It's a Draw!";
    }
  }

  const finalScoreboard = document.getElementById('final-scoreboard');
  if (finalScoreboard && data.players) {
    finalScoreboard.innerHTML = '';

    const sorted = [...data.players].sort((a, b) => {
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.deaths - b.deaths;
    });

    for (const score of sorted) {
      const row = document.createElement('div');
      row.className = 'score-row';
      if (score.id === game.myId) row.classList.add('self');
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

  effects.clear();

  // Auto-return countdown
  const autoReturnText = document.getElementById('auto-return-text');
  let remaining = data.autoReturnSeconds || 15;
  if (autoReturnText) {
    autoReturnText.textContent = `Returning to lobby in ${remaining}s...`;
  }
  if (game.autoReturnInterval) clearInterval(game.autoReturnInterval);
  game.autoReturnInterval = setInterval(() => {
    remaining--;
    if (autoReturnText) {
      autoReturnText.textContent = `Returning to lobby in ${remaining}s...`;
    }
    if (remaining <= 0) {
      clearInterval(game.autoReturnInterval);
      game.autoReturnInterval = null;
    }
  }, 1000);
}

export function onReturnToLobby(game) {
  game.network.returnToLobby();
  game.localPlayer = null;
  game.serverState = null;
  game.prevServerState = null;
  if (!game.transitionState('lobby')) {
    game.state = 'lobby';
  }
  game.ui.showScreen('lobby');
}

export function onDisconnect(game) {
  console.log('[Lifecycle] onDisconnect called, current state:', game.state);

  game.stopGameLoop();

  if (game.input) {
    game.input.reset();
  }

  if (game.renderer) {
    game.renderer.clear();
  }

  if (game.effects) {
    game.effects.clear();
  }

  game.ui.showScreen('menu');
  game.state = 'menu';
  game.localPlayer = null;
  game.serverState = null;
  game.prevServerState = null;
  game.lastServerSeq = -1;
  game.isSpectating = false;

  const arena = document.getElementById('arena');
  if (arena) {
    arena.classList.remove('spectating');
  }

  const errorEl = document.getElementById('menu-error');
  if (errorEl) {
    errorEl.textContent = 'Disconnected from server';
  }
}

export function onReconnect(game) {
  console.log('[Lifecycle] onReconnect called, current state:', game.state);

  const canRestore = game.validateReconnectState();

  if (!canRestore) {
    console.log('[Lifecycle] Cannot restore previous state, staying in menu');
    game.roomCode = null;
    game.lobbyData = null;
    game.isHost = false;
    return;
  }

  game.startGameLoop();
  console.log('[Lifecycle] Reconnect complete, waiting for server state');
}
