/**
 * Hitbox.js - Shared hitbox helpers for LIGHTS OUT
 * Reusable rect objects to reduce GC pressure
 */

const CONSTANTS = require('./constants.js');

// Reusable rect objects - populated by getPlayerRect/getProjectileRect
const _playerRect = { x: 0, y: 0, width: CONSTANTS.PLAYER_SIZE, height: CONSTANTS.PLAYER_SIZE };
const _projectileRect = { x: 0, y: 0, width: CONSTANTS.PROJECTILE_SIZE, height: CONSTANTS.PROJECTILE_SIZE };

/**
 * Get the bounding rectangle for a player (centered on position)
 * WARNING: Returns a reusable object - do not store reference, copy if needed
 * @param {Object} player - Player object with x, y properties
 * @returns {Object} Rectangle {x, y, width, height}
 */
function getPlayerRect(player) {
  _playerRect.x = player.x - CONSTANTS.PLAYER_SIZE / 2;
  _playerRect.y = player.y - CONSTANTS.PLAYER_SIZE / 2;
  return _playerRect;
}

/**
 * Get the bounding rectangle for a projectile (centered on position)
 * WARNING: Returns a reusable object - do not store reference, copy if needed
 * @param {Object} projectile - Projectile object with x, y properties
 * @returns {Object} Rectangle {x, y, width, height}
 */
function getProjectileRect(projectile) {
  _projectileRect.x = projectile.x - CONSTANTS.PROJECTILE_SIZE / 2;
  _projectileRect.y = projectile.y - CONSTANTS.PROJECTILE_SIZE / 2;
  return _projectileRect;
}

module.exports = { getPlayerRect, getProjectileRect };
