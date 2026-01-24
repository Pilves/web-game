# LIGHTS OUT

## Game Design Document v2.1

---

## Identity

**Tagline:** *"In the dark, everyone's a target."*

**Genre:** Top-down stealth-action brawler

**Players:** 2-4 simultaneous, real-time

**Platform:** DOM-only browser game (no canvas)

**Target:** 60 FPS constant, jank-free

---

## The Premise

Summer camp. 11 PM. Lights out was called an hour ago.

Someone threw the first pillow. Now it's war.

The counselors cut the power. You're fighting in the dark with nothing but your flashlight, your arm, and your instincts.

---

## Core Design Philosophy

This isn't a pillow fight game with a darkness mode. **Darkness IS the game.**

You can't see shit. Your flashlight reveals a cone in front of you - but it also reveals YOU to everyone else. Do you stay dark and listen for footsteps? Or light up and hunt?

The tension comes from **information asymmetry**. You hear a thud to your left. Was that a pillow hitting a wall? Someone picking one up? You don't know. You flick your flashlight. Nothing. You turn it off. Then you see it - a cone of light sweeping toward you from the corner.

---

## Core Loop

```
[DARK] → hear sound → decide: light or hide?
                ↓                    ↓
          [FLASHLIGHT ON]      [STAY DARK]
              ↓                      ↓
        see enemies            move by sound
        enemies see YOU        can't aim well
              ↓                      ↓
          [THROW] ←──────────── [THROW]
              ↓
        [HIT OR MISS]
              ↓
         repeat until
        one remains
```

---

## Controls

| Action | Primary | Alternative |
|--------|---------|-------------|
| Move | WASD | Arrow Keys |
| Sprint | Hold Shift | - |
| Throw Pillow | Space | Left Click |
| Toggle Flashlight | F | Right Click |
| Pause Menu | Escape | - |

---

## Mechanics

### Vision System

