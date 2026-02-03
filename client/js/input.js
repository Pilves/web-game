// Input handler for keyboard and mouse
import { controls, CONFIG } from './config.js';

export class Input {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.mouseX = 0;
    this.mouseY = 0;
    // Default facing angle (0 = right/east). Updated on mouse move when localPlayer exists.
    // If mouse never moves, player faces right by default.
    this.facing = 0;
    this.flashlightToggle = false;
    this.throwPending = false;

    // Store handler references for cleanup
    this._handlers = {};

    this.bindEvents();
  }

  bindEvents() {
    // Define handlers as bound methods for later removal
    this._handlers.keydown = (e) => {
      // Don't capture keys when typing in input fields
      if (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable) {
        return;
      }

      this.keys[e.code] = true;

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
      }

      if (controls.isAction('throw', e.code) && !e.repeat) {
        this.throwPending = true;
      }

      if (controls.isAction('pause', e.code)) {
        this.game.togglePause();
      }
    };

    this._handlers.keyup = (e) => {
      // Don't track key releases from input fields
      if (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable) {
        return;
      }
      this.keys[e.code] = false;
    };

    this._handlers.mousemove = (e) => {
      const arena = document.getElementById('arena');
      if (!arena) return;

      const rect = arena.getBoundingClientRect();

      // Prevent division by zero if arena has no dimensions
      if (rect.width <= 0 || rect.height <= 0) return;

      const scaleX = CONFIG.ARENA_WIDTH / rect.width;
      const scaleY = CONFIG.ARENA_HEIGHT / rect.height;

      this.mouseX = (e.clientX - rect.left) * scaleX;
      this.mouseY = (e.clientY - rect.top) * scaleY;

      const localPlayer = this.game.localPlayer;
      if (!localPlayer) return;

      const playerX = localPlayer.x;
      const playerY = localPlayer.y;

      if (typeof playerX !== 'number' || typeof playerY !== 'number' ||
          Number.isNaN(playerX) || Number.isNaN(playerY)) {
        return;
      }

      const dx = this.mouseX - playerX;
      const dy = this.mouseY - playerY;
      this.facing = Math.atan2(dy, dx);
    };

    this._handlers.mousedown = (e) => {
      // Don't capture mouse input when interacting with input fields
      if (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable) {
        return;
      }

      if (e.button === 0) {
        this.keys['Mouse0'] = true;  // Left click
        // Check if left click is throw action
        if (controls.isAction('throw', 'Mouse0')) {
          this.throwPending = true;
        }
      }
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
      // Don't track mouse releases from input fields
      if (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable) {
        return;
      }

      if (e.button === 0) this.keys['Mouse0'] = false;
      if (e.button === 1) this.keys['Mouse1'] = false;
      if (e.button === 2) this.keys['Mouse2'] = false;
    };

    this._handlers.contextmenu = (e) => e.preventDefault();

    this._handlers.blur = () => {
      this.keys = {};
      this.throwPending = false;
      this.flashlightToggle = false;
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
      const keys = controls.get(action) || [];
      return keys.some(key => !!this.keys[key]);
    };

    const input = {
      up: isPressed('up'),
      down: isPressed('down'),
      left: isPressed('left'),
      right: isPressed('right'),
      sprint: isPressed('sprint'),
      throw: this.throwPending,  // Use pending flag like flashlight
      flashlight: this.flashlightToggle,
      facing: this.facing,
    };

    // Only reset toggle/pending flags when actually consuming (sending to server)
    if (consumeToggles) {
      this.flashlightToggle = false;
      this.throwPending = false;
    }

    return input;
  }

  reset() {
    this.keys = {};
    this.flashlightToggle = false;
    this.throwPending = false;
    // facing intentionally not reset
  }
}
