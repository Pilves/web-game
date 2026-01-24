// Procedural sound generator using Web Audio API
// Generates all game sounds synthetically when MP3 files are not available

export class SoundGenerator {
  constructor(audioContext) {
    this.ctx = audioContext;
  }

  // Create white noise buffer
  createNoiseBuffer(duration) {
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    return buffer;
  }

  // Apply ADSR envelope to gain node
  applyEnvelope(gainNode, attack, decay, sustain, release, startTime, duration) {
    const g = gainNode.gain;
    g.setValueAtTime(0, startTime);
    g.linearRampToValueAtTime(1, startTime + attack);
    g.linearRampToValueAtTime(sustain, startTime + attack + decay);
    g.setValueAtTime(sustain, startTime + duration - release);
    g.linearRampToValueAtTime(0, startTime + duration);
  }

  // 1. footstep-light - Soft tap (low-pass filtered noise burst, 50ms)
  generateFootstepLight() {
    const duration = 0.05;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      const envelope = Math.exp(-t * 80); // Fast decay
      const noise = Math.random() * 2 - 1;
      // Simple low-pass approximation
      data[i] = noise * envelope * 0.3;
    }

    // Apply simple smoothing (low-pass effect)
    for (let i = 1; i < data.length; i++) {
      data[i] = data[i] * 0.3 + data[i - 1] * 0.7;
    }