**Base visibility:** Near-zero. Screen is almost black except for:
- Your character (subtle glow outline so you know where YOU are)
- Flashlight cones (yours and others')
- Muzzle flashes (brief FULL ROOM flash when pillow is thrown - 100ms)
- Impact sparks (brief flash on impact)
- Sound ripples (visual indicator of nearby sounds)

**Flashlight:**
- Toggle with `F` or right-click
- Reveals 60° cone, ~200px range
- YOU ARE VISIBLE TO ANYONE LOOKING AT YOUR CONE
- Battery: Unlimited BUT flickers after 10 seconds continuous use (forces toggle, prevents camping)

**The Muzzle Flash Mechanic:**
When ANY player throws a pillow, the darkness overlay is removed for 100ms. The ENTIRE room is visible. Everyone sees a snapshot of the battlefield. This creates:
- Risk to throwing (you reveal yourself)
- Information bursts (you see where everyone is)
- Tension (the flash is coming, brace yourself)

**Sound Visualization (Accessibility):**
When a player sprints or throws, a visual "sound ripple" spawns at their feet - an expanding circle that fades out. This allows:
- Deaf players to participate fully
- Players without headphones to play
- Additional tactical information layer

---

### Movement

| Mode | Speed | Sound Level | Notes |
|------|-------|-------------|-------|
| Walk | 180px/sec | Quiet | Subtle footstep every 400ms |
| Sprint | 280px/sec | LOUD | Heavy footstep every 250ms, audible across arena |

**Physics:**
- Normalized diagonal movement (no faster when moving diagonally)
- Slight friction/slide on stop (lerp velocity to zero over 100ms)
- Rectangular collision against walls and obstacles

**The Stealth Tradeoff:**
- Walk = quiet but slow
- Sprint = fast but audible (and visible via sound ripples)
- Flashlight + Sprint = "COME KILL ME" mode

---

### Combat

**Ammunition:**
- Start with 1 pillow
- Pillows on ground have faint glow (only visible within ~50px or with flashlight)
- Max carry: 1
- Thrown pillows can be picked up by anyone
- 4 pillows spawn on map at round start

**Throwing:**
| Condition | Accuracy | Notes |
|-----------|----------|-------|
| Flashlight ON | Perfect | Travels exactly where you're facing |
| Flashlight OFF | ±15° spread | Random deviation, you're guessing |

**Projectile:**
- Speed: 500px/sec
- Despawns on: wall hit, player hit, or 2 seconds flight time
- Hitbox: 20x20px

**Getting Hit:**
- Lose 1 heart (start with 3)
- Drop your pillow (if holding)
- Brief stun (300ms no movement)
- Invincibility frames (1.5 seconds)
- Your position revealed by impact flash
- Knockback: pushed 30px away from projectile direction

---

### Win Conditions

**Primary:** Last player with hearts > 0

**Timeout:** Most hearts when 3-minute timer hits 0

**Tiebreaker - Sudden Death:**
- All tied players respawn center with 1 heart
- Arena walls close in (CSS animation shrinking playable area by 50px every 5 seconds)
- First death loses

---

## The Arena

```
┌─────────────────────────────────────────────┐
│ ▓▓▓                               ▓▓▓       │
│ ▓▓▓   [P1]                        ▓▓▓  [P2] │
│ BED                               BED       │
│                                             │
│         ┌─────────────────┐                 │
│         │                 │                 │
│         │     TABLE       │                 │
│         │                 │                 │
│         └─────────────────┘                 │
│                                             │
│ ▓▓▓                               ▓▓▓       │
│ ▓▓▓   [P3]                        ▓▓▓  [P4] │
│ BED                               BED       │
└─────────────────────────────────────────────┘
```

**Dimensions:** 1200x800px play area (scales to viewport via CSS transform)

**Obstacles:**
- 4 beds (corners): 80x120px each
- 1 center table: 200x100px
- All obstacles block: movement, projectiles, AND line-of-sight

**Spawn Points:**
- P1: (100, 100)
- P2: (1060, 100)
- P3: (100, 660)
- P4: (1060, 660)

**Pillow Spawns:** 4 locations, respawn 5 seconds after pickup
- (300, 200)
- (900, 200)
- (300, 600)
- (900, 600)

---

## Game States

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐           │
│  │  LOBBY  │────►│COUNTDOWN│────►│ PLAYING │◄────┐     │
│  └─────────┘     └─────────┘     └─────────┘     │     │
│       ▲               3-2-1           │          │     │
│       │                               ▼          │     │
│       │                         ┌─────────┐     │     │
│       │                         │ PAUSED  │─────┘     │
│       │                         └─────────┘           │
│       │                               │               │
│       │                               ▼               │
│       │                         ┌─────────┐           │
│       └─────────────────────────│GAME OVER│           │
│            (Play Again)         └─────────┘           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Lobby State
- Host creates room, gets 4-letter code
- Others join via code
- Players can ready/unready
- Host can kick players
- Host can adjust settings (lives: 1-5, time: 1-5 min)
- Game starts when host clicks Start AND 2+ players ready

### Pause State
- Any player can pause (ESC)
- Server broadcasts who paused
- All clients freeze physics (render loop continues for UI)
- Resume: Only the player who paused can resume
- Quit: Any player can quit (returns them to lobby, game continues for others)

### Game Over State
- Winner announced with fanfare
- Scoreboard: kills, deaths, accuracy
- "Play Again" returns all players to lobby
- Auto-return to lobby after 30 seconds

---

## HUD Layout

```
┌─────────────────────────────────────────────────────────┐
│ ♥♥♥  [●]                                    2:45  [≡]  │
│ Patric                                                  │
│                                                         │
│                                                         │
│                      (game arena)                       │
│                                                         │
│                                                         │
│                                                         │
│ ─────────────────────────────────────────────────────── │
│  Patric ♥♥♥    Guest ♥♥    Anon ♥♥♥    Noob ♥         │
└─────────────────────────────────────────────────────────┘
```

**Top-left:** Your hearts + ammo indicator (● filled = holding pillow, ○ empty = no pillow)

**Top-right:** Timer (MM:SS) + menu button (☰)

**Bottom bar:** All players' status - always visible regardless of darkness
- Player name (colored to match their character)
- Current hearts
- Updates in real-time

---

## Audio Design

Sound is **50% of this game**. In darkness, audio IS your vision.

### Sound Library

| Event | Sound | Spatial | Volume | Notes |
|-------|-------|---------|--------|-------|
| Footstep (walk) | Soft tap | Yes | 30% | Every 400ms while moving |
| Footstep (sprint) | Loud thump | Yes | 80% | Every 250ms, audible across arena |
| Pillow pickup | Fabric rustle | Yes | 50% | |
| Pillow throw | Whoosh | Yes | 60% | Triggers muzzle flash |
| Pillow hit wall | Dull thud | Yes | 40% | |
| Pillow hit player | Smack + "oof" | Yes | 70% | |
| Flashlight on | Click | No | 20% | Only you hear your own |
| Flashlight off | Click | No | 20% | |
| Player death | Dramatic thud | Yes | 80% | |
| Round start | Air horn | No | 100% | |
| Round end | Victory sting | No | 100% | |
| 30 sec warning | Alarm beep | No | 60% | |
| Countdown tick | Beep | No | 50% | 3, 2, 1 |

### Spatial Audio Rules
- Sounds have stereo panning based on relative X position to listener
- Sounds have volume falloff based on distance (linear, 0 at 800px)
- Your own sounds play at fixed volume (no spatial processing)

---

## Visual Style

### Color Palette

| Element | Color | Hex |
|---------|-------|-----|
| Background (dark) | Near black | #0a0a0c |
| Background (lit) | Dark gray | #1a1a1e |
| Player 1 | Coral red | #ff6b6b |
| Player 2 | Teal | #4ecdc4 |
| Player 3 | Gold | #ffe66d |
| Player 4 | Lavender | #c3aed6 |
| Flashlight cone | Warm white | rgba(255, 250, 230, 0.3) |
| Obstacles | Dark brown | #2d2520 |
| Pillow (ground) | Soft glow | rgba(255, 255, 255, 0.15) |
| UI text | White | #ffffff |
| UI accent | Soft blue | #6c9bff |

### Player Sprite
- 40x40px character
- Simple top-down view (circle with direction indicator)
- Colored outline matching player color
- Direction shown via small triangle/nose pointing facing direction

### Visual Effects
1. **Impact flash:** Radial gradient burst, 60px, 150ms
2. **Sound ripple:** Expanding circle border, fades over 500ms
3. **Screen shake:** 5px random offset for 200ms on hit
4. **Death:** Character fades to gray, shrinks, 500ms
5. **Invincibility:** Rapid opacity pulse (100ms on/off)

---

## Accessibility Features

### Colorblind Mode
- Players identified by patterns in addition to colors:
  - P1: Solid
  - P2: Horizontal stripes
  - P3: Vertical stripes
  - P4: Dots
- Enabled in settings menu

### High Contrast Mode
- Brighter flashlight cone
- Stronger player outlines
- Higher contrast between lit/dark areas

### Reduced Motion Mode
- Disables screen shake
- Slower transitions
- Static elements instead of particles

### Sound Visualization
- Always-on sound ripples (not just when sounds occur near you)
- Ripple size indicates sound volume
- Ripple color indicates sound type (footstep vs throw vs hit)

### Key Rebinding
- All controls remappable in settings
- Stored in localStorage

---

## Bonus Features (If Time Permits)

### "The Counselor" Event
- Random event every 60-90 seconds
- Warning: "SHHH!" text appears for 2 seconds
- Event: Large flashlight sweeps across room (NPC controlled)
- Anyone caught in the sweep loses 1 heart
- Creates panic moments, forces everyone to hide

### Power-Ups
Spawn rarely (every 45 seconds), glow brighter than pillows:
- **Night Vision (green):** 10 seconds of full visibility
- **Extra Heart (red):** +1 heart (max 5)
- **Speed Boost (yellow):** 1.5x speed for 8 seconds
- **Bouncing Pillow (blue):** Next throw bounces off one wall

### Spectator Mode
- Dead players see full map (no darkness)
- Cannot interact or communicate
- Can still see all sound ripples

### Chat
- Pre-game lobby text chat only
- No in-game chat (would break tension)

---

## Anti-Cheat Considerations

### The "Inspect Element" Problem
Browser games are vulnerable to CSS inspection. A player could:
- Remove `opacity: 0` from enemy elements
- Disable the darkness overlay
- See everyone's position

### MVP Solution (Acceptable)
- Ignore it. It's a party game with friends.
- Trust-based multiplayer

### Production Solution (If Time)
- **Server-Side Fog of War:** Server only sends enemy positions when:
  - Enemy is in your flashlight cone AND no obstacle between you
  - Enemy made a sound in last 500ms (for sound ripple)
  - Muzzle flash is active (everyone visible)
- This makes client-side hacking useless (no data to reveal)
- Adds complexity to networking logic

---

## Balancing Notes

These values are starting points. Playtest and adjust:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Player speed (walk) | 180px/sec | Feels deliberate |
| Player speed (sprint) | 280px/sec | ~1.5x walk |
| Projectile speed | 500px/sec | Fast but dodgeable |
| Flashlight range | 200px | ~1/6 of arena width |
| Flashlight angle | 60° | Wide enough to be useful |
| Starting hearts | 3 | Quick games |
| Invincibility time | 1.5s | Time to escape |
| Throw cooldown | 500ms | Prevents spam |
| Stun duration | 300ms | Punishing but brief |
| Muzzle flash duration | 100ms | Snapshot, not sustained |
| Flashlight flicker threshold | 10s | Forces toggle |

---

## Reference Games

- **Hotline Miami:** Top-down violence, screen shake, impact feel
- **Monaco:** Stealth, vision cones, multiplayer chaos
- **Crawl:** Local multiplayer, simple mechanics, high replayability
- **Nidhogg:** 1v1 tension, simple controls, depth through positioning
