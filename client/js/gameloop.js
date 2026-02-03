// Game loop - requestAnimationFrame, FPS tracking, input throttling

export class GameLoop {
  constructor() {
    this.running = false;
    this.lastFrameTime = 0;
    this.animationFrameId = null;

    // Input throttling (20Hz = 50ms)
    this.lastInputSendTime = 0;
    this.inputSendInterval = 50;

    // FPS tracking with circular buffer
    this.fpsHistory = new Float32Array(60);
    this.fpsHistoryIndex = 0;
    this.fpsHistoryCount = 0;
    this.fpsLastUpdate = 0;
    this.fpsUpdateInterval = 250;

    // Bound tick for rAF
    this._boundTick = null;
  }

  start(tickCallback) {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = 0;
    this._boundTick = (timestamp) => {
      if (!this.running) return;

      if (this.lastFrameTime === 0) {
        this.lastFrameTime = timestamp;
      }

      const dt = (timestamp - this.lastFrameTime) / 1000;
      this.lastFrameTime = timestamp;
      const cappedDt = Math.min(dt, 0.1);

      // Track FPS
      if (dt > 0) {
        this.fpsHistory[this.fpsHistoryIndex] = 1 / dt;
        this.fpsHistoryIndex = (this.fpsHistoryIndex + 1) % 60;
        if (this.fpsHistoryCount < 60) this.fpsHistoryCount++;
      }

      // Update FPS display periodically
      if (timestamp - this.fpsLastUpdate >= this.fpsUpdateInterval) {
        this.updateFpsDisplay();
        this.fpsLastUpdate = timestamp;
      }

      tickCallback(cappedDt, timestamp);

      this.animationFrameId = requestAnimationFrame(this._boundTick);
    };

    this.animationFrameId = requestAnimationFrame(this._boundTick);
  }

  stop() {
    this.running = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  shouldSendInput() {
    const now = performance.now();
    if (now - this.lastInputSendTime >= this.inputSendInterval) {
      return true;
    }
    return false;
  }

  markInputSent() {
    this.lastInputSendTime = performance.now();
  }

  updateFpsDisplay() {
    const fpsDisplay = document.getElementById('fps-display');
    if (!fpsDisplay) return;

    if (this.fpsHistoryCount === 0) {
      fpsDisplay.textContent = '-- FPS';
      fpsDisplay.className = 'debug-info';
      return;
    }

    let sum = 0;
    for (let i = 0; i < this.fpsHistoryCount; i++) {
      sum += this.fpsHistory[i];
    }
    const avgFps = sum / this.fpsHistoryCount;
    const roundedFps = Math.round(avgFps);

    fpsDisplay.textContent = `${roundedFps} FPS`;

    fpsDisplay.classList.remove('good', 'warning', 'bad');
    if (roundedFps >= 55) {
      fpsDisplay.classList.add('good');
    } else if (roundedFps >= 30) {
      fpsDisplay.classList.add('warning');
    } else {
      fpsDisplay.classList.add('bad');
    }
  }
}
