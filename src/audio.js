// Sound as data. A sound effect is a handful of synth parameters; music is a note string.
// Rendering is pure and deterministic (same params -> same samples), so it works headless,
// can be tested, hashed and exported to WAV, and costs ~100 bytes per effect in a scene.
//
//   sounds: { zap: { wave: "square", freq: 880, slide: -2400, decay: 0.12 } }
//   game.sound("zap")                       // emits a "sound" event (agents see it too)
//   attachAudio(game)                       // browser: plays sound events via WebAudio
//   synth(params) -> Float32Array            // headless: raw samples
//   toWAV(samples) -> Uint8Array             // export

export const SAMPLE_RATE = 22050;

const DEFAULTS = {
  wave: 'square', freq: 440, slide: 0, attack: 0.005, sustain: 0, decay: 0.15,
  volume: 0.5, vibrato: 0, vibratoRate: 6, duty: 0.5, lowpass: 0, seed: 1,
};

/** Render one sound effect to mono samples in [-1, 1]. */
export function synth(params = {}, sampleRate = SAMPLE_RATE) {
  const p = { ...DEFAULTS, ...params };
  const dur = p.attack + p.sustain + p.decay;
  const n = Math.max(1, Math.ceil(dur * sampleRate));
  const out = new Float32Array(n);
  let phase = 0, noise = 0, rng = p.seed >>> 0 || 1, lp = 0;
  const lpK = p.lowpass ? 1 - Math.exp((-2 * Math.PI * p.lowpass) / sampleRate) : 1;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = t < p.attack ? t / p.attack
      : t < p.attack + p.sustain ? 1
        : Math.max(0, 1 - (t - p.attack - p.sustain) / (p.decay || 1e-9));
    const f = Math.max(1, p.freq + p.slide * t + (p.vibrato ? p.vibrato * Math.sin(2 * Math.PI * p.vibratoRate * t) : 0));
    const prev = phase;
    phase = (phase + f / sampleRate) % 1;
    let v;
    switch (p.wave) {
      case 'sine': v = Math.sin(2 * Math.PI * phase); break;
      case 'saw': v = 2 * phase - 1; break;
      case 'triangle': v = 1 - 4 * Math.abs(phase - 0.5); break;
      case 'noise':
        if (phase < prev) { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; noise = ((rng >>> 0) / 4294967296) * 2 - 1; }
        v = noise; break;
      default: v = phase < p.duty ? 1 : -1;
    }
    lp += (v - lp) * lpK;
    out[i] = lp * env * p.volume;
  }
  return out;
}

const NOTE = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };

/** "A4" / "C#5" / "Eb3" -> Hz. */
export function noteFreq(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note "${name}"`);
  const semis = NOTE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) - 4) * 12;
  return 440 * Math.pow(2, semis / 12);
}

/**
 * Music as text: space-separated notes, '-' holds the previous note, '.' is a rest.
 * Each token is one step of `1/steps` beats. Returns mono samples.
 *   sequence("C4 E4 G4 C5 - - . G4", { bpm: 140, voice: { wave: "triangle" } })
 */
export function sequence(score, { bpm = 120, steps = 2, voice = {}, sampleRate = SAMPLE_RATE } = {}) {
  const tokens = score.trim().split(/\s+/);
  const stepDur = 60 / bpm / steps;
  const out = new Float32Array(Math.ceil(tokens.length * stepDur * sampleRate) + sampleRate);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === '-' || tok === '.') continue;
    let hold = 1;
    while (tokens[i + hold] === '-') hold++;
    const note = synth({ wave: 'square', duty: 0.25, attack: 0.01, decay: 0.08, volume: 0.25, ...voice,
      freq: noteFreq(tok), sustain: Math.max(0, hold * stepDur - 0.09) }, sampleRate);
    const at = Math.round(i * stepDur * sampleRate);
    for (let j = 0; j < note.length && at + j < out.length; j++) out[at + j] += note[j];
  }
  return out;
}

/** Mono float samples -> 16-bit PCM WAV bytes. */
export function toWAV(samples, sampleRate = SAMPLE_RATE) {
  const n = samples.length, buf = new Uint8Array(44 + n * 2), v = new DataView(buf.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return buf;
}

/**
 * Browser: play every "sound" event the game emits, via WebAudio. Buffers are synthesized
 * once per sound name. Returns a detach function. Audio unlocks on the first user gesture.
 */
export function attachAudio(game, { volume = 1 } = {}) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return () => {};
  const ctx = new AC();
  const gain = ctx.createGain(); gain.gain.value = volume; gain.connect(ctx.destination);
  const buffers = new Map();
  const unlock = () => ctx.resume();
  globalThis.addEventListener?.('keydown', unlock, { once: true });
  globalThis.addEventListener?.('pointerdown', unlock, { once: true });
  const bufferFor = (name, params) => {
    let b = buffers.get(name);
    if (!b) {
      const s = synth(params, ctx.sampleRate);
      b = ctx.createBuffer(1, s.length, ctx.sampleRate);
      b.copyToChannel(s, 0);
      buffers.set(name, b);
    }
    return b;
  };
  const origStep = game.step.bind(game);
  game.step = (n = 1) => {
    const evs = origStep(n);
    for (const ev of evs) {
      if (ev.type !== 'sound') continue;
      const params = game.world.sounds?.[ev.name];
      if (!params || ctx.state !== 'running') continue;
      const src = ctx.createBufferSource();
      src.buffer = bufferFor(ev.name, params);
      src.connect(gain); src.start();
    }
    return evs;
  };
  return () => { game.step = origStep; ctx.close(); };
}
