# LIGHTS OUT

## Implementation Roadmap

---

## Overview

**Deadline:** February 12, 2026, 4:05 PM  
**Available Time:** ~2.5 weeks  
**Approach:** MVP first, polish second, bonuses if time permits

---

## Phase 1: Foundation (Days 1-3)

### Goal
4 colored squares moving on 4 screens. No game mechanics yet.

### Tasks

#### 1.1 Project Setup
- [ ] Initialize npm project
- [ ] Install dependencies (express, socket.io, uuid)
- [ ] Create folder structure per TECHNICAL.md
- [ ] Setup Express server serving static files
- [ ] Basic index.html with placeholder content

#### 1.2 Socket.io Infrastructure
- [ ] Socket.io server setup
- [ ] Connection/disconnection handling
- [ ] Room creation (generate 4-letter code)
- [ ] Room joining (validate code, check capacity)
- [ ] Player tracking (id, name, room assignment)

#### 1.3 Lobby System
- [ ] Lobby UI: room code display, player list, ready buttons
- [ ] `toggle-ready` event handling
- [ ] Host identification (first player in room)
- [ ] `start-game` event (host only, requires 2+ ready)
- [ ] `lobby-update` broadcasts on any change
- [ ] Player kick functionality (host only)

#### 1.4 Basic Rendering
- [ ] Arena container (1200x800)
- [ ] Player div creation/removal
- [ ] CSS transform-based positioning
- [ ] Player colors (4 preset colors)

#### 1.5 Input Handling
- [ ] Keyboard event listeners (keydown/keyup)
- [ ] Input state object (up/down/left/right)
- [ ] Mouse tracking for facing direction
- [ ] Input packet sending to server

#### 1.6 Server Game Loop
- [ ] `setInterval` for physics tick (60Hz)
- [ ] `setInterval` for state broadcast (20Hz)
- [ ] Apply inputs to player velocities
- [ ] Basic position updates
- [ ] State packet assembly

#### 1.7 Client State Handling
- [ ] Receive state packets
- [ ] Store previous/current state
- [ ] Basic interpolation (lerp between states)
- [ ] Update player positions via transform

### Milestone Checklist
- [ ] Can create room and see room code
- [ ] Can join room with code
- [ ] Can see other players join/leave
- [ ] Can ready up and start game
- [ ] All 4 players see all 4 squares moving smoothly

---

## Phase 2: Core Game (Days 4-6)

### Goal
Playable pillow fight with hit detection, lives, and win condition.

### Tasks

#### 2.1 Obstacles
- [ ] Define obstacle positions (beds, table) in constants
- [ ] Render obstacle divs
- [ ] Obstacle collision detection (AABB)
- [ ] Block player movement through obstacles
- [ ] Z-index sorting (players behind/in front of obstacles)

#### 2.2 Projectile System
- [ ] Projectile state model (id, x, y, vx, vy, owner)
- [ ] Throw input handling (space/click)
- [ ] Server-side projectile creation
- [ ] Projectile movement each tick
- [ ] Wall collision (despawn)
- [ ] Throw cooldown (500ms)

#### 2.3 Object Pooling (Client)
- [ ] Pre-allocate 20 projectile divs (hidden)
- [ ] Pool manager: get inactive, return to pool
- [ ] No createElement/remove during gameplay

