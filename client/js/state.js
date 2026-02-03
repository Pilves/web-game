// Server state buffering, sequence validation, interpolation timing, spectator detection

export class StateManager {
  constructor() {
    this.serverState = null;
    this.prevServerState = null;
    this.stateTime = 0;
    this.lastServerSeq = -1;
    this.isSpectating = false;
    this.arenaInset = 0;
  }

  processServerState(state) {
    if (!state || typeof state !== 'object') return false;

    if (state.seq === undefined) {
      console.warn('[StateManager] Received state packet without sequence number, ignoring');
      return false;
    }

    const MAX_SEQ = 0xFFFFFFFF;
    const HALF_SEQ = 0x80000000;

    if (this.lastServerSeq !== -1) {
      const forwardDist = (state.seq - this.lastServerSeq + MAX_SEQ + 1) & MAX_SEQ;
      if (forwardDist > HALF_SEQ) {
        return false;
      }
    }
    this.lastServerSeq = state.seq;

    this.prevServerState = this.serverState;
    this.serverState = state;
    this.stateTime = 0;

    if (state.inset !== undefined) {
      this.arenaInset = state.inset;
    }

    return true;
  }

  advanceInterpolation(dtMs) {
    this.stateTime += dtMs;
  }

  checkSpectatorMode(myId) {
    const state = this.serverState;
    if (!state || !state.p) return false;

    const myPlayerData = state.p.find(p => p[0] === myId);
    if (!myPlayerData) return false;
    if (!Array.isArray(myPlayerData) || myPlayerData.length < 6) return false;

    const hearts = myPlayerData[5];

    if (hearts <= 0 && !this.isSpectating) {
      this.isSpectating = true;
      return true;
    }

    return false;
  }

  reset() {
    this.serverState = null;
    this.prevServerState = null;
    this.stateTime = 0;
    this.lastServerSeq = -1;
    this.isSpectating = false;
    this.arenaInset = 0;
  }

  resetSequence() {
    this.lastServerSeq = -1;
  }

  resetSpectator() {
    this.isSpectating = false;
  }
}
