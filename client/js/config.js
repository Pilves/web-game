// Client-side configuration constants
export const CONFIG = {
  // Arena
  ARENA_WIDTH: 1200,
  ARENA_HEIGHT: 800,

  // Player
  PLAYER_SIZE: 40,
  PLAYER_SPEED: 180,
  PLAYER_SPRINT_SPEED: 280,

  // Combat
  PROJECTILE_SIZE: 20,

  // Vision
  FLASHLIGHT_RANGE: 200,
  FLASHLIGHT_ANGLE: 60,  // degrees

  // Networking
  INPUT_SEND_RATE: 60,    // Hz - match physics tick
  INTERPOLATION_DELAY: 50, // ms - time between server updates

  // Visual
  PLAYER_COLORS: [
    '#ff6b6b',  // Coral red - P1
    '#4ecdc4',  // Teal - P2
    '#ffe66d',  // Gold - P3
    '#c3aed6',  // Lavender - P4
  ],

  // Obstacles (must match server and CSS)
  OBSTACLES: [
    { x: 80, y: 80, width: 120, height: 80, type: 'bed' },
    { x: 1000, y: 80, width: 120, height: 80, type: 'bed' },
    { x: 80, y: 640, width: 120, height: 80, type: 'bed' },
    { x: 1000, y: 640, width: 120, height: 80, type: 'bed' },
    { x: 550, y: 350, width: 100, height: 100, type: 'table' },
  ],
};

// Default key bindings
export const DEFAULT_CONTROLS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  throw: ['Space', 'Mouse0'],
  flashlight: ['KeyF', 'Mouse2'],
  pause: ['Escape'],
};

// Controls manager - handles loading/saving keybindings
export class ControlsManager {
  constructor() {
    this.controls = this.load();
  }

  load() {
    try {
      const saved = localStorage.getItem('lightsout-controls');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge with defaults in case new controls were added
        return { ...DEFAULT_CONTROLS, ...parsed };
      }
    } catch (e) {
      console.warn('[Controls] Failed to load saved controls:', e);
    }
    return { ...DEFAULT_CONTROLS };
  }

  save() {
    try {
      localStorage.setItem('lightsout-controls', JSON.stringify(this.controls));
    } catch (e) {
      console.warn('[Controls] Failed to save controls:', e);
    }
  }

  get(action) {
    return this.controls[action] || [];
  }

  set(action, keys) {
    this.controls[action] = keys;
    this.save();
  }

  reset() {
    this.controls = { ...DEFAULT_CONTROLS };
    this.save();
  }

  // Check if a key code matches an action
  isAction(action, keyCode) {
    const keys = this.controls[action] || [];
    return keys.includes(keyCode);
  }

  // Get display name for a key code
  static getKeyDisplayName(code) {
    const names = {
      'KeyA': 'A', 'KeyB': 'B', 'KeyC': 'C', 'KeyD': 'D', 'KeyE': 'E',
      'KeyF': 'F', 'KeyG': 'G', 'KeyH': 'H', 'KeyI': 'I', 'KeyJ': 'J',
      'KeyK': 'K', 'KeyL': 'L', 'KeyM': 'M', 'KeyN': 'N', 'KeyO': 'O',
      'KeyP': 'P', 'KeyQ': 'Q', 'KeyR': 'R', 'KeyS': 'S', 'KeyT': 'T',
      'KeyU': 'U', 'KeyV': 'V', 'KeyW': 'W', 'KeyX': 'X', 'KeyY': 'Y',
      'KeyZ': 'Z',
      'Digit0': '0', 'Digit1': '1', 'Digit2': '2', 'Digit3': '3',
      'Digit4': '4', 'Digit5': '5', 'Digit6': '6', 'Digit7': '7',
      'Digit8': '8', 'Digit9': '9',
      'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
      'Space': 'Space', 'ShiftLeft': 'L-Shift', 'ShiftRight': 'R-Shift',
      'ControlLeft': 'L-Ctrl', 'ControlRight': 'R-Ctrl',
      'AltLeft': 'L-Alt', 'AltRight': 'R-Alt',
      'Escape': 'Esc', 'Enter': 'Enter', 'Tab': 'Tab',
      'Backspace': 'Backspace', 'Delete': 'Delete',
      'Mouse0': 'Left Click', 'Mouse1': 'Middle Click', 'Mouse2': 'Right Click',
    };
    return names[code] || code;
  }
}

export const controls = new ControlsManager();
