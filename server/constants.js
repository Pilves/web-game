// Server constants - imports shared and adds server-only constants
const SHARED = require('../shared/constants');

// Debug mode - set DEBUG=1 environment variable to enable verbose logging
const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

const CONSTANTS = {
  // Debug flag - controls verbose logging in hot paths
  DEBUG,

  // Import all shared constants
  ...SHARED,

  // Server-only: Tick rates
  PHYSICS_TICK_RATE: 60,        // Hz
  BROADCAST_RATE: 20,           // Hz

  // Server-only: Player physics
  PLAYER_FRICTION: 0.85,        // velocity multiplier per frame when not moving

  // Server-only: Combat
  PROJECTILE_SPEED: 700,        // px/sec
  PROJECTILE_BORDER_BOOST: 1.5, // speed multiplier after crossing arena border
  THROW_COOLDOWN: 500,          // ms
  THROW_SPREAD_DARK: 15,        // degrees, when flashlight off
  STUN_DURATION: 300,           // ms
  INVINCIBILITY_DURATION: 1500, // ms
  KNOCKBACK_DISTANCE: 30,       // px

  // Server-only: Vision
  // Note: FLASHLIGHT_FLICKER_THRESHOLD is now in shared/constants.js (used by both server and client)
  MUZZLE_FLASH_DURATION: 100,   // ms

  // Server-only: Pillow spawning
  PILLOWS_ON_MAP: 4,
  PILLOW_RESPAWN_TIME: 5000,    // ms

  // Server-only: Sudden death
  ARENA_SHRINK_INTERVAL: 5000,  // ms
  ARENA_SHRINK_AMOUNT: 50,      // px per interval

  // Server-only: Room
  ROOM_CODE_LENGTH: 4,
  MAX_ROOMS: 100,                  // Maximum number of rooms on server
  ROOM_CREATION_COOLDOWN: 5000,   // ms - cooldown between room creations per socket

  // Server-only: Rate limiting
  // INPUT_RATE_LIMIT is intentionally server-only - clients don't need to know the limit.
  // The server enforces this to prevent DoS attacks; clients just send at their configured rate.
  INPUT_RATE_LIMIT: 120,          // Max input packets per second per player
};

module.exports = CONSTANTS;
