// Audio: all WebAudio-synthesised SFX for Breachline — no samples, no assets.
// One shared noise buffer, one master gain (0.5). The context is created lazily
// on unlock() (first user gesture); every method is a safe no-op before that.
// Positional sounds attenuate and lowpass with distance to the listener, which
// main.js updates each frame via setListener(pos).
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  const listener = { x: 0, y: 0, z: 0 };

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  function setListener(pos) {
    if (!pos) return;
    listener.x = pos.x || 0; listener.y = pos.y || 0; listener.z = pos.z || 0;
  }

  // Output chain for one sound: distance gain + lowpass when positional.
  function chain(pos, vol) {
    const gain = ctx.createGain();
    if (pos) {
      const dx = pos.x - listener.x; const dy = (pos.y || 0) - listener.y; const dz = pos.z - listener.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      gain.gain.value = vol / (1 + dist * 0.14);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(350, Math.min(14000, 14000 * Math.exp(-dist * 0.045)));
      lp.connect(gain); gain.connect(master);
      return lp;
    }
    gain.gain.value = vol;
    gain.connect(master);
    return gain;
  }

  // Filtered noise burst: the body of every gunshot, step and explosion.
  function noise({ pos = null, vol = 0.5, dur = 0.15, type = 'lowpass', freq = 2000, q = 0.8, sweepTo = null, delay = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = type; filter.frequency.setValueAtTime(freq, t); filter.Q.value = q;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + dur);
    const out = chain(pos, vol);
    src.connect(filter); filter.connect(out);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
    // Decay: the downward filter sweep reads as the envelope for positional
    // sounds; non-positional ones also fade their gain to zero.
    if (!pos) { out.gain.setValueAtTime(vol, t); out.gain.exponentialRampToValueAtTime(0.001, t + dur); }
  }

  // Oscillator blip with pitch glide and exponential decay.
  function tone({ pos = null, vol = 0.3, dur = 0.12, type = 'sine', f0 = 440, f1 = null, delay = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const out = chain(pos, vol);
    const g = out.gain;
    g.setValueAtTime(pos ? g.value : vol, t);
    g.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(out);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  const SHOTS = {
    pistol: { dur: 0.11, freq: 2600, vol: 0.5, thump: 170 },
    smg: { dur: 0.08, freq: 3000, vol: 0.42, thump: 190 },
    shotgun: { dur: 0.28, freq: 1300, vol: 0.8, thump: 110 },
    rifle: { dur: 0.14, freq: 2100, vol: 0.6, thump: 140 },
    heavy: { dur: 0.17, freq: 1600, vol: 0.7, thump: 115 },
    sniper: { dur: 0.42, freq: 3400, vol: 0.85, thump: 90 },
    knife: { dur: 0.09, freq: 4800, vol: 0.18, thump: 0 },
  };

  return {
    unlock,
    setListener,
    shot(kind, pos) {
      if (!ctx) return;
      const s = SHOTS[kind] || SHOTS.rifle;
      if (kind === 'knife') { noise({ pos, vol: s.vol, dur: s.dur, type: 'bandpass', freq: s.freq, q: 1.6, sweepTo: 900 }); return; }
      noise({ pos, vol: s.vol, dur: s.dur, freq: s.freq, sweepTo: 300 });
      tone({ pos, vol: s.vol * 0.7, dur: s.dur * 0.8, type: 'triangle', f0: s.thump, f1: 45 });
      if (kind === 'sniper') noise({ pos, vol: 0.25, dur: 0.3, freq: 900, delay: 0.07 }); // crack tail
      if (kind === 'shotgun') noise({ pos, vol: 0.4, dur: 0.2, freq: 700, delay: 0.03 });
    },
    dry() { tone({ vol: 0.16, dur: 0.04, type: 'square', f0: 1300, f1: 700 }); },
    reload() {
      tone({ vol: 0.2, dur: 0.05, type: 'square', f0: 500, f1: 300 });
      tone({ vol: 0.24, dur: 0.05, type: 'square', f0: 700, f1: 380, delay: 0.16 });
      tone({ vol: 0.2, dur: 0.06, type: 'square', f0: 420, f1: 260, delay: 0.5 });
    },
    hit(head) { tone({ vol: 0.3, dur: head ? 0.09 : 0.06, type: 'sine', f0: head ? 1560 : 980, f1: head ? 1200 : 760 }); },
    kill() { tone({ vol: 0.3, dur: 0.09, f0: 660 }); tone({ vol: 0.3, dur: 0.14, f0: 990, delay: 0.08 }); },
    hurt() { tone({ vol: 0.4, dur: 0.16, type: 'triangle', f0: 160, f1: 60 }); noise({ vol: 0.15, dur: 0.1, freq: 500 }); },
    step(run) {
      noise({ vol: run ? 0.2 : 0.1, dur: run ? 0.09 : 0.07, freq: run ? 700 : 900, sweepTo: 200 });
    },
    plant() {
      tone({ vol: 0.25, dur: 0.07, f0: 880 });
      tone({ vol: 0.25, dur: 0.07, f0: 880, delay: 0.18 });
      tone({ vol: 0.3, dur: 0.12, f0: 1320, delay: 0.36 });
    },
    beep(rate) { tone({ vol: 0.22, dur: 0.06, type: 'square', f0: 950 + Math.min(1, Math.max(0, rate || 0)) * 500 }); },
    defuse() {
      tone({ vol: 0.22, dur: 0.05, type: 'square', f0: 1100, f1: 500 });
      tone({ vol: 0.28, dur: 0.1, f0: 740, delay: 0.12 });
      tone({ vol: 0.28, dur: 0.16, f0: 1180, delay: 0.24 });
    },
    boom() {
      if (!ctx) return;
      noise({ vol: 1.0, dur: 1.3, freq: 900, sweepTo: 60 });
      tone({ vol: 0.9, dur: 1.1, type: 'sine', f0: 120, f1: 28 });
      noise({ vol: 0.5, dur: 0.4, freq: 3000, sweepTo: 400 });
    },
    stinger(win) {
      const notes = win ? [523, 659, 784, 1046] : [392, 330, 262, 196];
      notes.forEach((f, i) => tone({ vol: 0.26, dur: 0.22, type: 'triangle', f0: f, delay: i * 0.11 }));
    },
    buy() { tone({ vol: 0.24, dur: 0.07, f0: 1240 }); tone({ vol: 0.24, dur: 0.12, f0: 1860, delay: 0.06 }); },
    error() { tone({ vol: 0.22, dur: 0.16, type: 'square', f0: 150, f1: 110 }); },
    flashRing() { tone({ vol: 0.12, dur: 0.9, type: 'sine', f0: 3400, f1: 2900 }); },
    ui() { tone({ vol: 0.15, dur: 0.05, f0: 760, f1: 620 }); },
  };
}
