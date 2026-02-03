/**
 * RateLimiter.js - Generic cooldown and rate limiting utility
 *
 * Tracks cooldowns and per-window rate limits for any event type.
 * Used by GameManager (lobby/room events) and InputHandler (per-player input flood).
 */

class RateLimiter {
  constructor() {
    // key -> timestamp (for cooldown checks)
    this.cooldowns = new Map();
    // key -> { count, windowStart, lastWarning } (for window-based rate limits)
    this.windows = new Map();
  }

  /**
   * Check if an action is allowed based on cooldown
   * @param {string} key - Unique key (e.g., "socketId:event")
   * @param {number} cooldownMs - Cooldown in milliseconds
   * @returns {boolean} true if allowed, false if rate limited
   */
  checkCooldown(key, cooldownMs) {
    const now = Date.now();
    const last = this.cooldowns.get(key) || 0;
    if (now - last < cooldownMs) {
      return false;
    }
    this.cooldowns.set(key, now);
    return true;
  }

  /**
   * Check if an action is within a rate limit window
   * @param {string} key - Unique key (e.g., playerId)
   * @param {number} windowMs - Window duration in milliseconds
   * @param {number} maxCount - Maximum allowed actions in the window
   * @returns {boolean} true if allowed, false if rate limited
   */
  checkWindowLimit(key, windowMs, maxCount) {
    const now = Date.now();

    let tracking = this.windows.get(key);
    if (!tracking) {
      tracking = { count: 0, windowStart: now, lastWarning: 0 };
      this.windows.set(key, tracking);
    }

    // Reset window if expired
    if (now - tracking.windowStart >= windowMs) {
      tracking.windowStart = now;
      tracking.count = 1;
      return true;
    }

    tracking.count++;

    if (tracking.count > maxCount) {
      return false;
    }

    return true;
  }

  /**
   * Get the last warning timestamp for a window key (for throttled logging)
   * @param {string} key - The window key
   * @returns {number} Last warning timestamp
   */
  getLastWarning(key) {
    const tracking = this.windows.get(key);
    return tracking ? tracking.lastWarning : 0;
  }

  /**
   * Update the last warning timestamp for a window key
   * @param {string} key - The window key
   * @param {number} timestamp - The warning timestamp
   */
  setLastWarning(key, timestamp) {
    const tracking = this.windows.get(key);
    if (tracking) {
      tracking.lastWarning = timestamp;
    }
  }

  /**
   * Get the current count for a window key (for logging)
   * @param {string} key - The window key
   * @returns {number} Current count in window
   */
  getWindowCount(key) {
    const tracking = this.windows.get(key);
    return tracking ? tracking.count : 0;
  }

  /**
   * Clean up all entries matching a prefix (e.g., for a disconnected socket)
   * @param {string} prefix - Key prefix to match
   */
  cleanup(prefix) {
    for (const key of this.cooldowns.keys()) {
      if (key.startsWith(prefix)) {
        this.cooldowns.delete(key);
      }
    }
    for (const key of this.windows.keys()) {
      if (key.startsWith(prefix)) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Remove a specific key from both cooldowns and windows
   * @param {string} key - Key to remove
   */
  remove(key) {
    this.cooldowns.delete(key);
    this.windows.delete(key);
  }

  /**
   * Clean up stale entries older than threshold
   * @param {number} staleThresholdMs - Age threshold in milliseconds (default 5 minutes)
   */
  cleanupStale(staleThresholdMs = 300000) {
    const now = Date.now();
    for (const [key, timestamp] of this.cooldowns) {
      if (now - timestamp >= staleThresholdMs) {
        this.cooldowns.delete(key);
      }
    }
    for (const [key, tracking] of this.windows) {
      if (now - tracking.windowStart >= staleThresholdMs) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Clear all tracked state
   */
  clear() {
    this.cooldowns.clear();
    this.windows.clear();
  }
}

module.exports = RateLimiter;
