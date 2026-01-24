# LIGHTS OUT

> *"In the dark, everyone's a target."*

A real-time multiplayer stealth-action brawler built entirely with DOM elements. No canvas. 2-4 players fight in darkness, armed only with flashlights and pillows.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start server
npm start

# Open in browser
http://localhost:3000

# Expose to internet for multiplayer (pick one)
ngrok http 3000
# or
cloudflared tunnel --url http://localhost:3000
```

Share the public URL with friends. They join via 4-letter room code.

---

## How to Play

1. **Create or Join** - Host creates room, gets code. Others join with code.
2. **Ready Up** - All players mark ready, host starts game.
3. **Survive** - Last player with hearts wins. Or most hearts when timer ends.

### Controls

| Action | Keys |
|--------|------|
| Move | WASD / Arrow Keys |
| Sprint | Hold Shift |
| Throw Pillow | Space / Left Click |
| Toggle Flashlight | F / Right Click |
| Pause | Escape |

### The Catch

**It's dark.** You can't see other players unless:
- Your flashlight is pointed at them
- Someone throws (brief room-wide flash)
- They sprint near you (sound ripple)

Your flashlight reveals enemies—but it also reveals YOU.

---

## Project Structure

```
/lights-out
├── server/
│   ├── index.js          # Express + Socket.io
│   ├── GameManager.js    # Room management
│   ├── GameRoom.js       # Game logic
│   ├── Physics.js        # Movement, collision
│   └── constants.js      # Config values
├── client/
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── assets/
├── DESIGN.md             # Game design document
├── TECHNICAL.md          # Technical specification
├── ROADMAP.md            # Implementation phases
└── README.md             # This file
```

---

## Requirements Met

| Requirement | Implementation |
|-------------|----------------|
| 2-4 players | ✓ Lobby system with room codes |
| Real-time (not turn-based) | ✓ 60Hz physics, 20Hz network sync |
| Same screen visibility | ✓ All players see same arena |
| Unique player names | ✓ Enforced in lobby |
| Join via URL | ✓ Browser-based |
| 60 FPS | ✓ DOM transforms, object pooling |
| No canvas | ✓ Pure DOM + CSS |
| Pause/Resume/Quit menu | ✓ Broadcasts to all players |
| Timer | ✓ Countdown with sudden death |
| Scoring system | ✓ Hearts + kills |
| Winner display | ✓ Game over screen |
| Sound effects | ✓ Spatial audio |
| Keyboard controls | ✓ WASD + Arrow Keys |

---

## Tech Stack

- **Server:** Node.js + Express + Socket.io
- **Client:** Vanilla JS + CSS (no framework)
- **Audio:** Web Audio API (spatial sound)
- **Networking:** WebSocket with client prediction

---

## Documentation

- **DESIGN.md** - Game mechanics, rules, balance values
- **TECHNICAL.md** - Architecture, data structures, code patterns
- **ROADMAP.md** - Implementation phases, task breakdown

---

## Development

```bash
# Watch mode (auto-restart on changes)
npm run dev

# Or manual
node server/index.js
```

### Performance Testing

1. Open Chrome DevTools → Performance tab
2. Start recording
3. Play for 30 seconds
4. Check for dropped frames (should maintain 60 FPS)

### Multi-Player Testing

1. Start server
2. Run ngrok: `ngrok http 3000`
3. Open ngrok URL in multiple browser windows/devices
4. Create room in one, join with others

---

## Credits

A kood/Jõhvi school project.

---

## License

MIT