#### 2.4 Hit Detection
- [ ] Projectile-player collision (AABB)
- [ ] Ignore owner (can't hit yourself)
- [ ] Ignore invincible players
- [ ] On hit: damage, despawn projectile, event broadcast

#### 2.5 Combat Mechanics
- [ ] Hearts system (start with 3)
- [ ] Invincibility frames (1.5s after hit)
- [ ] Stun duration (300ms no movement)
- [ ] Knockback (push away from projectile direction)
- [ ] Death handling (0 hearts)

#### 2.6 Pillow Pickups
- [ ] Pickup spawn points
- [ ] Pickup state (active/inactive, respawn timer)
- [ ] Player-pickup collision
- [ ] `hasAmmo` tracking
- [ ] Pickup respawn after 5 seconds
- [ ] Render pickups (faint glow when close)

#### 2.7 Win Conditions
- [ ] Last player standing check
- [ ] Timer countdown (3 minutes default)
- [ ] Time's up: most hearts wins
- [ ] Tiebreaker: sudden death mode
- [ ] Sudden death: arena shrinks, 1 heart each

#### 2.8 Game Over
- [ ] `game-over` event with winner and scores
- [ ] Game over screen (winner, scoreboard)
- [ ] Return to lobby option

### Milestone Checklist
- [ ] Can throw pillows
- [ ] Pillows hit walls and players
- [ ] Hearts decrease on hit
- [ ] Dead players are eliminated
- [ ] Pickups spawn and can be collected
- [ ] Timer counts down
- [ ] Winner is declared

---

## Phase 3: Darkness (Days 7-8)

### Goal
The core mechanic: darkness, flashlights, visibility.

### Tasks

#### 3.1 Base Darkness
- [ ] Dark arena background (#0a0a0c)
- [ ] All players default opacity: 0
- [ ] Self always visible (opacity: 1, glow outline)
- [ ] Pickups hidden unless close or lit

#### 3.2 Flashlight Toggle
- [ ] F key / right-click toggle
- [ ] `flashlightOn` state per player
- [ ] Send flashlight state to server
- [ ] Broadcast flashlight state to all

#### 3.3 Flashlight Cone Rendering
- [ ] CSS triangle/cone shape
- [ ] Position at player, rotate to facing
- [ ] Show/hide based on flashlight state
- [ ] Cone only visible to self (others see the light hitting things)

#### 3.4 Visibility Calculation
- [ ] `isPlayerVisible(viewer, target)` function
- [ ] Check: flashlight on?
- [ ] Check: target in cone (angle + distance)?
- [ ] Check: line of sight (no obstacle blocking)?
- [ ] Apply `.visible` class to visible players

#### 3.5 Line-of-Sight Raycast
- [ ] Simple stepped raycast (every 10px)
- [ ] Check each point against obstacle rects
- [ ] Return false if any point inside obstacle
- [ ] **Do NOT calculate polygon shadows** (too expensive)

#### 3.6 Muzzle Flash
- [ ] On any throw: set `muzzleFlashUntil` timestamp
- [ ] Broadcast muzzle flash state
- [ ] Client: `.muzzle-flash` class on arena
- [ ] During flash: all players visible
- [ ] Flash duration: 100ms

#### 3.7 Flashlight Flicker
- [ ] Track `flashlightOnSince` timestamp
- [ ] After 10 seconds: start flickering
- [ ] Flicker: rapid opacity toggle on cone
- [ ] Forces players to toggle, prevents camping

#### 3.8 Throw Accuracy
- [ ] Flashlight on: throw exactly where facing
- [ ] Flashlight off: add ±15° random spread
- [ ] Calculate spread server-side

### Milestone Checklist
- [ ] Arena is dark
- [ ] Can only see self by default
- [ ] Flashlight reveals players in cone
- [ ] Obstacles block line of sight
- [ ] Throws reveal entire room briefly
- [ ] Aiming is harder in darkness

---

## Phase 4: Audio (Day 9)

### Goal
Spatial audio that serves as gameplay information.

### Tasks

#### 4.1 Audio System Setup
- [ ] Web Audio API AudioContext
- [ ] Sound loading function (fetch + decode)
- [ ] Sound preloading on game start
- [ ] Master volume control

#### 4.2 Sound Files
- [ ] Create/source sound effects:
  - [ ] footstep-light.mp3
  - [ ] footstep-heavy.mp3
  - [ ] throw.mp3
  - [ ] hit-wall.mp3
  - [ ] hit-player.mp3
  - [ ] pickup.mp3
  - [ ] flashlight.mp3
  - [ ] death.mp3
  - [ ] countdown.mp3
  - [ ] start.mp3
  - [ ] victory.mp3
  - [ ] warning.mp3

#### 4.3 Non-Positional Sounds
- [ ] Play function (name, volume)
- [ ] Countdown beeps
- [ ] Game start horn
- [ ] Victory fanfare
- [ ] Your own flashlight clicks

#### 4.4 Spatial Audio
- [ ] `playPositional(name, sourceX, sourceY, listenerX, listenerY)`
- [ ] StereoPanner for left/right pan
- [ ] GainNode for distance falloff
- [ ] Calculate pan from relative X position
- [ ] Calculate volume from distance (linear falloff)

#### 4.5 Sound Events
- [ ] Server broadcasts sound events
- [ ] `['sound', type, x, y]` in event array
- [ ] Client plays positional audio for:
  - [ ] Other players' footsteps
  - [ ] Throws (anyone)
  - [ ] Hits (wall and player)
  - [ ] Pickups
  - [ ] Deaths

#### 4.6 Footstep System
- [ ] Track last footstep time per player
- [ ] Walking: footstep every 400ms
- [ ] Sprinting: footstep every 250ms, louder
- [ ] Broadcast footstep events to all players

### Milestone Checklist
- [ ] All sounds play correctly
- [ ] Can locate other players by sound
- [ ] Sprinting is audibly louder
- [ ] Stereo pan works (left/right)
- [ ] Distance affects volume

---

## Phase 5: Visual Effects (Day 10)

### Goal
Game feel: juice, impact, feedback.

### Tasks

#### 5.1 Sound Ripples (Accessibility)
- [ ] Ripple pool (30 pre-allocated divs)
- [ ] `showSoundRipple(x, y, type)` function
- [ ] CSS animation: scale up + fade out
- [ ] Different colors for footstep/throw/hit
- [ ] Spawn on footstep events (near player only)
- [ ] Spawn on throw events (always)
- [ ] Spawn on hit events (always)

#### 5.2 Impact Flash
- [ ] Flash div at hit location
- [ ] Radial gradient, 60px
- [ ] Scale up + fade out animation
- [ ] Remove after animation

#### 5.3 Screen Shake
- [ ] `.shake` class on arena container
- [ ] Trigger on player getting hit (self only)
- [ ] Short duration (200ms)
- [ ] Disable option for accessibility

#### 5.4 Hit Feedback
- [ ] Invincibility flash (opacity pulse)
- [ ] Player knockback visual
- [ ] Brief color flash on hit player

#### 5.5 Death Animation
- [ ] Grayscale filter
- [ ] Shrink transform
- [ ] Fade out
- [ ] 500ms duration

#### 5.6 Player Sprites
- [ ] Replace colored squares with proper sprites
- [ ] Direction indicator (triangle/nose)
- [ ] Player color applied via CSS filter or outline
- [ ] Pattern overlay for colorblind mode

### Milestone Checklist
- [ ] Sound ripples show footsteps/throws
- [ ] Hits feel impactful (flash, shake)
- [ ] Deaths are visible and dramatic
- [ ] Game has "juice"

---

## Phase 6: UI/UX (Day 11)

### Goal
Complete, polished user interface.

### Tasks

#### 6.1 Menu Screen
- [ ] Title: "LIGHTS OUT"
- [ ] Create Room button
- [ ] Join Room (code input)
- [ ] Name input
- [ ] Settings button (audio volume, keybinds)

#### 6.2 Lobby Screen
- [ ] Room code (large, copyable)
- [ ] Player list with colors and ready status
- [ ] Ready/Unready button
- [ ] Settings (lives, time) for host
- [ ] Start button (host only, 2+ ready required)
- [ ] Leave button

#### 6.3 HUD
- [ ] Hearts display (top-left)
- [ ] Ammo indicator (pillow icon)
- [ ] Timer (top-right, MM:SS)
- [ ] Pause button (≡ icon)
- [ ] Scoreboard bar (bottom)
- [ ] All players' hearts visible

#### 6.4 Pause Menu
- [ ] Overlay with blur
- [ ] "[Player] paused the game" message
- [ ] Resume button (only for pauser)
- [ ] Quit button (for anyone)
- [ ] Settings access

#### 6.5 Game Over Screen
- [ ] Winner announcement (large)
- [ ] Final scoreboard (kills, deaths, hearts remaining)
- [ ] Play Again button (returns to lobby)
- [ ] Auto-return timer (30s)

#### 6.6 Notifications
- [ ] Player joined/left messages
- [ ] Player paused/resumed messages
- [ ] 30 seconds remaining warning
- [ ] Sudden death announcement

#### 6.7 Countdown
- [ ] 3-2-1-GO overlay
- [ ] Large numbers, center screen
- [ ] Sound for each tick

### Milestone Checklist
- [ ] Complete flow: menu → lobby → game → game over → lobby
- [ ] All required UI elements present
- [ ] Pause works for all players
- [ ] Timer and scores visible throughout

---

## Phase 7: Polish & Testing (Days 12-14)

### Goal
Bug-free, performant, ready for submission.

### Tasks

#### 7.1 Performance Optimization
- [ ] Chrome DevTools profiling
- [ ] Identify and fix frame drops
- [ ] Reduce unnecessary DOM operations
- [ ] Optimize collision checks
- [ ] Test with 4 players + rapid actions

#### 7.2 Edge Cases
- [ ] Player disconnects mid-game
- [ ] Host disconnects (migrate or end)
- [ ] Player quits, then game ends
- [ ] Sudden death tie resolution
- [ ] All players die simultaneously
- [ ] Very high latency behavior

#### 7.3 Network Testing
- [ ] Test with ngrok
- [ ] Test with simulated lag
- [ ] Test rapid input spam
- [ ] Test reconnection scenarios

#### 7.4 Cross-Browser
- [ ] Chrome (primary)
- [ ] Firefox
- [ ] Safari (if Mac available)
- [ ] Edge

#### 7.5 Bug Fixes
- [ ] List all known issues
- [ ] Prioritize and fix
- [ ] Regression testing

#### 7.6 Documentation
- [ ] Update README with final instructions
- [ ] Code comments for complex logic
- [ ] Ensure all docs match implementation

#### 7.7 Final Testing
- [ ] Full playthrough with 4 players
- [ ] All requirements checklist
- [ ] Record demo video (optional)

### Milestone Checklist
- [ ] No known bugs
- [ ] 60 FPS maintained
- [ ] Works on target browsers
- [ ] All requirements met
- [ ] Documentation complete

---

## Bonus Features (If Time Permits)

Only attempt these after Phase 7 is complete.

### Bonus 1: The Counselor Event
- [ ] Random timer (60-90 seconds)
- [ ] "SHHH!" warning (2 seconds)
- [ ] NPC flashlight sweep across arena
- [ ] Players in sweep lose 1 heart
- [ ] ~2-4 hours estimated

### Bonus 2: Power-Ups
- [ ] Spawn system (every 45 seconds)
- [ ] 4 power-up types:
  - Night Vision (full visibility 10s)
  - Extra Heart (+1, max 5)
  - Speed Boost (1.5x, 8s)
  - Bouncing Pillow (reflects once)
- [ ] UI indicator when active
- [ ] ~4-6 hours estimated

### Bonus 3: Chat
- [ ] Lobby-only text chat
- [ ] Input field and message list
- [ ] Message broadcast to room
- [ ] ~1-2 hours estimated

### Bonus 4: Spectator Mode
- [ ] Dead players see full map
- [ ] No darkness for spectators
- [ ] Cannot interact
- [ ] ~2-3 hours estimated

### Bonus 5: Accessibility Menu
- [ ] Colorblind mode toggle
- [ ] High contrast toggle
- [ ] Reduced motion toggle
- [ ] Sound visualization toggle (always-on ripples)
- [ ] Key rebinding UI
- [ ] ~3-4 hours estimated

---

## Daily Schedule Template

```
Day N:
  Morning (3-4 hrs):
    - [ ] Task A
    - [ ] Task B
  
  Afternoon (3-4 hrs):
    - [ ] Task C
    - [ ] Task D
  
  End of Day:
    - [ ] Test current state
    - [ ] Commit to git
    - [ ] Note issues for tomorrow
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Networking takes too long | Skeleton first, features second |
| FPS drops | Profile early, optimize continuously |
| Audio doesn't work | Non-critical, can ship without |
| Darkness too hard to play | Adjust flashlight range/cone |
| Not fun | Playtest early, iterate |

---

## Definition of Done (For Submission)

- [ ] Game loads in browser
- [ ] Can create and join rooms
- [ ] 2-4 players can play simultaneously
- [ ] Real-time movement and combat
- [ ] Darkness and flashlight mechanic works
- [ ] Sound effects present
- [ ] Pause/Resume/Quit menu functional
- [ ] Timer and scoring visible
- [ ] Winner declared at end
- [ ] 60 FPS maintained
- [ ] README has setup instructions
- [ ] Code is reasonably organized
