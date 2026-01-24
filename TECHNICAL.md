# LIGHTS OUT

## Technical Specification v2.1

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Browser  │  │ Browser  │  │ Browser  │  │ Browser  │        │
│  │ Player 1 │  │ Player 2 │  │ Player 3 │  │ Player 4 │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │                │
│       └─────────────┴──────┬──────┴─────────────┘                │
│                            │                                     │
│                     Socket.io (WebSocket)                        │
│                            │                                     │
│                    ┌───────┴───────┐                            │
│                    │    SERVER     │                            │
│                    │   (Node.js)   │                            │
│                    │               │                            │
│                    │ - Game State  │                            │
│                    │ - Physics     │                            │
│                    │ - Authority   │                            │
│                    └───────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

**Key Principle:** Server is authoritative. Clients are dumb renderers that send inputs and receive state.

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Node.js | 20+ LTS | Server runtime |
| Framework | Express | 4.x | HTTP server, static files |
| WebSocket | Socket.io | 4.x | Real-time communication |
| Client Audio | Web Audio API | Native | Spatial sound |
| Build | None | - | Vanilla JS, no bundler needed |

**No external dependencies on client** except Socket.io client (served by server).

---

## File Structure

```
/lights-out
├── server/
│   ├── index.js              # Entry point: Express + Socket.io setup
│   ├── GameManager.js        # Room/lobby management, game state machine
│   ├── GameRoom.js           # Single game room instance
│   ├── Physics.js            # Movement, collision detection
│   ├── Combat.js             # Projectiles, hits, damage
│   └── constants.js          # All magic numbers
│
├── client/
│   ├── index.html            # Single page app
│   ├── css/
│   │   ├── reset.css         # CSS reset
│   │   ├── variables.css     # CSS custom properties
│   │   ├── layout.css        # Page structure
│   │   ├── lobby.css         # Lobby screen styles
│   │   ├── game.css          # Game arena styles
│   │   ├── hud.css           # HUD elements
│   │   └── effects.css       # Animations, transitions
│   ├── js/
│   │   ├── main.js           # Entry point, state routing
│   │   ├── config.js         # Client-side constants
│   │   ├── network.js        # Socket.io wrapper
│   │   ├── input.js          # Keyboard state management
│   │   ├── renderer.js       # DOM manipulation, interpolation
│   │   ├── vision.js         # Flashlight, darkness, visibility
│   │   ├── audio.js          # Web Audio spatial sound
│   │   ├── effects.js        # Visual effects (shake, flash, ripple)
│   │   └── ui.js             # Screens, menus, HUD updates
│   └── assets/
│       ├── sounds/
│       │   ├── footstep-light.mp3
│       │   ├── footstep-heavy.mp3
│       │   ├── throw.mp3
│       │   ├── hit-wall.mp3
│       │   ├── hit-player.mp3
│       │   ├── pickup.mp3
│       │   ├── flashlight.mp3
│       │   ├── death.mp3
│       │   ├── countdown.mp3
│       │   ├── start.mp3
│       │   ├── victory.mp3
│       │   └── warning.mp3
│       └── sprites/
│           ├── player.svg
│           ├── pillow.svg
│           ├── pillow-ground.svg
│           └── obstacles.svg
│
├── package.json
├── README.md
├── DESIGN.md
└── TECHNICAL.md
```

---

## Data Structures

### Server-Side