    return buffer;
  }

  // 2. footstep-heavy - Loud thump (bass-heavy noise burst, 80ms)
  generateFootstepHeavy() {
    const duration = 0.08;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      const envelope = Math.exp(-t * 40);
      // Low frequency thump with noise
      const bass = Math.sin(2 * Math.PI * 60 * t) * 0.7;
      const noise = (Math.random() * 2 - 1) * 0.3;
      data[i] = (bass + noise) * envelope * 0.5;
    }

    // Heavy low-pass smoothing
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < data.length; i++) {
        data[i] = data[i] * 0.2 + data[i - 1] * 0.8;
      }
    }

    return buffer;
  }

  // 3. throw - Whoosh (filtered noise sweep, 200ms)
  generateThrow() {
    const duration = 0.2;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      const progress = t / duration;
      // Envelope: quick attack, sustained, then decay
      const envelope = Math.sin(progress * Math.PI) * Math.exp(-t * 5);
      // Frequency sweep for whoosh effect
      const freqMod = 0.1 + progress * 0.9;
      const noise = Math.random() * 2 - 1;
      data[i] = noise * envelope * freqMod * 0.4;
    }

    // Variable smoothing based on position (creates sweep effect)
    const smoothed = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const progress = i / data.length;
      const smoothFactor = 0.9 - progress * 0.6; // More smoothing at start
      if (i > 0) {
        smoothed[i] = data[i] * (1 - smoothFactor) + smoothed[i - 1] * smoothFactor;
      } else {
        smoothed[i] = data[i];
      }
    }

    for (let i = 0; i < data.length; i++) {
      data[i] = smoothed[i];
    }

    return buffer;
  }

  // 4. hit-wall - Dull thud (low frequency impact, 100ms)
  generateHitWall() {
    const duration = 0.1;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      const envelope = Math.exp(-t * 30);
      // Very low frequency impact
      const impact = Math.sin(2 * Math.PI * 40 * t) * 0.6;
      const harmonics = Math.sin(2 * Math.PI * 80 * t) * 0.2;
      const noise = (Math.random() * 2 - 1) * 0.2 * Math.exp(-t * 60);
      data[i] = (impact + harmonics + noise) * envelope * 0.6;
    }

    return buffer;
  }

  // 5. hit-player - Smack + oof (impact + vocal-like formant, 150ms)
  generateHitPlayer() {
    const duration = 0.15;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;

      // Initial impact (first 30ms)
      let sample = 0;
      if (t < 0.03) {
        const impactEnv = Math.exp(-t * 100);
        sample += (Math.random() * 2 - 1) * impactEnv * 0.5;
        sample += Math.sin(2 * Math.PI * 100 * t) * impactEnv * 0.3;
      }

      // Vocal "oof" formant (overlapping, decaying)
      if (t > 0.01) {
        const vocalT = t - 0.01;
        const vocalEnv = Math.exp(-vocalT * 20) * Math.sin(vocalT * Math.PI / 0.14);
        // Formants for "oof" sound (F1 ~300Hz, F2 ~800Hz)
        const f1 = Math.sin(2 * Math.PI * 300 * vocalT);
        const f2 = Math.sin(2 * Math.PI * 800 * vocalT) * 0.4;
        const f3 = Math.sin(2 * Math.PI * 150 * vocalT) * 0.3;
        sample += (f1 + f2 + f3) * vocalEnv * 0.3;
      }

      data[i] = sample;
    }

    return buffer;
  }

  // 6. pickup - Fabric rustle (noise with band-pass filter, 100ms)
  generatePickup() {
    const duration = 0.1;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with modulated amplitude
    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      // Rustling envelope with slight modulation
      const envelope = Math.exp(-t * 25) * (1 + 0.5 * Math.sin(t * 200));
      const noise = Math.random() * 2 - 1;
      data[i] = noise * envelope * 0.3;
    }

    // Band-pass effect (mid frequencies)
    const filtered = new Float32Array(data.length);
    let prev1 = 0, prev2 = 0;
    for (let i = 0; i < data.length; i++) {
      // Simple band-pass: subtract low-passed and high-passed
      const lp = data[i] * 0.3 + prev1 * 0.7;
      const hp = data[i] - lp;
      filtered[i] = hp * 0.5 + (prev2 - hp) * 0.3;
      prev1 = lp;
      prev2 = hp;
    }

    for (let i = 0; i < data.length; i++) {
      data[i] = filtered[i];
    }

    return buffer;
  }

  // 7. flashlight - Click (short impulse, 20ms)
  generateFlashlight() {
    const duration = 0.02;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      // Sharp click with very fast decay
      const envelope = Math.exp(-t * 300);
      // Click is mostly high-frequency transient
      const click = Math.sin(2 * Math.PI * 2000 * t) * 0.5;
      const click2 = Math.sin(2 * Math.PI * 4000 * t) * 0.3;
      const noise = (Math.random() * 2 - 1) * 0.2;
      data[i] = (click + click2 + noise) * envelope * 0.4;
    }

    return buffer;
  }

  // 8. death - Dramatic thud (low reverb impact, 300ms)
  generateDeath() {
    const duration = 0.3;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;

      // Heavy initial impact
      const impactEnv = Math.exp(-t * 15);
      const impact = Math.sin(2 * Math.PI * 35 * t) * impactEnv;
      const impact2 = Math.sin(2 * Math.PI * 55 * t) * impactEnv * 0.5;

      // Reverb-like tail (decaying noise)
      const reverbEnv = Math.exp(-t * 8) * (1 - Math.exp(-t * 50));
      const reverb = (Math.random() * 2 - 1) * reverbEnv * 0.2;

      // Sub-bass rumble
      const rumble = Math.sin(2 * Math.PI * 25 * t) * Math.exp(-t * 10) * 0.4;

      data[i] = (impact + impact2 + reverb + rumble) * 0.5;
    }

    // Add some "room" smoothing
    for (let i = 1; i < data.length; i++) {
      data[i] = data[i] * 0.6 + data[i - 1] * 0.4;
    }

    return buffer;
  }

  // 9. countdown - Beep (sine wave 800Hz, 100ms)
  generateCountdown() {
    const duration = 0.1;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      // Clean beep with soft attack/release
      const envelope = Math.sin(t * Math.PI / duration);
      const beep = Math.sin(2 * Math.PI * 800 * t);
      // Add subtle harmonic
      const harmonic = Math.sin(2 * Math.PI * 1600 * t) * 0.2;
      data[i] = (beep + harmonic) * envelope * 0.4;
    }

    return buffer;
  }

  // 10. start - Air horn (multiple sine waves, 500ms)
  generateStart() {
    const duration = 0.5;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Air horn frequencies (slightly detuned for richness)
    const freqs = [350, 440, 523, 698];

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      // Envelope: fast attack, sustain, medium release
      let envelope;
      if (t < 0.02) {
        envelope = t / 0.02; // Attack
      } else if (t < 0.4) {
        envelope = 1; // Sustain
      } else {
        envelope = (duration - t) / 0.1; // Release
      }

      // Mix multiple frequencies
      let sample = 0;
      for (let f = 0; f < freqs.length; f++) {
        const freq = freqs[f] * (1 + Math.sin(t * 5) * 0.01); // Slight vibrato
        sample += Math.sin(2 * Math.PI * freq * t) * (1 / freqs.length);
      }

      // Add some noise/buzz
      sample += (Math.random() * 2 - 1) * 0.05;

      data[i] = sample * envelope * 0.4;
    }

    return buffer;
  }

  // 11. victory - Victory sting (ascending tones, 400ms)
  generateVictory() {
    const duration = 0.4;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Ascending note frequencies (C5 -> E5 -> G5 -> C6)
    const notes = [
      { freq: 523, start: 0, end: 0.1 },
      { freq: 659, start: 0.1, end: 0.2 },
      { freq: 784, start: 0.2, end: 0.3 },
      { freq: 1047, start: 0.3, end: 0.4 },
    ];

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      let sample = 0;

      for (const note of notes) {
        if (t >= note.start && t < note.end) {
          const noteT = t - note.start;
          const noteDur = note.end - note.start;
          // Envelope per note
          const env = Math.sin(noteT * Math.PI / noteDur);
          // Bright tone with harmonics
          sample += Math.sin(2 * Math.PI * note.freq * noteT) * env * 0.4;
          sample += Math.sin(2 * Math.PI * note.freq * 2 * noteT) * env * 0.15;
          sample += Math.sin(2 * Math.PI * note.freq * 3 * noteT) * env * 0.05;
        }
      }

      data[i] = sample;
    }

    return buffer;
  }

  // 12. warning - Alarm beep (alternating frequencies, 200ms)
  generateWarning() {
    const duration = 0.2;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / this.ctx.sampleRate;
      // Alternate between two frequencies
      const freq = (Math.floor(t * 20) % 2 === 0) ? 800 : 1000;
      // Overall envelope
      const envelope = Math.sin(t * Math.PI / duration);
      // Beep with slight harshness
      const beep = Math.sin(2 * Math.PI * freq * t);
      const harsh = Math.sin(2 * Math.PI * freq * 2 * t) * 0.3;
      data[i] = (beep + harsh) * envelope * 0.35;
    }

    return buffer;
  }

  // Generate all sounds and return as a map
  generateAllSounds() {
    return {
      'footstep-light': this.generateFootstepLight(),
      'footstep-heavy': this.generateFootstepHeavy(),
      'throw': this.generateThrow(),
      'hit-wall': this.generateHitWall(),
      'hit-player': this.generateHitPlayer(),
      'pickup': this.generatePickup(),
      'flashlight': this.generateFlashlight(),
      'death': this.generateDeath(),
      'countdown': this.generateCountdown(),
      'start': this.generateStart(),
      'victory': this.generateVictory(),
      'warning': this.generateWarning(),
    };
  }
}

// Export a function to create sound generator
export function createSoundGenerator(audioContext) {
  return new SoundGenerator(audioContext);
}
