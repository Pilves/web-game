# LIGHTS OUT

*In the dark, everyone's a target.*

A real-time multiplayer stealth-action brawler where 2-4 players battle in a pitch-black arena armed with pillows and flashlights. Navigate through darkness, use sound and light to track your enemies, and be the last one standing.

Built entirely with DOM elements -- no HTML canvas used.

**Live demo: [hetk.es/game](https://hetk.es/game)**

## Table of Contents

- [Project Overview](#project-overview)
- [Requirements](#requirements)
- [Setup and Installation](#setup-and-installation)
- [Running the Game](#running-the-game)
- [Usage Guide](#usage-guide)
- [Game Mechanics](#game-mechanics)
- [Bonus Features](#bonus-features)
- [Project Structure](#project-structure)

## Project Overview

Lights Out is a top-down arena brawler designed for 2-4 simultaneous players. Each player joins from their own computer via a web browser, enters a shared room using a 4-letter code, and competes in real-time pillow combat in a dark arena.

The game uses a client-server architecture with Socket.io for real-time communication. The server handles all authoritative game logic (physics, combat, collision detection), while the client handles rendering, input, audio, and visual effects using pure DOM manipulation.

### Tech Stack

- **Server:** Node.js, Express, Socket.io
- **Client:** Vanilla JavaScript (ES6 modules), HTML, CSS
- **Rendering:** DOM elements only (no canvas)
- **Audio:** Web Audio API with AI-generated vocal sound effects
- **Deployment:** Docker support included

## Requirements

- Node.js 20+
- A modern browser with WebSocket support (Chrome, Firefox, Safari, Edge)

## Setup and Installation

```bash
git clone https://github.com/Pilves/web-game.git
cd web-game
npm install
```

Copy the environment file and adjust as needed:

```bash
cp .env.example .env
```

### Docker (alternative)

```bash
docker compose up -d
```

The Docker setup exposes the game on port 3000.

## Running the Game

### Development

```bash
npm run dev
```

This starts the server with `--watch` mode for automatic restarts on file changes.

### Production

```bash
npm start
```

The server starts on `http://localhost:3000` by default.

### Environment Variables

| Variable      | Default                | Description                                          |
|---------------|------------------------|------------------------------------------------------|
| `PORT`        | `3000`                 | Server port                                          |
| `CORS_ORIGIN` | `http://localhost:3000` | Allowed CORS origins (comma-separated for multiple) |

See [`.env.example`](.env.example) for a full template.

## Usage Guide

### Joining a Game

1. Open the game URL in your browser
2. Enter a player name (max 12 characters) -- or leave blank for an auto-generated name
3. Either:
   - **Create a room** to get a 4-letter room code
   - **Join a room** by entering an existing code
4. Share the room code with other players
5. In the lobby, click **Ready** when prepared to play
6. The host (room creator) starts the game once 2+ players are ready

### Controls

| Action            | Primary Key | Alternative |
|-------------------|-------------|-------------|
| Move              | WASD        | Arrow Keys  |
| Sprint            | Hold Shift  | --          |
| Throw Pillow      | Space       | Left Click  |
| Toggle Flashlight | F           | Right Click |
| Pause Menu        | Escape      | --          |

Controls can be rebound in the settings menu. Custom bindings are saved to localStorage.

### Lobby Settings (Host Only)

- **Lives per player:** 1-5 (default 3)
- **Time limit:** 60-300 seconds in 30-second increments (default 180s)

### In-Game Menu

Press Escape during gameplay to access the pause menu:
- **Resume** - Continue the game
- **Quit** - Return to the lobby

When a player pauses, resumes, or quits, all players are notified with a message.

## Game Mechanics

### Objective

Each player starts with a set number of hearts (lives). Hit opponents with pillows to remove their hearts. The last player with hearts remaining wins.

If the timer runs out, **sudden death** begins: the arena shrinks every 5 seconds, forcing players closer together.

### Darkness and Vision

- The arena is pitch-black by default -- players cannot see each other
- Toggle your **flashlight** (F key) to reveal enemies in a cone (200px range, 60-degree angle)
- Your flashlight also reveals your own position to others
- Line-of-sight is blocked by obstacles (beds, table)

### Combat

- Throw pillows at opponents to deal damage
- Pillows are **more accurate** with your flashlight on (tighter spread)
- Hits apply **knockback** and a brief **stun** (300ms)
- Players receive brief **invincibility** after being hit (1500ms)
- Throw cooldown: 500ms between throws
- Pick up pillow pickups from the arena floor to rearm

### Movement

- Standard movement speed: 180 px/sec
- Sprint speed: 280 px/sec (louder, creates visible sound ripples)
- Collision detection with arena obstacles (beds in corners, center table)

### Scoring

- Real-time hearts display for all players visible in the HUD scoreboard
- The winner is announced at game end with a final results screen
- After the game ends, players automatically return to the lobby after 15 seconds, or can click **Play Again**

### Timer

A countdown timer is displayed during gameplay in MM:SS format. A warning sound plays at 30 seconds remaining.

## Bonus Features

### Spatial Audio
Full sound design using the Web Audio API with positional audio. 12 AI-generated vocal sound effects (mouth-made style via OpenAI TTS) for footsteps, throws, impacts, pickups, flashlight, death, countdown, start, victory, and warnings. Procedurally generated fallbacks are used if audio files fail to load.

### Customizable Controls
Players can rebind all keyboard controls through the in-game settings modal. Bindings persist via localStorage.

### Visual Effects
- Sound ripple visualizations when players sprint
- Impact flash effects on hits
- Muzzle flash on pillow throws (brief arena brightening)
- Smooth screen transitions with fade animations

### How-to-Play Guide
An in-game help modal with detailed instructions, icons, and gameplay tips.

### Performance Optimizations
- Object pooling for projectiles, ripples, and flash effects to minimize garbage collection
- Reusable collision detection objects (shared Hitbox module)
- DOM element caching and minimized reflows
- Gzip compression on network traffic (60-70% bandwidth reduction)
- Server-authoritative physics at 60 Hz tick rate with 20 Hz state broadcasts

### Rate Limiting
Multiple layers of protection against abuse: input rate limiting (120 packets/sec per player), room creation cooldowns, and per-event-type throttling.

### Accessibility
- ARIA labels and live regions for screen reader support
- Semantic HTML structure with proper roles
- Keyboard-only navigation support

## Project Structure

```
web-game/
├── client/
│   ├── js/
│   │   ├── main.js          # Game orchestrator
│   │   ├── network.js       # Socket.io client
│   │   ├── renderer.js      # DOM rendering
│   │   ├── pools.js         # Object pools (projectiles, ripples, flashes)
│   │   ├── ui.js            # Screen and HUD management
│   │   ├── lobby.js         # Lobby UI (player list, settings, room codes)
│   │   ├── input.js         # Keyboard/mouse input handling
│   │   ├── config.js        # Client configuration and debug helpers
│   │   ├── audio.js         # Web Audio API and spatial audio
│   │   ├── effects.js       # Visual effects (ripples, flashes)
│   │   ├── vision.js        # Flashlight and visibility
│   │   ├── prediction.js    # Client-side movement prediction
│   │   ├── events.js        # Game event handling
│   │   ├── state.js         # State interpolation management
│   │   ├── lifecycle.js     # Network event lifecycle handlers
│   │   ├── gameloop.js      # RequestAnimationFrame loop and FPS
│   │   └── modals.js        # Controls and how-to-play modals
│   ├── assets/
│   │   └── sounds/          # AI-generated vocal sound effects (MP3)
│   ├── css/                 # Modular stylesheets (7 files)
│   └── index.html           # Single-page app entry point
├── server/
│   ├── index.js             # Express + Socket.io setup
│   ├── GameManager.js       # Room and player lifecycle
│   ├── GameRoom.js          # Game instance orchestration
│   ├── PlayerManager.js     # Player state and spawning
│   ├── Combat.js            # Projectile and hit detection
│   ├── Physics.js           # Movement and collisions
│   ├── Hitbox.js            # Shared hitbox helpers
│   ├── InputHandler.js      # Player input processing
│   ├── StateBroadcaster.js  # Network state serialization
│   ├── GameTimer.js         # Clock, sudden death, arena shrinking
│   ├── PickupManager.js     # Pillow pickup spawning and collection
│   ├── RateLimiter.js       # Input rate limiting
│   └── constants.js         # Server configuration
├── shared/
│   ├── constants.js         # Shared game constants (client + server)
│   ├── geometry.js          # Collision and line-of-sight math
│   └── names.js             # Auto-generated player names
├── .env.example             # Environment variable template
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── package.json
└── task.md                  # Original project requirements
```