```javascript
// constants.js
const CONSTANTS = {
  // Tick rates
  PHYSICS_TICK_RATE: 60,        // Hz
  BROADCAST_RATE: 20,           // Hz
  
  // Arena
  ARENA_WIDTH: 1200,
  ARENA_HEIGHT: 800,
  
  // Player
  PLAYER_SIZE: 40,
  PLAYER_SPEED: 180,            // px/sec
  PLAYER_SPRINT_SPEED: 280,     // px/sec
  PLAYER_FRICTION: 0.85,        // velocity multiplier per frame when not moving
  
  // Combat
  PROJECTILE_SPEED: 500,        // px/sec
  PROJECTILE_SIZE: 20,
  THROW_COOLDOWN: 500,          // ms
  THROW_SPREAD_DARK: 15,        // degrees, when flashlight off
  STUN_DURATION: 300,           // ms
  INVINCIBILITY_DURATION: 1500, // ms
  KNOCKBACK_DISTANCE: 30,       // px
  
  // Vision
  FLASHLIGHT_RANGE: 200,        // px
  FLASHLIGHT_ANGLE: 60,         // degrees
  FLASHLIGHT_FLICKER_THRESHOLD: 10000, // ms
  MUZZLE_FLASH_DURATION: 100,   // ms
  
  // Game
  DEFAULT_LIVES: 3,
  DEFAULT_TIME_LIMIT: 180,      // seconds
  PILLOWS_ON_MAP: 4,
  PILLOW_RESPAWN_TIME: 5000,    // ms
  
  // Sudden death
  ARENA_SHRINK_INTERVAL: 5000,  // ms
  ARENA_SHRINK_AMOUNT: 50,      // px per interval
};

// Player state
const player = {
  id: 'socket-id',
  name: 'PlayerName',
  color: '#ff6b6b',
  x: 100,
  y: 100,
  vx: 0,
  vy: 0,
  facing: 0,                    // radians, 0 = right, PI/2 = down
  hearts: 3,
  kills: 0,
  deaths: 0,
  hasAmmo: true,
  flashlightOn: false,
  flashlightOnSince: null,      // timestamp for flicker calculation
  lastThrowTime: 0,
  invincibleUntil: 0,
  stunnedUntil: 0,
  connected: true,
  ready: false,                 // lobby only
  input: {                      // current input state
    up: false,
    down: false,
    left: false,
    right: false,
    sprint: false,
    throw: false,
    flashlight: false,
  },
  lastInputSeq: 0,              // for reconciliation
};

// Projectile state
const projectile = {
  id: 'proj-uuid',
  ownerId: 'socket-id',
  x: 250,
  y: 300,
  vx: 400,                      // px/sec
  vy: 0,
  createdAt: Date.now(),
};

// Pillow pickup state
const pillowPickup = {
  id: 'pickup-uuid',
  x: 300,
  y: 200,
  active: true,
  respawnAt: null,              // timestamp when it should respawn
};

// Game room state
const gameRoom = {
  code: 'ABCD',
  host: 'socket-id',
  state: 'lobby',               // 'lobby' | 'countdown' | 'playing' | 'paused' | 'gameover'
  pausedBy: null,
  players: {},                  // id -> player
  projectiles: [],
  pillowPickups: [],
  settings: {
    lives: 3,
    timeLimit: 180,
  },
  gameStartTime: null,
  gameEndTime: null,
  suddenDeath: false,
  arenaInset: 0,                // px, for sudden death shrinking
  muzzleFlashUntil: 0,          // timestamp
};
```

### Network Packets

```javascript
// Client -> Server
const inputPacket = {
  seq: 1234,                    // sequence number for reconciliation
  input: {
    up: false,
    down: true,
    left: false,
    right: false,
    sprint: false,
    throw: false,
    flashlight: true,
  },
  facing: 1.57,                 // radians
};

// Server -> Client (optimized array format)
const statePacket = {
  t: 1705234567890,             // server timestamp
  s: 'playing',                 // state
  mf: false,                    // muzzle flash active
  time: 145,                    // seconds remaining
  inset: 0,                     // arena inset (sudden death)
  
  // Players: [id, x, y, facing, flashlight, hearts, hasAmmo, stunned, invincible]
  p: [
    ['abc123', 100.5, 200.3, 1.57, 1, 3, 1, 0, 0],
    ['def456', 400.2, 300.1, 3.14, 0, 2, 0, 0, 1],
  ],
  
  // Projectiles: [id, x, y, vx, vy]
  j: [
    ['p1', 250, 200, 400, 0],
  ],
  
  // Pickups: [id, x, y, active]
  k: [
    ['pk1', 300, 200, 1],
    ['pk2', 900, 200, 0],
  ],
  
  // Events since last tick: [type, ...data]
  e: [
    ['hit', 'victimId', 'attackerId'],
    ['death', 'playerId'],
    ['pickup', 'playerId', 300, 200],
    ['throw', 'playerId'],
    ['sound', 'type', x, y],    // for sound ripples
  ],
};

// Server -> Client (lobby state)
const lobbyPacket = {
  code: 'ABCD',
  host: 'abc123',
  players: [
    { id: 'abc123', name: 'Patric', color: '#ff6b6b', ready: true },
    { id: 'def456', name: 'Guest', color: '#4ecdc4', ready: false },
  ],
  settings: {
    lives: 3,
    timeLimit: 180,
  },
};
```

