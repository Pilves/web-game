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

    // Vision
    FLASHLIGHT_RANGE: 200,        // px
    FLASHLIGHT_ANGLE: 60,         // degrees

    // Game
    DEFAULT_LIVES: 3,
    MAX_LIVES: 5,
    DEFAULT_TIME_LIMIT: 180,      // seconds
    MIN_TIME_LIMIT: 60,
    MAX_TIME_LIMIT: 300,
    MIN_PLAYERS: 2,               // Minimum 2 players required to start
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
      { x: 100, y: 100 },   // P1 - top left
      { x: 1100, y: 100 },  // P2 - top right
      { x: 100, y: 700 },   // P3 - bottom left
      { x: 1100, y: 700 },  // P4 - bottom right
    ],

    // Pillow spawn points
    PILLOW_SPAWNS: [
      { x: 300, y: 200 },
      { x: 900, y: 200 },
      { x: 300, y: 600 },
      { x: 900, y: 600 },
    ],

    // Obstacles (beds and table) - must match CSS positions!
    // CSS: beds are 120x80, positioned 80px from edges
    // CSS: table is 100x100, centered at 50% 50%
    OBSTACLES: [
      { x: 80, y: 80, width: 120, height: 80, type: 'bed' },       // Top-left bed
      { x: 1000, y: 80, width: 120, height: 80, type: 'bed' },     // Top-right bed (1200-80-120)
      { x: 80, y: 640, width: 120, height: 80, type: 'bed' },      // Bottom-left bed (800-80-80)
      { x: 1000, y: 640, width: 120, height: 80, type: 'bed' },    // Bottom-right bed
      { x: 550, y: 350, width: 100, height: 100, type: 'table' },  // Center table (centered)
    ],
  };
}));
