// Server state buffering, sequence validation, interpolation timing, spectator detection
import { CONFIG } from './config.js';

export class StateManager {
  constructor() {
    this.serverState = null;
    this.prevServerState = null;
    this.stateTime = 0;
    this.lastServerSeq = -1;
    this.isSpectating = false;
    this.arenaInset = 0;

    // Debug counter
    this._stateCount = 0;
  }

  /**
   * Process an incoming server state packet.
   * Returns false if the packet should be ignored (out of order).
   * @param {Object} state - Server state packet
   * @returns {boolean} true if state was accepted
   */
  processServerState(state) {
    if (!state || typeof state !== 'object') return false;

    if (state.seq === undefined) {
      console.warn('[StateManager] Received state packet without sequence number, ignoring');
      return false;
    }

    // Check sequence number for out-of-order packets (with wraparound handling)
    const MAX_SEQ = 0xFFFFFFFF;
    const HALF_SEQ = 0x80000000;

    if (this.lastServerSeq !== -1) {
      const forwardDist = (state.seq - this.lastServerSeq + MAX_SEQ + 1) & MAX_SEQ;
      if (forwardDist > HALF_SEQ) {
        return false; // Out of order
      }
    }
    this.lastServerSeq = state.seq;

    // Debug logging
    if (CONFIG.DEBUG) {
      this._stateCount++;
      if (this._stateCount === 1 || this._stateCount % 20 === 0) {
        console.log('[StateManager] onServerState #' + this._stateCount + ':', {
          seq: state.seq,
          gameState: state.s,
          playerCount: state.p?.length,
          pickups: state.k?.length || 0,
          projectiles: state.j?.length || 0,
        });
      }
    }

    // Store for interpolation
    this.prevServerState = this.serverState;
    this.serverState = state;
    this.stateTime = 0;

    // Update arena inset from server
    if (state.inset !== undefined) {
      this.arenaInset = state.inset;
    }

    return true;
  }

  /**
   * Advance interpolation timer
   * @param {number} dtMs - Delta time in milliseconds
   */
  advanceInterpolation(dtMs) {
    this.stateTime += dtMs;
  }

  /**
   * Check if local player should enter spectator mode
   * @param {string} myId - Local player's socket ID
   * @returns {boolean} true if just entered spectator mode this call
   */
  checkSpectatorMode(myId) {
    const state = this.serverState;
    if (!state || !state.p) return false;

    const myPlayerData = state.p.find(p => p[0] === myId);
    if (!myPlayerData) return false;
    if (!Array.isArray(myPlayerData) || myPlayerData.length < 6) return false;

    const hearts = myPlayerData[5];

    if (hearts <= 0 && !this.isSpectating) {
      this.isSpectating = true;
      console.log('[StateManager] Entered spectator mode');
      return true;
    }

    return false;
  }

  /**
   * Reset all state (for new game or disconnect)
   */
  reset() {
    this.serverState = null;
    this.prevServerState = null;
    this.stateTime = 0;
    this.lastServerSeq = -1;
    this.isSpectating = false;
    this.arenaInset = 0;
    this._stateCount = 0;
  }

  /**
   * Reset sequence only (for new game start)
   */
  resetSequence() {
    this.lastServerSeq = -1;
  }

  /**
   * Reset spectator mode (for new game start)
   */
  resetSpectator() {
    this.isSpectating = false;
  }
}