### Socket Events

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `create-room` | C → S | `{ name }` | Host creates room |
| `room-created` | S → C | `{ code }` | Room code returned |
| `join-room` | C → S | `{ code, name }` | Player joins |
| `join-error` | S → C | `{ message }` | Join failed |
| `lobby-update` | S → C | `lobbyPacket` | Lobby state changed |
| `toggle-ready` | C → S | `{}` | Player ready/unready |
| `kick-player` | C → S | `{ playerId }` | Host kicks player |
| `update-settings` | C → S | `{ lives?, timeLimit? }` | Host changes settings |
| `start-game` | C → S | `{}` | Host starts game |
| `countdown` | S → C | `{ count }` | 3, 2, 1 |
| `game-start` | S → C | `{ statePacket }` | Game begins |
| `input` | C → S | `inputPacket` | Player input |
| `state` | S → C | `statePacket` | Game state update |
| `pause` | C → S | `{}` | Request pause |
| `resume` | C → S | `{}` | Request resume |
| `game-paused` | S → C | `{ by }` | Game paused notification |
| `game-resumed` | S → C | `{ by }` | Game resumed notification |
| `quit` | C → S | `{}` | Player quits |
| `player-quit` | S → C | `{ playerId, name }` | Player quit notification |
| `game-over` | S → C | `{ winner, scores }` | Game ended |
| `return-lobby` | C → S | `{}` | Request return to lobby |
| `disconnect` | C → S | - | Socket.io built-in |

---

## Server Architecture

### Main Server (index.js)

```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const GameManager = require('./GameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },  // For development
});

// Serve static files
app.use(express.static('../client'));

// Initialize game manager
const gameManager = new GameManager(io);

// Socket connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  socket.on('create-room', (data) => gameManager.createRoom(socket, data));
  socket.on('join-room', (data) => gameManager.joinRoom(socket, data));
  socket.on('toggle-ready', () => gameManager.toggleReady(socket));
  socket.on('kick-player', (data) => gameManager.kickPlayer(socket, data));
  socket.on('update-settings', (data) => gameManager.updateSettings(socket, data));
  socket.on('start-game', () => gameManager.startGame(socket));
  socket.on('input', (data) => gameManager.handleInput(socket, data));
  socket.on('pause', () => gameManager.pauseGame(socket));
  socket.on('resume', () => gameManager.resumeGame(socket));
  socket.on('quit', () => gameManager.quitGame(socket));
  socket.on('return-lobby', () => gameManager.returnToLobby(socket));
  socket.on('disconnect', () => gameManager.handleDisconnect(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### Game Loop (in GameRoom.js)

```javascript
class GameRoom {
  constructor(io, code, host) {
    this.io = io;
    this.code = code;
    this.host = host;
    // ... initialize state
    
    this.physicsInterval = null;
    this.broadcastInterval = null;
  }

  startGameLoop() {
    const PHYSICS_DT = 1000 / CONSTANTS.PHYSICS_TICK_RATE;
    const BROADCAST_DT = 1000 / CONSTANTS.BROADCAST_RATE;
    
    // Physics loop - 60Hz
    this.physicsInterval = setInterval(() => {
      if (this.state !== 'playing') return;
      this.physicsTick(PHYSICS_DT / 1000); // pass delta in seconds
    }, PHYSICS_DT);
    
    // Broadcast loop - 20Hz
    this.broadcastInterval = setInterval(() => {
      if (this.state !== 'playing' && this.state !== 'paused') return;
      this.broadcastState();
    }, BROADCAST_DT);
  }

  physicsTick(dt) {
    // 1. Apply inputs to velocities
    for (const player of Object.values(this.players)) {
      this.applyInput(player, dt);
    }
    
    // 2. Move players
    for (const player of Object.values(this.players)) {
      this.movePlayer(player, dt);
    }
    
    // 3. Update projectiles
    this.updateProjectiles(dt);
    
    // 4. Check collisions
    this.checkProjectileCollisions();
    
    // 5. Check pickup collisions
    this.checkPickupCollisions();
    
    // 6. Check win condition
    this.checkWinCondition();
    
    // 7. Update timers
    this.updateTimers();
    
    // 8. Respawn pickups
    this.respawnPickups();
  }

  broadcastState() {
    const packet = this.buildStatePacket();
    this.io.to(this.code).emit('state', packet);
    this.events = []; // Clear events after broadcast
  }
}
```

---

## Client Architecture

### Main Entry (main.js)

```javascript
import { Network } from './network.js';
import { Input } from './input.js';
import { Renderer } from './renderer.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';

