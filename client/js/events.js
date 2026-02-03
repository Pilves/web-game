// Game event dispatching - routes server events to audio/visual effects
import { audio } from './audio.js';
import { effects } from './effects.js';

function findPlayerInState(state, playerId, playerMap = null) {
  if (!state || !state.p) return null;

  const playerData = playerMap
    ? playerMap.get(playerId)
    : state.p.find(p => p && p[0] === playerId);

  if (!playerData || playerData.length < 10) return null;

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

export function handleEvent(event, state, myId, localPlayer, playerMap = null) {
  const [type, ...data] = event;

  switch (type) {
    case 'hit': {
      const victimId = data[0];
      const victim = findPlayerInState(state, victimId, playerMap);
      if (victim) {
        effects.showImpactFlash(victim.x, victim.y);
        effects.triggerScreenShake();

        if (localPlayer) {
          audio.playPositional('hit-player', victim.x, victim.y,
            localPlayer.x, localPlayer.y);
        }
      } else {
        console.warn('[Events] handleEvent hit: Could not find victim in state, victimId:', victimId);
      }
      break;
    }

    case 'death': {
      const playerId = data[0];
      const player = findPlayerInState(state, playerId, playerMap);
      if (player) {
        if (localPlayer) {
          audio.playPositional('death', player.x, player.y,
            localPlayer.x, localPlayer.y);
        }
      } else {
        console.warn('[Events] handleEvent death: Could not find player in state, playerId:', playerId);
      }
      break;
    }

    case 'throw': {
      const playerId = data[0];
      const player = findPlayerInState(state, playerId, playerMap);
      if (player) {
        effects.triggerMuzzleFlash();

        if (playerId === myId) {
          audio.play('throw', 0.8);
        } else if (localPlayer) {
          audio.playPositional('throw', player.x, player.y,
            localPlayer.x, localPlayer.y, 0.8);
        }
      } else {
        console.warn('[Events] handleEvent throw: Could not find player in state, playerId:', playerId);
      }
      break;
    }

    case 'pickup': {
      const playerId = data[0];
      const pickupId = data[1];
      if (playerId === myId) {
        audio.play('pickup');
      } else if (localPlayer && state?.k) {
        const pickup = state.k.find(p => p[0] === pickupId);
        if (pickup && Array.isArray(pickup) && pickup.length >= 3 &&
            typeof pickup[1] === 'number' && typeof pickup[2] === 'number') {
          audio.playPositional('pickup', pickup[1], pickup[2],
            localPlayer.x, localPlayer.y);
        } else if (!pickup) {
          console.warn('[Events] handleEvent pickup: Could not find pickup in state, pickupId:', pickupId);
        } else {
          console.warn('[Events] handleEvent pickup: Invalid pickup data structure, pickupId:', pickupId, 'pickup:', pickup);
        }
      } else if (localPlayer && !state?.k) {
        console.warn('[Events] handleEvent pickup: State has no pickups array');
      }
      break;
    }

    case 'sound': {
      const [soundType, x, y, playerId] = data;
      effects.showSoundRipple(x, y, soundType);

      const soundName = soundType === 'footstep' ? 'footstep-heavy' : soundType;
      if (playerId === myId) {
        audio.play(soundName, 0.4);
      } else if (localPlayer) {
        audio.playPositional(soundName, x, y,
          localPlayer.x, localPlayer.y);
      }
      break;
    }

    case 'flashlight': {
      const playerId = data[0];
      if (playerId === myId) {
        audio.play('flashlight', 0.5);
      }
      break;
    }

    default: {
      console.warn('[Events] handleEvent: Unknown event type:', type, 'data:', data);
      break;
    }
  }
}

export { findPlayerInState };
