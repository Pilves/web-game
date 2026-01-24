// Spatial audio system using Web Audio API
import { createSoundGenerator } from '../assets/sounds/generated-sounds.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.sounds = {};
    this.enabled = true;
    this.masterVolume = 0.7;
    this.loaded = false;
    this.soundGenerator = null;
  }

  // Initialize audio context (must be called after user interaction)
  async init() {
    if (this.ctx) return;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.soundGenerator = createSoundGenerator(this.ctx);
    await this.loadSounds();
    this.loaded = true;
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

    // Track which sounds failed to load
    const failedSounds = [];

    const loadPromises = Object.entries(soundFiles).map(async ([name, url]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(`Sound file not found: ${name}, will use generated fallback`);
          failedSounds.push(name);
          return;
        }
        const arrayBuffer = await response.arrayBuffer();
        this.sounds[name] = await this.ctx.decodeAudioData(arrayBuffer);
      } catch (e) {
        console.warn(`Failed to load sound: ${name}, will use generated fallback`, e);
        failedSounds.push(name);
      }
    });

    await Promise.all(loadPromises);

    // Generate fallback sounds for any that failed to load
    if (failedSounds.length > 0) {
      console.log(`Generating ${failedSounds.length} fallback sounds...`);
      const generatedSounds = this.soundGenerator.generateAllSounds();

      for (const name of failedSounds) {
        if (generatedSounds[name]) {
          this.sounds[name] = generatedSounds[name];
          console.log(`Generated fallback for: ${name}`);
        }
      }
    }

    console.log('Audio loaded:', Object.keys(this.sounds).length, 'sounds');
  }

  // Generate all sounds synthetically (useful when no MP3 files are available)
  generateAllFallbackSounds() {
    if (!this.soundGenerator) {
      console.error('Sound generator not initialized');
      return;
    }

    const generatedSounds = this.soundGenerator.generateAllSounds();
    for (const [name, buffer] of Object.entries(generatedSounds)) {
      // Only replace if sound doesn't exist
      if (!this.sounds[name]) {
        this.sounds[name] = buffer;
      }
    }

    console.log('All fallback sounds generated');
  }

  // Resume audio context (required after user interaction)
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Play a non-positional sound (UI, self actions)
  play(name, volume = 1) {
    if (!this.enabled || !this.ctx || !this.sounds[name]) return;

    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();

    source.buffer = this.sounds[name];
    gain.gain.value = volume * this.masterVolume;

    source.connect(gain).connect(this.ctx.destination);
    source.start();
  }

  // Play a positional sound (other players' actions)
  playPositional(name, sourceX, sourceY, listenerX, listenerY, volume = 1) {
    if (!this.enabled || !this.ctx || !this.sounds[name]) return;

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
    const maxAudioDistance = 800; // Full arena diagonal roughly
    const distanceVolume = Math.max(0, 1 - (distance / maxAudioDistance));
    gain.gain.value = volume * distanceVolume * this.masterVolume;

    source.connect(panner).connect(gain).connect(this.ctx.destination);
    source.start();
  }

  // Set master volume (0-1)
  setVolume(volume) {
    this.masterVolume = Math.max(0, Math.min(1, volume));
  }

  // Enable/disable audio
  setEnabled(enabled) {
    this.enabled = enabled;
  }
}

// Export singleton instance
export const audio = new Audio();