class Game {
  constructor() {
    this.network = new Network(this);
    this.input = new Input(this);
    this.renderer = new Renderer(this);
    this.audio = new Audio();
    this.ui = new UI(this);
    
    this.state = 'menu';        // 'menu' | 'lobby' | 'playing' | 'paused' | 'gameover'
    this.myId = null;
    this.serverState = null;
    this.prevServerState = null;
    this.stateTime = 0;
    this.localPlayer = null;    // For prediction
    
    this.lastFrameTime = 0;
    this.running = false;
  }

  start() {
    this.running = true;
    this.ui.showScreen('menu');
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  gameLoop(timestamp) {
    if (!this.running) return;
    
    const dt = (timestamp - this.lastFrameTime) / 1000;
    this.lastFrameTime = timestamp;
    
    if (this.state === 'playing') {
      // Update interpolation timer
      this.stateTime += dt * 1000;
      
      // Process local input
      const input = this.input.getState();
      this.network.sendInput(input);
      
      // Predict local movement
      this.predictLocalPlayer(input, dt);
      
      // Render with interpolation
      this.renderer.render(this.prevServerState, this.serverState, this.stateTime, this.localPlayer);
    }
    
    requestAnimationFrame((t) => this.gameLoop(t));
  }

  onServerState(state) {
    this.prevServerState = this.serverState;
    this.serverState = state;
    this.stateTime = 0;
    
    // Reconcile local player
    this.reconcileLocalPlayer(state);
    
    // Process events
    for (const event of state.e || []) {
      this.handleEvent(event);
    }
    
    // Update UI
    this.ui.updateHUD(state);
  }

  handleEvent(event) {
    const [type, ...data] = event;
    switch (type) {
      case 'hit':
        this.renderer.showImpactFlash(/* position from victim */);
        this.audio.playHit(/* position */);
        break;
      case 'death':
        this.renderer.showDeath(data[0]);
        this.audio.playDeath(/* position */);
        break;
      case 'throw':
        this.renderer.triggerMuzzleFlash();
        this.audio.playThrow(/* position */);
        break;
      case 'sound':
        const [soundType, x, y] = data;
        this.renderer.showSoundRipple(x, y, soundType);
        this.audio.playPositional(soundType, x, y);
        break;
    }
  }
}

// Initialize
const game = new Game();
game.start();
```

### Input Handler (input.js)

```javascript
export class Input {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.mouseX = 0;
    this.mouseY = 0;
    this.facing = 0;
    
    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      
      // Prevent defaults for game keys
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      
      // Handle toggle keys (not hold)
      if (e.code === 'KeyF' && !e.repeat) {
        this.flashlightToggle = true;
      }
      if (e.code === 'Escape') {
        this.game.ui.togglePause();
      }
    });
    
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
    
    window.addEventListener('mousemove', (e) => {
      const arena = document.getElementById('arena');
      const rect = arena.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      
      // Calculate facing angle from player position to mouse
      if (this.game.localPlayer) {
        const dx = this.mouseX - this.game.localPlayer.x;
        const dy = this.mouseY - this.game.localPlayer.y;
        this.facing = Math.atan2(dy, dx);
      }
    });
    
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.keys['Mouse0'] = true;  // Left click = throw
      if (e.button === 2) this.flashlightToggle = true; // Right click = flashlight
    });
    
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.keys['Mouse0'] = false;
    });
    
    // Prevent context menu on right click
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  getState() {
    const input = {
      up: this.keys['KeyW'] || this.keys['ArrowUp'] || false,
      down: this.keys['KeyS'] || this.keys['ArrowDown'] || false,
      left: this.keys['KeyA'] || this.keys['ArrowLeft'] || false,
      right: this.keys['KeyD'] || this.keys['ArrowRight'] || false,
      sprint: this.keys['ShiftLeft'] || this.keys['ShiftRight'] || false,
      throw: this.keys['Space'] || this.keys['Mouse0'] || false,
      flashlight: this.flashlightToggle || false,
      facing: this.facing,
    };
    
    // Reset toggle flags
    this.flashlightToggle = false;
    
    return input;
  }
}
```

### Renderer (renderer.js)

```javascript
export class Renderer {
  constructor(game) {
    this.game = game;
    this.arena = document.getElementById('arena');
    this.playerElements = {};
    this.projectilePool = [];
    this.ripplePool = [];
    
    this.initPools();
  }

  initPools() {
    // Pre-allocate projectile elements
    for (let i = 0; i < 20; i++) {
      const el = document.createElement('div');
      el.className = 'projectile';
      el.style.display = 'none';
      this.arena.appendChild(el);
      this.projectilePool.push({ el, active: false, id: null });
    }
    
    // Pre-allocate ripple elements
    for (let i = 0; i < 30; i++) {
      const el = document.createElement('div');
      el.className = 'sound-ripple';
      this.arena.appendChild(el);
      this.ripplePool.push(el);
    }
  }

