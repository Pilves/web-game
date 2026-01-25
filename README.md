# LIGHTS OUT

A multiplayer top-down stealth-action brawler where players fight in darkness with pillows and flashlights. In the dark, everyone's a target.

## Features

- **2-4 Players** - Real-time multiplayer pillow fights with room-based matchmaking
- **Darkness Mechanics** - Navigate in near-total darkness; flashlights reveal enemies but also reveal you
- **Spatial Audio** - Hear footsteps, throws, and impacts to locate hidden enemies
- **60 FPS Performance** - Pure DOM rendering with no canvas, optimized for smooth gameplay

## Requirements

- Node.js 20+ LTS
- Modern browser with WebSocket support (Chrome, Firefox, Safari, Edge)

## Installation

```bash
git clone <repo>
cd web-game
npm install
```

## Running the Game

```bash
npm start
```

Then open http://localhost:3000

For multiplayer testing over the internet:
```bash
ngrok http 3000
```

## How to Play

### Controls

| Action | Primary | Alternative |
|--------|---------|-------------|
| Move | WASD | Arrow Keys |
| Sprint | Hold Shift | - |
| Throw Pillow | Space | Left Click |
| Toggle Flashlight | F | Right Click |
| Pause Menu | Escape | - |

### Getting Started

1. Create a room to get a 4-letter code, or join an existing room with a code
2. All players mark ready, then host starts the game
3. Be the last player standing - or have the most hearts when the timer ends

### Objective

Each player starts with 3 hearts. Hit opponents with pillows to eliminate them. Last player with hearts wins.

### Tips

- Your flashlight reveals enemies but also reveals your position
- Sprinting is loud and creates visible sound ripples
- Pillows are more accurate when your flashlight is on
- Pick up pillows from the ground to rearm (max 1 at a time)

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3000 | Server port |
| CORS_ORIGIN | * | Allowed CORS origins |

## Documentation

- **DESIGN.md** - Game mechanics, rules, balance values
- **TECHNICAL.md** - Architecture, data structures, code patterns

## License

MIT
