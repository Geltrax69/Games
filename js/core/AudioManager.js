// AudioManager: procedural sound effects via the Web Audio API.
//
// No external audio files are used. The AudioContext is created lazily on the
// first user gesture (browsers block audio until a gesture occurs), so calling
// playSfx before a gesture is a safe no-op.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  /** Create (or resume) the AudioContext. Call from a user-gesture handler. */
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  _ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  /** Fill a buffer with white noise and return an AudioBufferSourceNode. */
  _noiseSource(duration) {
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  _envGain(attack, duration, peak = 1.0) {
    const now = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    return g;
  }

  /** Play a named sound effect. Unknown names are ignored. */
  playSfx(name) {
    if (!this._ready()) return;
    switch (name) {
      case 'gunshot': return this._gunshot();
      case 'knife': return this._knife();
      case 'growl': return this._growl();
      case 'hit': return this._hit();
      case 'pickup': return this._pickup();
      case 'death': return this._death();
      case 'victory': return this._victory();
      default: return;
    }
  }

  _gunshot() {
    const now = this.ctx.currentTime;
    const src = this._noiseSource(0.18);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(2200, now);
    bp.frequency.exponentialRampToValueAtTime(300, now + 0.15);
    const g = this._envGain(0.002, 0.18, 1.0);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + 0.2);
  }

  _knife() {
    const now = this.ctx.currentTime;
    const src = this._noiseSource(0.12);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 1.2;
    const g = this._envGain(0.003, 0.12, 0.5);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + 0.13);
  }

  _growl() {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(70, now);
    osc.frequency.linearRampToValueAtTime(55, now + 0.5);
    const g = this._envGain(0.05, 0.6, 0.5);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.65);
  }

  _hit() {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);
    const g = this._envGain(0.002, 0.16, 0.6);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  _pickup() {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    const g = this._envGain(0.004, 0.18, 0.5);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  _death() {
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.7);
    const g = this._envGain(0.01, 0.8, 0.6);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.85);
  }

  _victory() {
    if (!this._ready()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const start = this.ctx.currentTime + i * 0.16;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(g).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  }
}

export default AudioManager;
