// Synthesised (original) sound effects. Nothing plays until the user unmutes, which also
// satisfies browser autoplay rules because the AudioContext is created on that click.
export class AudioManager {
  constructor() {
    this.muted = true;
    this.ctx = null;
  }

  init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 900;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    lowpass.connect(this.engineGain).connect(this.master);
    this.engine = [ctx.createOscillator(), ctx.createOscillator()];
    this.engine[0].type = 'sawtooth';
    this.engine[1].type = 'square';
    for (const osc of this.engine) {
      osc.frequency.value = 50;
      osc.connect(lowpass);
      osc.start();
    }

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const road = ctx.createBufferSource();
    road.buffer = this.noise;
    road.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    road.connect(band).connect(this.roadGain).connect(this.master);
    road.start();
    return true;
  }

  toggleMute() {
    if (!this.ctx && !this.init()) return this.muted;
    this.muted = !this.muted;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  get live() {
    return this.ctx && !this.muted;
  }

  /** speed01: 0..1 of cruise speed; nitro: 0-3. Called once per frame. */
  setEngine(speed01, nitro) {
    if (!this.live) return;
    const t = this.ctx.currentTime;
    const f = 45 + speed01 * 85 + nitro * 12;
    this.engine[0].frequency.setTargetAtTime(f, t, 0.08);
    this.engine[1].frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.engineGain.gain.setTargetAtTime(speed01 > 0 ? 0.12 + nitro * 0.03 : 0.04, t, 0.1);
    this.roadGain.gain.setTargetAtTime(speed01 * 0.05, t, 0.1);
  }

  burst(duration, from, to, gain, type = 'highpass') {
    if (!this.live) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration);
  }

  pass() {
    this.burst(0.18, 2500, 600, 0.12);
  }

  nitro() {
    this.burst(0.6, 300, 3000, 0.1, 'bandpass');
  }

  beep(freq, at = 0, duration = 0.18) {
    if (!this.live) return;
    const { ctx } = this;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }

  finish() {
    [523, 659, 784, 1047].forEach((f, i) => this.beep(f, i * 0.14, 0.3));
  }
}
