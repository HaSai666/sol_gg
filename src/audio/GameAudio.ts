import type { GameEvent } from "../game/types";

type ToneShape = OscillatorType;

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private humGain: GainNode | null = null;
  private humOscillators: OscillatorNode[] = [];
  private muted = false;
  private pulseCounter = 0;

  get isMuted(): boolean {
    return this.muted;
  }

  async unlock(): Promise<boolean> {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        this.master.connect(this.context.destination);
        this.startHum();
      }
      if (this.context.state === "suspended") {
        await this.context.resume();
      }
      return true;
    } catch {
      this.context = null;
      this.master = null;
      return false;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.context.currentTime, 0.03);
    }
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  handleEvent(event: GameEvent): void {
    if (!this.context || !this.master || this.muted) {
      return;
    }
    if (event.type === "build") {
      this.tone(128, 210, 0.09, 0.11, "triangle");
      this.noise(0.055, 0.035, 420);
    } else if (event.type === "remove") {
      this.tone(170, 95, 0.08, 0.07, "square");
    } else if (event.type === "invalid") {
      this.tone(112, 84, 0.12, 0.08, "sawtooth");
    } else if (event.type === "pulse") {
      this.pulseCounter += 1;
      if (event.energy >= 2 || this.pulseCounter % 7 === 0) {
        const frequency =
          event.frequency === "red"
            ? 190
            : event.frequency === "blue"
              ? 260
              : event.frequency === "yellow"
                ? 330
                : 235;
        this.tone(frequency, frequency * 1.07, 0.055, 0.025, "sine");
      }
    } else if (event.type === "shot") {
      if (event.towerKind === "mortar") {
        this.tone(92, 52, 0.15, 0.16, "triangle");
        this.noise(0.1, 0.06, 230);
      } else if (event.towerKind === "prism") {
        this.tone(410, 620, 0.09, 0.065, "sine");
      } else {
        this.tone(240, 175, 0.045, 0.045, "square");
      }
    } else if (event.type === "kill") {
      this.noise(event.enemyKind === "boss" ? 0.65 : 0.11, event.enemyKind === "boss" ? 0.22 : 0.045, 620);
      if (event.enemyKind === "boss") {
        this.chord([146.83, 220, 293.66], 1.1, 0.12);
      }
    } else if (event.type === "core-hit") {
      this.tone(78, 42, 0.34, 0.25, "sawtooth");
      this.noise(0.22, 0.13, 170);
    } else if (event.type === "wave") {
      this.chord([196, 246.94, 293.66], 0.35, 0.06);
    } else if (event.type === "reward") {
      this.chord([261.63, 329.63, 392], 0.65, 0.08);
    } else if (event.type === "reward-picked") {
      this.chord([293.66, 369.99, 440], 0.48, 0.09);
    } else if (event.type === "jam-warning") {
      this.tone(310, 220, 0.4, 0.08, "square");
    } else if (event.type === "jam-active") {
      this.tone(150, 72, 0.3, 0.16, "sawtooth");
    } else if (event.type === "boss") {
      this.chord([73.42, 110, 146.83], 1.15, 0.18);
    } else if (event.type === "win") {
      this.chord([220, 277.18, 329.63, 440], 1.4, 0.13);
    } else if (event.type === "lose") {
      this.chord([174.61, 138.59, 103.83], 1.25, 0.11);
    }
  }

  dispose(): void {
    for (const oscillator of this.humOscillators) {
      try {
        oscillator.stop();
      } catch {
        // The oscillator may already be stopped by the browser.
      }
    }
    this.humOscillators = [];
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  private startHum(): void {
    if (!this.context || !this.master) {
      return;
    }
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180;
    filter.Q.value = 0.8;
    this.humGain = this.context.createGain();
    this.humGain.gain.value = 0.028;
    this.humGain.connect(filter);
    filter.connect(this.master);

    for (const frequency of [41.2, 61.8]) {
      const oscillator = this.context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.detune.value = frequency === 41.2 ? -4 : 7;
      oscillator.connect(this.humGain);
      oscillator.start();
      this.humOscillators.push(oscillator);
    }
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    volume: number,
    shape: ToneShape
  ): void {
    if (!this.context || !this.master) {
      return;
    }
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private chord(frequencies: number[], duration: number, volume: number): void {
    frequencies.forEach((frequency, index) => {
      window.setTimeout(() => {
        this.tone(frequency, frequency * 1.015, duration, volume / frequencies.length, "sine");
      }, index * 38);
    });
  }

  private noise(duration: number, volume: number, cutoff: number): void {
    if (!this.context || !this.master) {
      return;
    }
    const length = Math.max(1, Math.floor(this.context.sampleRate * duration));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < length; index += 1) {
      const envelope = 1 - index / length;
      data[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const gain = this.context.createGain();
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
  }
}
