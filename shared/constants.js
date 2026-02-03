// shared/constants.js - Works in both Node.js and browser
(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SHARED_CONSTANTS = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  return {
    // Arena
    ARENA_WIDTH: 1200,
    ARENA_HEIGHT: 800,

    // Player
    PLAYER_SIZE: 40,
    PLAYER_SPEED: 180,            // px/sec
    PLAYER_SPRINT_SPEED: 280,     // px/sec

    // Combat
    PROJECTILE_SIZE: 20,
    PICKUP_SIZE: 30,          // Visual and collision size for ground pickups

    // Vision
    FLASHLIGHT_RANGE: 200,        // px
    FLASHLIGHT_ANGLE: 60,         // degrees
    FLASHLIGHT_FLICKER_THRESHOLD: 1000, // ms - when flashlight starts flickering (used by both server and client)

    // Game
    DEFAULT_LIVES: 3,
    MAX_LIVES: 7,
    DEFAULT_TIME_LIMIT: 180,      // seconds
    MIN_TIME_LIMIT: 60,
    MAX_TIME_LIMIT: 300,
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 4,

    // Colors for players
    PLAYER_COLORS: [
      '#ff6b6b',  // Coral red - P1
      '#4ecdc4',  // Teal - P2
      '#ffe66d',  // Gold - P3
      '#c3aed6',  // Lavender - P4
    ],

    // Spawn points
    SPAWN_POINTS: [
      { x: 250, y: 250 },   // P1 - top left quadrant
      { x: 950, y: 250 },   // P2 - top right quadrant
      { x: 250, y: 550 },   // P3 - bottom left quadrant
      { x: 950, y: 550 },   // P4 - bottom right quadrant
    ],

    // Pillow spawn points
    PILLOW_SPAWNS: [
      { x: 300, y: 200 },
      { x: 900, y: 200 },
      { x: 300, y: 600 },
      { x: 900, y: 600 },
    ],

    OBSTACLES: [
      { x: 80, y: 80, width: 120, height: 80, type: 'bed' },       // Top-left bed
      { x: 1000, y: 80, width: 120, height: 80, type: 'bed' },     // Top-right bed (1200-80-120)
      { x: 80, y: 640, width: 120, height: 80, type: 'bed' },      // Bottom-left bed (800-80-80)
      { x: 1000, y: 640, width: 120, height: 80, type: 'bed' },    // Bottom-right bed
      { x: 550, y: 350, width: 100, height: 100, type: 'table' },  // Center table (centered)
    ],
  };
}));
