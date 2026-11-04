export type SoundName = 'shot' | 'arc' | 'nova' | 'hit' | 'dash' | 'echo' | 'pickup' | 'level' | 'explode' | 'hurt' | 'zero' | 'boss' | 'select' | 'gameover';

export class SoundSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambient: GainNode | null = null;
  private enabled = true;
  private lastPlayed: Partial<Record<SoundName, number>> = {};

  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.enabled ? 0.22 : 0;
      this.master.connect(this.context.destination);
      this.startAmbient();
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(enabled ? 0.22 : 0, this.context.currentTime, 0.03);
    }
  }

  private startAmbient() {
    if (!this.context || !this.master) return;
    const ctx = this.context;
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0.035;
    this.ambient.connect(this.master);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;
    filter.Q.value = 3;
    filter.connect(this.ambient);

    [43.65, 65.41, 87.31].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = index === 1 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index * 4 - 4;
      gain.gain.value = index === 0 ? 0.45 : 0.18;
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start();
    });

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.09;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
  }

  play(name: SoundName, intensity = 1) {
    if (!this.context || !this.master || !this.enabled) return;
    const nowMs = performance.now();
    const throttle = name === 'shot' ? 70 : name === 'hit' ? 45 : name === 'pickup' ? 55 : 0;
    if (throttle && nowMs - (this.lastPlayed[name] ?? 0) < throttle) return;
    this.lastPlayed[name] = nowMs;

    const presets: Record<SoundName, [number, number, number, OscillatorType, number]> = {
      shot: [390, 180, 0.045, 'square', 0.055],
      arc: [780, 140, 0.09, 'sawtooth', 0.065],
      nova: [210, 70, 0.12, 'sine', 0.09],
      hit: [120, 65, 0.05, 'square', 0.035],
      dash: [170, 620, 0.13, 'sawtooth', 0.075],
      echo: [220, 880, 0.38, 'sine', 0.11],
      pickup: [620, 980, 0.06, 'sine', 0.045],
      level: [330, 990, 0.42, 'triangle', 0.12],
      explode: [90, 32, 0.25, 'sawtooth', 0.12],
      hurt: [110, 48, 0.18, 'square', 0.12],
      zero: [75, 540, 0.75, 'sine', 0.15],
      boss: [62, 42, 0.85, 'sawtooth', 0.16],
      select: [480, 720, 0.07, 'sine', 0.06],
      gameover: [180, 42, 1.1, 'triangle', 0.14],
    };
    const [from, to, duration, type, volume] = presets[name];
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), ctx.currentTime + duration);
    gain.gain.setValueAtTime(volume * Math.min(1.4, intensity), ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.onended = () => {
      oscillator.onended = null;
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration + 0.02);
  }

  destroy() {
    void this.context?.close();
    this.context = null;
  }
}