  render(prevState, currState, stateTime, localPlayer) {
    if (!currState) return;
    
    const t = Math.min(stateTime / 50, 1); // 50ms between server updates
    
    // Render players
    for (const pData of currState.p) {
      const [id, x, y, facing, flashlight, hearts, hasAmmo, stunned, invincible] = pData;
      
      let renderX = x;
      let renderY = y;
      
      // Interpolate position (except for local player, use predicted position)
      if (id === this.game.myId && localPlayer) {
        renderX = localPlayer.x;
        renderY = localPlayer.y;
      } else if (prevState) {
        const prev = prevState.p.find(p => p[0] === id);
        if (prev) {
          renderX = this.lerp(prev[1], x, t);
          renderY = this.lerp(prev[2], y, t);
        }
      }
      
      this.renderPlayer(id, renderX, renderY, facing, flashlight, invincible);
    }
    
    // Render projectiles
    this.renderProjectiles(prevState, currState, t);
    
    // Render pickups
    this.renderPickups(currState.k);
    
    // Update darkness/vision
    this.updateVision(currState, localPlayer);
    
    // Muzzle flash
    if (currState.mf) {
      this.arena.classList.add('muzzle-flash');
    } else {
      this.arena.classList.remove('muzzle-flash');
    }
  }

  renderPlayer(id, x, y, facing, flashlightOn, invincible) {
    let el = this.playerElements[id];
    if (!el) {
      el = document.createElement('div');
      el.className = 'player';
      el.dataset.id = id;
      el.innerHTML = `
        <div class="player-body"></div>
        <div class="player-direction"></div>
        <div class="flashlight-cone"></div>
      `;
      this.arena.appendChild(el);
      this.playerElements[id] = el;
    }
    
    // Position via transform (GPU accelerated)
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    
    // Z-index based on Y position (depth sorting)
    el.style.zIndex = Math.floor(y);
    
    // Rotation for direction indicator
    el.querySelector('.player-direction').style.transform = `rotate(${facing}rad)`;
    
    // Flashlight cone
    const cone = el.querySelector('.flashlight-cone');
    if (flashlightOn) {
      cone.style.display = 'block';
      cone.style.transform = `rotate(${facing}rad)`;
    } else {
      cone.style.display = 'none';
    }
    
    // Invincibility effect
    el.classList.toggle('invincible', invincible);
    
    // Mark self
    el.classList.toggle('self', id === this.game.myId);
  }

  renderProjectiles(prevState, currState, t) {
    // Mark all as inactive
    this.projectilePool.forEach(p => p.active = false);
    
    for (const pData of currState.j) {
      const [id, x, y, vx, vy] = pData;
      
      let renderX = x;
      let renderY = y;
      
      // Interpolate
      if (prevState) {
        const prev = prevState.j.find(p => p[0] === id);
        if (prev) {
          renderX = this.lerp(prev[1], x, t);
          renderY = this.lerp(prev[2], y, t);
        }
      }
      
      // Find or assign pool element
      let poolItem = this.projectilePool.find(p => p.id === id);
      if (!poolItem) {
        poolItem = this.projectilePool.find(p => !p.active);
        if (poolItem) poolItem.id = id;
      }
      
      if (poolItem) {
        poolItem.active = true;
        poolItem.el.style.display = 'block';
        poolItem.el.style.transform = `translate3d(${renderX}px, ${renderY}px, 0)`;
      }
    }
    
    // Hide inactive
    this.projectilePool.forEach(p => {
      if (!p.active) {
        p.el.style.display = 'none';
        p.id = null;
      }
    });
  }

  showSoundRipple(x, y, type) {
    const el = this.ripplePool.find(r => !r.classList.contains('active'));
    if (!el) return;
    
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.className = `sound-ripple active ${type}`;
    
    // Remove active class after animation
    setTimeout(() => el.classList.remove('active'), 500);
  }

  triggerMuzzleFlash() {
    this.arena.classList.add('muzzle-flash');
    setTimeout(() => this.arena.classList.remove('muzzle-flash'), 100);
  }

  showImpactFlash(x, y) {
    const el = document.createElement('div');
    el.className = 'impact-flash';
    el.style.left = `${x - 30}px`;
    el.style.top = `${y - 30}px`;
    this.arena.appendChild(el);
    
    setTimeout(() => el.remove(), 150);
  }

