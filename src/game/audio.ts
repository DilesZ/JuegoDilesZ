/* ============================================================
   MOTOR DE AUDIO (Web Audio API)
   Capa 1: samples reales CC0 (Kenney RPG Audio, Little Robot Sound
   Factory, Cleyton Kauffman) en /public/audio.
   Capa 2: síntesis procedural como refuerzo y fallback.
   Música: tema de exploración en bucle + capa generativa de combate.
   ============================================================ */

const SFX_SAMPLES: Record<string, string> = {
  swing1: '/audio/swing1.ogg',
  swing2: '/audio/swing2.ogg',
  swing3: '/audio/swing3.ogg',
  swingHeavy: '/audio/swing_heavy.ogg',
  hitFlesh: '/audio/hit_flesh.ogg',
  hitFlesh2: '/audio/hit_flesh2.ogg',
  cloth: '/audio/cloth.ogg',
  step1: '/audio/step_grass1.ogg',
  step2: '/audio/step_grass2.ogg',
  step3: '/audio/step_grass3.ogg',
  gold: '/audio/gold.mp3',
  coins: '/audio/coins1.ogg',
  goblin1: '/audio/goblin1.mp3',
  goblin2: '/audio/goblin2.mp3',
  dragon: '/audio/dragon.mp3',
  spell1: '/audio/spell1.mp3',
  spell2: '/audio/spell2.mp3',
  levelUp: '/audio/levelup.mp3',
  victory: '/audio/victory.mp3',
  defeat: '/audio/defeat.mp3',
  uiSelect: '/audio/ui_select.mp3',
  uiOpen: '/audio/ui_open.mp3',
  musicTheme: '/audio/music_theme.ogg',
};

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private intensity = 0; // 0 = exploración, 1 = combate
  private started = false;
  private samples = new Map<string, AudioBuffer>();
  private themeSrc: AudioBufferSourceNode | null = null;
  private themeGain: GainNode | null = null;
  /** capa de lluvia: fuente de ruido en bucle con ganancia controlada */
  private rainSrc: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private rainCut: BiquadFilterNode | null = null;
  muted = false;

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.master);

    // buffer de ruido blanco reutilizable
    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // precarga asíncrona de samples CC0
    for (const [name, url] of Object.entries(SFX_SAMPLES)) {
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => this.ctx!.decodeAudioData(ab))
        .then((buf) => { this.samples.set(name, buf); })
        .catch(() => { /* sin red o códec ausente: cae a síntesis */ });
    }
  }

  /** Reproduce un sample precargado (ignora si aún no está listo). */
  private sample(name: string, opts: { gain?: number; rate?: number; rateJitter?: number; bus?: GainNode | null } = {}) {
    if (!this.ctx || !this.sfxBus) return;
    const buf = this.samples.get(name);
    if (!buf) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const jitter = opts.rateJitter ?? 0.06;
    src.playbackRate.value = (opts.rate ?? 1) * (1 - jitter + Math.random() * jitter * 2);
    const g = this.ctx.createGain();
    g.gain.value = opts.gain ?? 0.8;
    src.connect(g).connect(opts.bus ?? this.sfxBus);
    src.start(t);
  }

  private sampleReady(name: string) { return this.samples.has(name); }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.85;
  }

  setIntensity(v: number) { this.intensity = v; }

  private now() { return this.ctx ? this.ctx.currentTime : 0; }

  private noise(dur: number, opts: { freq?: number; q?: number; type?: BiquadFilterType; gain?: number; sweep?: number; attack?: number } = {}) {
    if (!this.ctx || !this.noiseBuf || !this.sfxBus) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filt = this.ctx.createBiquadFilter();
    filt.type = opts.type ?? 'bandpass';
    filt.frequency.value = opts.freq ?? 1000;
    filt.Q.value = opts.q ?? 1;
    if (opts.sweep) {
      filt.frequency.setValueAtTime(opts.freq ?? 1000, t);
      filt.frequency.exponentialRampToValueAtTime(Math.max(40, (opts.freq ?? 1000) * opts.sweep), t + dur);
    }
    const g = this.ctx.createGain();
    const peak = (opts.gain ?? 0.4);
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; slideTo?: number; attack?: number; bus?: GainNode | null } = {}) {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t + dur);
    const g = this.ctx.createGain();
    const peak = opts.gain ?? 0.25;
    const atk = opts.attack ?? 0.008;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(opts.bus ?? this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /* ---------- SFX (sample real + refuerzo sintético) ---------- */

  swing(pitch = 1) {
    const names = ['swing1', 'swing2', 'swing3'];
    const n = names[Math.floor(Math.random() * names.length)];
    if (this.sampleReady(n)) {
      this.sample(n, { gain: 0.55, rate: pitch * 0.95 });
    } else {
      this.noise(0.16, { freq: 2400 * pitch, q: 2.2, gain: 0.28, sweep: 0.25 });
    }
    this.tone(300 * pitch, 0.1, { type: 'triangle', gain: 0.05, slideTo: 140 * pitch });
  }
  hitFlesh() {
    this.sample(Math.random() < 0.5 ? 'hitFlesh' : 'hitFlesh2', { gain: 0.75 });
    this.noise(0.14, { freq: 420, q: 0.8, gain: 0.32, sweep: 0.3 });
    this.tone(130, 0.13, { type: 'triangle', gain: 0.24, slideTo: 60 });
  }
  hitMetal() {
    this.sample('hitFlesh2', { gain: 0.35, rate: 1.4 });
    this.noise(0.12, { freq: 3400, q: 6, gain: 0.3, sweep: 0.5 });
    this.tone(820, 0.16, { type: 'square', gain: 0.1, slideTo: 400 });
    this.tone(1240, 0.2, { type: 'sine', gain: 0.12, slideTo: 900 });
  }
  heavyHit() {
    this.sample('swingHeavy', { gain: 0.5, rate: 0.8 });
    this.sample('hitFlesh', { gain: 0.6, rate: 0.85 });
    this.noise(0.25, { freq: 300, q: 0.7, gain: 0.45, sweep: 0.2 });
    this.tone(90, 0.3, { type: 'sine', gain: 0.45, slideTo: 38 });
  }
  roll() {
    this.sample('cloth', { gain: 0.5 });
    this.noise(0.22, { freq: 700, q: 0.6, gain: 0.12, sweep: 0.4, type: 'lowpass' });
  }
  /** Pasos del jugador sobre hierba/tierra */
  footstep() {
    const n = ['step1', 'step2', 'step3'][Math.floor(Math.random() * 3)];
    this.sample(n, { gain: 0.32, rateJitter: 0.12 });
  }
  coin() {
    this.sample('gold', { gain: 0.7 });
    this.sample('coins', { gain: 0.3, rate: 1.2 });
  }
  goblinVox() {
    this.sample(Math.random() < 0.5 ? 'goblin1' : 'goblin2', { gain: 0.6, rateJitter: 0.1 });
  }
  hurt() {
    this.sample('cloth', { gain: 0.4, rate: 1.3 });
    this.noise(0.2, { freq: 500, q: 1, gain: 0.4, sweep: 0.3 });
    this.tone(200, 0.18, { type: 'sawtooth', gain: 0.12, slideTo: 90 });
  }
  die() {
    this.sample('cloth', { gain: 0.5, rate: 0.8 });
    this.tone(180, 0.5, { type: 'sawtooth', gain: 0.16, slideTo: 50 });
    this.noise(0.4, { freq: 350, q: 0.6, gain: 0.3, sweep: 0.15 });
  }
  arrow() {
    this.sample('spell2', { gain: 0.4, rate: 1.3, rateJitter: 0.1 });
    this.noise(0.3, { freq: 1800, q: 3, gain: 0.16, sweep: 2.2 });
  }
  castSpell() {
    this.sample(Math.random() < 0.5 ? 'spell1' : 'spell2', { gain: 0.55, rateJitter: 0.08 });
  }
  potion() {
    const t0 = this.now();
    [523, 659, 784].forEach((f, i) => {
      setTimeout(() => this.tone(f, 0.18, { type: 'sine', gain: 0.14 }), (t0 * 0) + i * 60);
    });
  }
  levelUp() {
    this.sample('levelUp', { gain: 0.85 });
    if (!this.sampleReady('levelUp')) {
      const notes = [440, 554, 659, 880, 1108];
      notes.forEach((f, i) => {
        setTimeout(() => this.tone(f, 0.5, { type: 'triangle', gain: 0.16 }), i * 90);
      });
    }
  }
  cleanse() {
    this.sample('spell1', { gain: 0.5, rate: 0.9 });
    const notes = [392, 523, 659, 784, 1046];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.7, { type: 'sine', gain: 0.15 }), i * 110));
    this.noise(1.2, { freq: 3000, q: 0.8, gain: 0.1, sweep: 0.15, attack: 0.4 });
  }
  bossRoar() {
    this.sample('dragon', { gain: 0.95, rateJitter: 0.03 });
    this.tone(70, 1.4, { type: 'sawtooth', gain: 0.35, slideTo: 45 });
    this.noise(1.3, { freq: 250, q: 0.5, gain: 0.4, sweep: 0.3, attack: 0.05 });
  }
  slam() {
    this.sample('swingHeavy', { gain: 0.7, rate: 0.6 });
    this.tone(60, 0.5, { type: 'sine', gain: 0.6, slideTo: 30 });
    this.noise(0.4, { freq: 200, q: 0.5, gain: 0.5, sweep: 0.2 });
  }
  /** Clac de yunque del herrero: golpe metálico con resonancia */
  anvil() {
    this.sample('hitFlesh2', { gain: 0.28, rate: 1.7 });
    this.noise(0.1, { freq: 4200, q: 8, gain: 0.22, sweep: 0.6 });
    this.tone(1480, 0.34, { type: 'sine', gain: 0.14, slideTo: 1100 });
    this.tone(2260, 0.22, { type: 'sine', gain: 0.07, slideTo: 1800 });
  }
  uiClick() {
    this.sample('uiSelect', { gain: 0.6 });
    if (!this.sampleReady('uiSelect')) this.tone(660, 0.07, { type: 'triangle', gain: 0.12 });
  }
  uiOpen() {
    this.sample('uiOpen', { gain: 0.6 });
  }
  victory() { this.sample('victory', { gain: 0.9 }); }
  defeat() { this.sample('defeat', { gain: 0.9 }); }
  bonfireRest() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.6, { type: 'sine', gain: 0.12 }), i * 130));
  }

  /* ---------- Música: tema CC0 en bucle + capa generativa ---------- */

  startMusic() {
    if (this.started || !this.ctx || !this.musicBus) return;
    this.started = true;
    this.nextNoteTime = this.now() + 0.1;
    // Tema de exploración (Cleyton Kauffman, CC0) en bucle suave
    const theme = this.samples.get('musicTheme');
    if (theme) {
      this.themeSrc = this.ctx.createBufferSource();
      this.themeSrc.buffer = theme;
      this.themeSrc.loop = true;
      this.themeGain = this.ctx.createGain();
      this.themeGain.gain.setValueAtTime(0.0001, this.now());
      this.themeGain.gain.linearRampToValueAtTime(0.4, this.now() + 3);
      this.themeSrc.connect(this.themeGain).connect(this.musicBus);
      this.themeSrc.start(this.now() + 0.15);
    }
    // Colchón de drone continuo (textura generativa bajo el tema)
    this.startDrone();
    this.musicTimer = setInterval(() => this.scheduler(), 120);
  }

  /** Atenua o restituye el tema (menú pausa, victoria...) */
  duckTheme(v: number, time = 0.8) {
    if (!this.ctx || !this.themeGain) return;
    const g = this.themeGain.gain;
    g.cancelScheduledValues(this.now());
    g.setValueAtTime(g.value, this.now());
    g.linearRampToValueAtTime(0.4 * v, this.now() + time);
  }

  private droneOscs: OscillatorNode[] = [];
  private droneGain: GainNode | null = null;

  private startDrone() {
    if (!this.ctx || !this.musicBus) return;
    const t = this.now();
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.setValueAtTime(0.0001, t);
    this.droneGain.gain.linearRampToValueAtTime(0.1, t + 4);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 320;
    filt.Q.value = 0.7;
    this.droneGain.connect(filt).connect(this.musicBus);
    // A1 + E2 detunados
    for (const [f, det] of [[55, 0], [55, 6], [82.4, 0], [82.4, -7]]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(this.droneGain);
      o.start(t);
      this.droneOscs.push(o);
    }
    // LFO sobre el filtro
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 120;
    lfo.connect(lfoG).connect(filt.frequency);
    lfo.start(t);
  }

  // Progresión en La menor: Am - F - C - G (oscuro, con 9ª)
  private chordProg = [
    [110.0, 130.8, 164.8, 246.9],   // A2 C3 E3 B3
    [87.3, 130.8, 174.6, 220.0],    // F2 C3 F3 A3
    [98.0, 146.8, 196.0, 246.9],    // G2 D3 G3 B3  (G con 5ª)
    [87.3, 174.6, 220.0, 261.6],    // F2 F3 A3 C4
  ];
  private melodyScale = [440, 523.3, 587.3, 659.3, 784, 880];

  private scheduler() {
    if (!this.ctx || !this.musicBus) return;
    const ahead = 0.6;
    const stepDur = 0.5; // 120 bpm en corcheas lentas... usamos pasos de 0.5s
    while (this.nextNoteTime < this.now() + ahead) {
      this.playStep(this.step, this.nextNoteTime, stepDur);
      this.step++;
      this.nextNoteTime += stepDur;
    }
  }

  private playStep(step: number, t: number, dur: number) {
    if (!this.ctx || !this.musicBus) return;
    const bar = Math.floor(step / 8) % 4;
    const inBar = step % 8;

    // Bajo/pulso en combate
    if (this.intensity > 0.4 && inBar % 2 === 0) {
      const f = 55 * (inBar === 4 ? 1.5 : 1);
      this.midiNote(f, t, 0.22, { type: 'sine', gain: 0.34 * this.intensity });
      if (inBar === 0) this.midiNoise(t, 0.08, { freq: 3000, gain: 0.05 * this.intensity });
    }
    if (this.intensity > 0.4 && inBar === 4) {
      this.midiNoise(t, 0.14, { freq: 900, gain: 0.1 * this.intensity });
    }

    // Pad de acordes (cada compás)
    if (inBar === 0) {
      const chord = this.chordProg[bar];
      for (const f of chord) {
        this.midiNote(f, t, dur * 8 * 0.95, { type: 'triangle', gain: 0.05, attack: 1.2 });
      }
    }
    // Campana melódica esporádica (exploración)
    if (this.intensity < 0.4 && inBar === 4 && Math.random() < 0.5) {
      const f = this.melodyScale[Math.floor(Math.random() * this.melodyScale.length)];
      this.midiNote(f, t, 1.6, { type: 'sine', gain: 0.045 });
      if (Math.random() < 0.4) this.midiNote(f * 1.5, t + 0.25, 1.2, { type: 'sine', gain: 0.03 });
    }
    // Campana tensa (combate)
    if (this.intensity > 0.4 && inBar === 6 && Math.random() < 0.6) {
      const f = this.melodyScale[Math.floor(Math.random() * 4)] * 2;
      this.midiNote(f, t, 0.5, { type: 'square', gain: 0.03 });
    }
  }

  private midiNote(freq: number, t: number, dur: number, opts: { type?: OscillatorType; gain?: number; attack?: number } = {}) {
    if (!this.ctx || !this.musicBus) return;
    const osc = this.ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    const peak = opts.gain ?? 0.1;
    const atk = opts.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  private midiNoise(t: number, dur: number, opts: { freq?: number; gain?: number }) {
    if (!this.ctx || !this.noiseBuf || !this.musicBus) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = opts.freq ?? 2000;
    filt.Q.value = 1.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(opts.gain ?? 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.musicBus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /* ---------- LLUVIA PROCEDURAL: capa continua de ruido filtrado ---------- */

  /** Arranca la capa de lluvia (idle, ganancia 0). Idempotente. */
  private ensureRainLayer() {
    if (!this.ctx || !this.noiseBuf || !this.master || this.rainSrc) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    // lowpass suave + highshelf cortando el estruendo: susurro de tormenta
    const cut = this.ctx.createBiquadFilter();
    cut.type = 'lowpass';
    cut.frequency.value = 900;
    cut.Q.value = 0.4;
    const shelf = this.ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 400;
    shelf.gain.value = -6;
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(cut).connect(shelf).connect(g).connect(this.master);
    src.start();
    this.rainSrc = src;
    this.rainGain = g;
    this.rainCut = cut;
  }

  /** Intensidad de la lluvia 0..1 (fundido suave, llama cada frame) */
  setRain(k: number) {
    this.ensureRainLayer();
    if (!this.ctx || !this.rainGain || !this.rainCut) return;
    const t = this.now();
    const v = Math.max(0.0001, k * 0.16);
    this.rainGain.gain.setTargetAtTime(v, t, 0.8);
    // con tormenta fuerte el ruido es más brillante (gotas contra hojas)
    this.rainCut.frequency.setTargetAtTime(700 + k * 500, t, 1.2);
  }

  /** TRUENO: estallido grave con cola larga (retardo aleatorio = distancia) */
  thunder() {
    if (!this.ctx || !this.noiseBuf || !this.master) return;
    const t = this.now() + Math.random() * 0.7; // el rayo se ve antes de oírse
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.5 + Math.random() * 0.2;
    // lowpass grave que se cierra (retumbo lejano)
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(340, t);
    filt.frequency.exponentialRampToValueAtTime(60, t + 2.6);
    filt.Q.value = 0.6;
    // ataque rápido + cola de 2.6s
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 2.7);
  }

  dispose() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.droneOscs.forEach(o => { try { o.stop(); } catch { /* noop */ } });
    try { this.themeSrc?.stop(); } catch { /* noop */ }
    try { this.rainSrc?.stop(); } catch { /* noop */ }
    this.rainSrc = null; this.rainGain = null; this.rainCut = null;
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.started = false;
  }
}
