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

    // Store handler references for cleanup
    this._handlers = {};

    this.bindEvents();
    console.log('[Input] Events bound');
  }

  bindEvents() {
    // Define handlers as bound methods for later removal
    this._handlers.keydown = (e) => {
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
    };

    this._handlers.keyup = (e) => {
      // Don't track key releases from input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      this.keys[e.code] = false;
    };

    this._handlers.mousemove = (e) => {
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
    };

    this._handlers.mousedown = (e) => {
      if (e.button === 0) this.keys['Mouse0'] = true;  // Left click
      if (e.button === 1) this.keys['Mouse1'] = true;  // Middle click
      if (e.button === 2) {
        this.keys['Mouse2'] = true;  // Right click
        // Check if right click is flashlight toggle
        if (controls.isAction('flashlight', 'Mouse2')) {
          this.flashlightToggle = true;
        }
      }
    };

    this._handlers.mouseup = (e) => {
      if (e.button === 0) this.keys['Mouse0'] = false;
      if (e.button === 1) this.keys['Mouse1'] = false;
      if (e.button === 2) this.keys['Mouse2'] = false;
    };

    this._handlers.contextmenu = (e) => e.preventDefault();

    this._handlers.blur = () => {
      this.keys = {};
    };

    // Add all event listeners
    window.addEventListener('keydown', this._handlers.keydown);
    window.addEventListener('keyup', this._handlers.keyup);
    window.addEventListener('mousemove', this._handlers.mousemove);
    window.addEventListener('mousedown', this._handlers.mousedown);
    window.addEventListener('mouseup', this._handlers.mouseup);
    window.addEventListener('contextmenu', this._handlers.contextmenu);
    window.addEventListener('blur', this._handlers.blur);
  }

  // Remove all event listeners to prevent memory leaks
  destroy() {
    if (this._handlers) {
      window.removeEventListener('keydown', this._handlers.keydown);
      window.removeEventListener('keyup', this._handlers.keyup);
      window.removeEventListener('mousemove', this._handlers.mousemove);
      window.removeEventListener('mousedown', this._handlers.mousedown);
      window.removeEventListener('mouseup', this._handlers.mouseup);
      window.removeEventListener('contextmenu', this._handlers.contextmenu);
      window.removeEventListener('blur', this._handlers.blur);
      this._handlers = {};
    }
  }

  getState(consumeToggles = true) {
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

    // Only reset toggle flags when actually consuming (sending to server)
    if (consumeToggles) {
      this.flashlightToggle = false;
    }

    return input;
  }

  // Reset all input state
  reset() {
    this.keys = {};
    this.flashlightToggle = false;
  }
}