  lerp(a, b, t) {
    return a + (b - a) * t;
  }
}
```

---

## Collision Detection

### AABB (Axis-Aligned Bounding Box)

All collision in this game uses simple rectangle intersection. No circles, no polygons.

```javascript
// In Physics.js
function rectsCollide(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Player hitbox: centered on position
function getPlayerRect(player) {
  return {
    x: player.x - CONSTANTS.PLAYER_SIZE / 2,
    y: player.y - CONSTANTS.PLAYER_SIZE / 2,
    width: CONSTANTS.PLAYER_SIZE,
    height: CONSTANTS.PLAYER_SIZE,
  };
}

// Projectile hitbox: centered on position
function getProjectileRect(projectile) {
  return {
    x: projectile.x - CONSTANTS.PROJECTILE_SIZE / 2,
    y: projectile.y - CONSTANTS.PROJECTILE_SIZE / 2,
    width: CONSTANTS.PROJECTILE_SIZE,
    height: CONSTANTS.PROJECTILE_SIZE,
  };
}
```

### Line-of-Sight Check (For Visibility)

This is the **critical optimization** mentioned in the design feedback. We do NOT calculate polygon shadows. We do a simple raycast check.

```javascript
// Check if there's an obstacle between two points
function hasLineOfSight(x1, y1, x2, y2, obstacles) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.hypot(dx, dy);
  const steps = Math.ceil(distance / 10); // Check every 10px
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + dx * t;
    const y = y1 + dy * t;
    
    for (const obstacle of obstacles) {
      if (pointInRect(x, y, obstacle)) {
        return false; // Blocked
      }
    }
  }
  
  return true; // Clear line of sight
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.width &&
         y >= rect.y && y <= rect.y + rect.height;
}

// Determine if player B is visible to player A
function isPlayerVisible(playerA, playerB, obstacles, muzzleFlashActive) {
  // During muzzle flash, everyone is visible
  if (muzzleFlashActive) return true;
  
  // If A's flashlight is off, they can't see anyone
  if (!playerA.flashlightOn) return false;
  
  // Check if B is within A's flashlight cone
  const dx = playerB.x - playerA.x;
  const dy = playerB.y - playerA.y;
  const distance = Math.hypot(dx, dy);
  
  // Out of range
  if (distance > CONSTANTS.FLASHLIGHT_RANGE) return false;
  
  // Check angle
  const angleToB = Math.atan2(dy, dx);
  const angleDiff = normalizeAngle(angleToB - playerA.facing);
  const halfCone = (CONSTANTS.FLASHLIGHT_ANGLE / 2) * (Math.PI / 180);
  
  if (Math.abs(angleDiff) > halfCone) return false;
  
  // Check line of sight (obstacle blocking)
  return hasLineOfSight(playerA.x, playerA.y, playerB.x, playerB.y, obstacles);
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}
```

---

## CSS Implementation

### Darkness System

```css
/* variables.css */
:root {
  --arena-width: 1200px;
  --arena-height: 800px;
  --dark-bg: #0a0a0c;
  --lit-bg: #1a1a1e;
}

/* game.css */
#arena {
  position: relative;
  width: var(--arena-width);
  height: var(--arena-height);
  background: var(--dark-bg);
  overflow: hidden;
  /* Transform for scaling to viewport */
  transform-origin: top left;
}

/* Default: everything hidden */
.player {
  position: absolute;
  width: 40px;
  height: 40px;
  opacity: 0;
  transition: opacity 0.1s;
  will-change: transform, opacity;
}

/* Self is always visible */
.player.self {
  opacity: 1;
}

/* Muzzle flash reveals everything */
#arena.muzzle-flash .player,
#arena.muzzle-flash .pillow-pickup {
  opacity: 1;
}

/* Players lit by flashlight - class added by JS */
.player.visible {
  opacity: 1;
}

/* Flashlight cone visualization */
.flashlight-cone {
  position: absolute;
  width: 0;
  height: 0;
  border-left: 200px solid rgba(255, 250, 230, 0.15);
  border-top: 100px solid transparent;
  border-bottom: 100px solid transparent;
  transform-origin: 0 50%;
  left: 20px;
  top: -80px;
  display: none;
  pointer-events: none;
}

/* Self glow */
.player.self .player-body {
  box-shadow: 0 0 15px rgba(255, 255, 255, 0.3);
}

/* Invincibility flash */
.player.invincible {
  animation: invincible-flash 0.1s infinite alternate;
}

@keyframes invincible-flash {
  from { opacity: 1; }
  to { opacity: 0.3; }
}
```

### Effects

```css
/* effects.css */

