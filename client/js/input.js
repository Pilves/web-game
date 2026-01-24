// Input handler for keyboard and mouse
import { controls } from './config.js';

export class Input {
  constructor(game) {
    console.log('[Input] Constructor called');
    this.game = game;
    this.keys = {};
    this.mouseX = 0;
    this.mouseY = 0;
    this.facing = 0;
    this.flashlightToggle = false;
    this._loggedKeys = false;

    this.bindEvents();
    console.log('[Input] Events bound');
  }

  bindEvents() {
    window.addEventListener('keydown', (e) => {
      // Don't capture keys when typing in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      this.keys[e.code] = true;

      // Log first movement key press
      if (!this._loggedKeys && (controls.isAction('up', e.code) || controls.isAction('down', e.code) ||
          controls.isAction('left', e.code) || controls.isAction('right', e.code))) {
        console.log('[Input] First movement key detected:', e.code);
        this._loggedKeys = true;
      }

      // Prevent defaults for game keys (only during gameplay)
      if (this.game.state === 'playing') {
        if (controls.isAction('up', e.code) || controls.isAction('down', e.code) ||
            controls.isAction('left', e.code) || controls.isAction('right', e.code) ||
            controls.isAction('throw', e.code)) {
          e.preventDefault();
        }
      }

      // Handle flashlight toggle (not hold)
      if (controls.isAction('flashlight', e.code) && !e.repeat) {
        this.flashlightToggle = true;
        console.log('[Input] Flashlight toggle');
      }

      // Pause
      if (controls.isAction('pause', e.code)) {
        console.log('[Input] Pause pressed');
        this.game.togglePause();
      }
    });

    window.addEventListener('keyup', (e) => {
      // Don't track key releases from input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      this.keys[e.code] = false;
    });

    window.addEventListener('mousemove', (e) => {
      const arena = document.getElementById('arena');
      if (!arena) return;

      const rect = arena.getBoundingClientRect();
      const scaleX = 1200 / rect.width;
      const scaleY = 800 / rect.height;

      this.mouseX = (e.clientX - rect.left) * scaleX;
      this.mouseY = (e.clientY - rect.top) * scaleY;

      // Calculate facing angle from local player position to mouse
      if (this.game.localPlayer) {
        const dx = this.mouseX - this.game.localPlayer.x;
        const dy = this.mouseY - this.game.localPlayer.y;
        this.facing = Math.atan2(dy, dx);
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.keys['Mouse0'] = true;  // Left click
      if (e.button === 1) this.keys['Mouse1'] = true;  // Middle click
      if (e.button === 2) {
        this.keys['Mouse2'] = true;  // Right click
        // Check if right click is flashlight toggle
        if (controls.isAction('flashlight', 'Mouse2')) {
          this.flashlightToggle = true;
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.keys['Mouse0'] = false;
      if (e.button === 1) this.keys['Mouse1'] = false;
      if (e.button === 2) this.keys['Mouse2'] = false;
    });

    // Prevent context menu on right click
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // Handle window blur - reset all keys
    window.addEventListener('blur', () => {
      this.keys = {};
    });
  }

  getState() {
    // Check each action against configured keys
    const isPressed = (action) => {
      const keys = controls.get(action);
      return keys.some(key => this.keys[key]);
    };

    const input = {
      up: isPressed('up'),
      down: isPressed('down'),
      left: isPressed('left'),
      right: isPressed('right'),
      sprint: isPressed('sprint'),
      throw: isPressed('throw'),
      flashlight: this.flashlightToggle,
      facing: this.facing,
    };

    // Reset toggle flags after reading
    this.flashlightToggle = false;

    return input;
  }

  // Reset all input state
  reset() {
    this.keys = {};
    this.flashlightToggle = false;
  }
}