/* Sound ripple */
.sound-ripple {
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0);
  transform: translate(-50%, -50%) scale(0);
  pointer-events: none;
}

.sound-ripple.active {
  animation: ripple-expand 0.5s ease-out forwards;
}

.sound-ripple.footstep {
  border-color: rgba(255, 255, 255, 0.3);
}

.sound-ripple.throw {
  border-color: rgba(255, 200, 100, 0.5);
}

.sound-ripple.hit {
  border-color: rgba(255, 100, 100, 0.6);
}

@keyframes ripple-expand {
  0% {
    transform: translate(-50%, -50%) scale(0.5);
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) scale(4);
    opacity: 0;
  }
}

/* Impact flash */
.impact-flash {
  position: absolute;
  width: 60px;
  height: 60px;
  background: radial-gradient(circle, rgba(255, 255, 200, 0.9) 0%, transparent 70%);
  border-radius: 50%;
  pointer-events: none;
  animation: flash-burst 0.15s ease-out forwards;
}

@keyframes flash-burst {
  0% {
    transform: scale(0.5);
    opacity: 1;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}

/* Screen shake - applied to #arena container */
.shake {
  animation: shake 0.2s cubic-bezier(.36,.07,.19,.97) both;
}

@keyframes shake {
  10%, 90% { transform: translateX(-1px); }
  20%, 80% { transform: translateX(2px); }
  30%, 50%, 70% { transform: translateX(-3px); }
  40%, 60% { transform: translateX(3px); }
}

/* Muzzle flash - instant full brightness */
#arena.muzzle-flash {
  background: var(--lit-bg);
}
```

---

## Audio Implementation

```javascript
// audio.js
export class Audio {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.sounds = {};
    this.enabled = true;
    this.masterVolume = 0.7;
    
    this.loadSounds();
  }

  async loadSounds() {
    const soundFiles = {
      'footstep-light': 'assets/sounds/footstep-light.mp3',
      'footstep-heavy': 'assets/sounds/footstep-heavy.mp3',
      'throw': 'assets/sounds/throw.mp3',
      'hit-wall': 'assets/sounds/hit-wall.mp3',
      'hit-player': 'assets/sounds/hit-player.mp3',
      'pickup': 'assets/sounds/pickup.mp3',
      'flashlight': 'assets/sounds/flashlight.mp3',
      'death': 'assets/sounds/death.mp3',
      'countdown': 'assets/sounds/countdown.mp3',
      'start': 'assets/sounds/start.mp3',
      'victory': 'assets/sounds/victory.mp3',
      'warning': 'assets/sounds/warning.mp3',
    };
    
    for (const [name, url] of Object.entries(soundFiles)) {
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        this.sounds[name] = await this.ctx.decodeAudioData(arrayBuffer);
      } catch (e) {
        console.warn(`Failed to load sound: ${name}`, e);
      }
    }
  }

  // Play a non-positional sound (UI, self actions)
  play(name, volume = 1) {
    if (!this.enabled || !this.sounds[name]) return;
    
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    
    source.buffer = this.sounds[name];
    gain.gain.value = volume * this.masterVolume;
    
    source.connect(gain).connect(this.ctx.destination);
    source.start();
  }

  // Play a positional sound (other players' actions)
  playPositional(name, sourceX, sourceY, listenerX, listenerY, volume = 1) {
    if (!this.enabled || !this.sounds[name]) return;
    
    const source = this.ctx.createBufferSource();
    const panner = this.ctx.createStereoPanner();
    const gain = this.ctx.createGain();
    
    source.buffer = this.sounds[name];
    
    // Calculate stereo pan (-1 left, +1 right)
    const dx = sourceX - listenerX;
    const maxDistance = 600; // Half arena width
    const pan = Math.max(-1, Math.min(1, dx / maxDistance));
    panner.pan.value = pan;
    
    // Distance-based volume falloff
    const dy = sourceY - listenerY;
    const distance = Math.hypot(dx, dy);
    const distanceVolume = Math.max(0, 1 - (distance / 800));
    gain.gain.value = volume * distanceVolume * this.masterVolume;
    
    source.connect(panner).connect(gain).connect(this.ctx.destination);
    source.start();
  }
  
  // Resume audio context (required after user interaction)
  resume() {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }
}
```

---

## Client-Side Prediction & Reconciliation

```javascript
// In main.js or separate prediction.js

class Prediction {
  constructor(game) {
    this.game = game;
    this.pendingInputs = [];
    this.inputSequence = 0;
  }

  // Called when local input is processed
  applyInput(input, dt) {
    if (!this.game.localPlayer) return;
    
    const player = this.game.localPlayer;
    const speed = input.sprint ? CONSTANTS.PLAYER_SPRINT_SPEED : CONSTANTS.PLAYER_SPEED;
    
    // Calculate velocity from input
    let vx = 0;
    let vy = 0;
    
    if (input.up) vy -= 1;
    if (input.down) vy += 1;
    if (input.left) vx -= 1;
    if (input.right) vx += 1;
    
    // Normalize diagonal movement
    const length = Math.hypot(vx, vy);
    if (length > 0) {
      vx = (vx / length) * speed;
      vy = (vy / length) * speed;
    }
    
    // Apply velocity
    player.x += vx * dt;
    player.y += vy * dt;
    
    // Clamp to arena bounds
    const halfSize = CONSTANTS.PLAYER_SIZE / 2;
    player.x = Math.max(halfSize, Math.min(CONSTANTS.ARENA_WIDTH - halfSize, player.x));
    player.y = Math.max(halfSize, Math.min(CONSTANTS.ARENA_HEIGHT - halfSize, player.y));
    
    // TODO: Obstacle collision
    
    // Store for reconciliation
    this.pendingInputs.push({
      seq: this.inputSequence++,
      input: { ...input },
      predictedX: player.x,
      predictedY: player.y,
    });
    
    // Limit stored inputs
    if (this.pendingInputs.length > 60) {
      this.pendingInputs.shift();
    }
  }

  // Called when server state arrives
  reconcile(serverState) {
    const serverPlayer = serverState.p.find(p => p[0] === this.game.myId);
    if (!serverPlayer || !this.game.localPlayer) return;
    
    const [, serverX, serverY] = serverPlayer;
    const player = this.game.localPlayer;
    
    // Calculate difference
    const dx = serverX - player.x;
    const dy = serverY - player.y;
    const distance = Math.hypot(dx, dy);
    
    if (distance < 5) {
      // Small difference: smooth correction
      player.x += dx * 0.3;
      player.y += dy * 0.3;
    } else if (distance < 50) {
      // Medium difference: faster correction
      player.x += dx * 0.5;
      player.y += dy * 0.5;
    } else {
      // Large difference (lag spike): snap
      player.x = serverX;
      player.y = serverY;
    }
    
    // Clear old pending inputs (already processed by server)
    // In a more sophisticated system, we'd track input sequences
    this.pendingInputs = [];
  }
}
```

---

## Performance Checklist

### Must Do
- [ ] Use `transform: translate3d()` for all movement, never `top`/`left`
- [ ] Add `will-change: transform` to moving elements
- [ ] Object pooling for projectiles and effects
- [ ] Batch DOM reads and writes (don't interleave)
- [ ] Keep game state in JS variables, only touch DOM in render
- [ ] Use `requestAnimationFrame` for render loop
- [ ] Throttle network broadcasts to 20Hz

### Must Not Do
- [ ] Never call `getBoundingClientRect()` in game loop
- [ ] Never create/remove DOM elements during gameplay (use pools)
- [ ] Never use `element.offsetWidth` or similar layout-triggering reads
- [ ] Never use CSS `filter` animations on many elements (expensive)

### Testing
- [ ] Chrome DevTools Performance panel: verify 60 FPS
- [ ] Test with 4 players on separate machines
- [ ] Test with simulated lag (Chrome Network throttling)
- [ ] Test rapid input spam
- [ ] Test player disconnect/reconnect

---

## Security Notes

### MVP (Trust-Based)
- Server is authoritative for game state
- Clients could still inspect DOM to see hidden players
- Acceptable for party game with friends

### Production (If Time)
- Server only sends visible player positions to each client
- Visibility calculated server-side per-player
- Eliminates map hacking entirely
- Adds ~30% complexity to networking code

---

## Deployment

### Local Development
```bash
cd lights-out
npm install
npm run dev   # or node server/index.js
# Open http://localhost:3000
```

### Exposing to Internet (For Testing)
```bash
# Option 1: ngrok
ngrok http 3000
# Share the ngrok URL with other players

# Option 2: Cloudflare Tunnel
cloudflared tunnel --url http://localhost:3000
```

### Production Deployment
- Render.com (free tier works)
- Railway
- Fly.io
- Any Node.js host with WebSocket support

---

## Dependencies

```json
{
  "name": "lights-out",
  "version": "1.0.0",
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.2",
    "uuid": "^9.0.0"
  }
}
```
