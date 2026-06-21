import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Volume2, VolumeX, Music4, Drum, Zap, Power } from "lucide-react";

/* ================================================================== *
 * Soundboard / Sampler
 * ------------------------------------------------------------------ *
 * A grid of MPC-style neon pads that trigger 100% SYNTHESIZED Web
 * Audio voices (oscillators + noise buffers + gain envelopes). No
 * audio files ship in this single .tsx — the "samples" are generated
 * on the fly, so the board is zero-dependency, instant, and fully
 * offline. The AudioContext is created lazily on the first user
 * gesture and resumed; everything degrades gracefully when Web Audio
 * is unavailable (e.g. jsdom / locked-down browsers).
 * ================================================================== */

/* ------------------------------------------------------------------ *
 * Voice model — each voice is a pure function of (ctx, out, time, vol)
 * ------------------------------------------------------------------ */

type Voice = (
  ctx: AudioContext,
  out: AudioNode,
  time: number,
  velocity: number
) => void;

interface Pad {
  id: string;
  label: string;
  hint: string; // short character description
  key: string; // keyboard trigger (single char, lowercase)
  hue: number; // neon hue 0..360
  voice: Voice;
}

interface Kit {
  id: string;
  name: string;
  icon: "drum" | "music" | "zap";
  pads: Pad[];
}

/* ---- Synthesis primitives ---------------------------------------- */

/** A short burst of white noise as an AudioBuffer (cached per ctx). */
const noiseCache = new WeakMap<AudioContext, AudioBuffer>();
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const len = Math.floor(ctx.sampleRate * 1.2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

function env(
  ctx: AudioContext,
  out: AudioNode,
  time: number,
  peak: number,
  attack: number,
  decay: number
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), time + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  g.connect(out);
  return g;
}

function tone(
  ctx: AudioContext,
  out: AudioNode,
  type: OscillatorType,
  freq: number,
  time: number,
  dur: number
): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, time);
  o.connect(out);
  o.start(time);
  o.stop(time + dur);
  return o;
}

function noise(
  ctx: AudioContext,
  out: AudioNode,
  time: number,
  dur: number
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.connect(out);
  src.start(time);
  src.stop(time + dur);
  return src;
}

/* ---- Drum voices ------------------------------------------------- */

const kick: Voice = (ctx, out, t, v) => {
  const g = env(ctx, out, t, 0.95 * v, 0.005, 0.4);
  const o = tone(ctx, g, "sine", 150, t, 0.45);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
};

const tomLow: Voice = (ctx, out, t, v) => {
  const g = env(ctx, out, t, 0.8 * v, 0.005, 0.35);
  const o = tone(ctx, g, "sine", 180, t, 0.4);
  o.frequency.exponentialRampToValueAtTime(80, t + 0.25);
};

const tomHigh: Voice = (ctx, out, t, v) => {
  const g = env(ctx, out, t, 0.75 * v, 0.005, 0.28);
  const o = tone(ctx, g, "triangle", 320, t, 0.32);
  o.frequency.exponentialRampToValueAtTime(150, t + 0.2);
};

const snare: Voice = (ctx, out, t, v) => {
  // tonal body
  const bodyG = env(ctx, out, t, 0.5 * v, 0.005, 0.18);
  const body = tone(ctx, bodyG, "triangle", 190, t, 0.2);
  body.frequency.exponentialRampToValueAtTime(120, t + 0.12);
  // noise crack through a band-ish high-pass
  const nG = env(ctx, out, t, 0.7 * v, 0.005, 0.2);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1400;
  hp.connect(nG);
  noise(ctx, hp, t, 0.25);
};

const clap: Voice = (ctx, out, t, v) => {
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1200;
  bp.Q.value = 1.2;
  bp.connect(out);
  // three quick noise bursts = the classic clap stutter
  const offsets = [0, 0.012, 0.024, 0.05];
  offsets.forEach((off, i) => {
    const peak = (i === offsets.length - 1 ? 0.6 : 0.45) * v;
    const g = env(ctx, bp, t + off, peak, 0.002, i === offsets.length - 1 ? 0.18 : 0.04);
    noise(ctx, g, t + off, 0.2);
  });
};

const hatClosed: Voice = (ctx, out, t, v) => {
  const g = env(ctx, out, t, 0.4 * v, 0.002, 0.05);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  hp.connect(g);
  noise(ctx, hp, t, 0.06);
};

const hatOpen: Voice = (ctx, out, t, v) => {
  const g = env(ctx, out, t, 0.35 * v, 0.002, 0.4);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6000;
  hp.connect(g);
  noise(ctx, hp, t, 0.45);
};

const rimshot: Voice = (ctx, out, t, v) => {
  const g = env(ctx, out, t, 0.6 * v, 0.001, 0.06);
  const o = tone(ctx, g, "square", 440, t, 0.08);
  o.frequency.exponentialRampToValueAtTime(280, t + 0.05);
};

/* ---- Tonal / melodic voices -------------------------------------- */

function note(freq: number, type: OscillatorType, dur: number): Voice {
  return (ctx, out, t, v) => {
    const g = env(ctx, out, t, 0.45 * v, 0.01, dur);
    // slight detuned second osc for thickness
    tone(ctx, g, type, freq, t, dur + 0.05);
    const o2 = tone(ctx, g, type, freq * 1.003, t, dur + 0.05);
    o2.detune.value = 6;
  };
}

function pluck(freq: number): Voice {
  return (ctx, out, t, v) => {
    const g = env(ctx, out, t, 0.5 * v, 0.005, 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.3);
    lp.connect(g);
    tone(ctx, lp, "sawtooth", freq, t, 0.5);
  };
}

function bass(freq: number): Voice {
  return (ctx, out, t, v) => {
    const g = env(ctx, out, t, 0.7 * v, 0.01, 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.connect(g);
    tone(ctx, lp, "sawtooth", freq, t, 0.55);
    tone(ctx, lp, "sine", freq / 2, t, 0.55);
  };
}

// Equal-tempered frequency for a MIDI-style note number (A4 = 440).
function hz(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

/* ------------------------------------------------------------------ *
 * Kits — pad layout is mobile-first 4 columns, two rows of pads.
 * Keyboard layout maps to a familiar two-row launchpad cluster.
 * ------------------------------------------------------------------ */

const KEY_ROW = ["1", "2", "3", "4", "q", "w", "e", "r"];

const DRUM_KIT: Kit = {
  id: "drums",
  name: "Drums",
  icon: "drum",
  pads: [
    { id: "kick", label: "Kick", hint: "808 thump", hue: 350, voice: kick, key: KEY_ROW[0] },
    { id: "snare", label: "Snare", hint: "snappy", hue: 28, voice: snare, key: KEY_ROW[1] },
    { id: "clap", label: "Clap", hint: "stutter", hue: 48, voice: clap, key: KEY_ROW[2] },
    { id: "rim", label: "Rim", hint: "tight click", hue: 92, voice: rimshot, key: KEY_ROW[3] },
    { id: "hatC", label: "Hat", hint: "closed", hue: 168, voice: hatClosed, key: KEY_ROW[4] },
    { id: "hatO", label: "Open Hat", hint: "sizzle", hue: 192, voice: hatOpen, key: KEY_ROW[5] },
    { id: "tomL", label: "Tom Lo", hint: "round", hue: 268, voice: tomLow, key: KEY_ROW[6] },
    { id: "tomH", label: "Tom Hi", hint: "punch", hue: 312, voice: tomHigh, key: KEY_ROW[7] },
  ],
};

const TONE_KIT: Kit = {
  id: "tones",
  name: "Tones",
  icon: "music",
  pads: [
    { id: "bC", label: "Bass C", hint: "sub saw", hue: 350, voice: bass(hz(-21)), key: KEY_ROW[0] },
    { id: "bG", label: "Bass G", hint: "sub saw", hue: 20, voice: bass(hz(-14)), key: KEY_ROW[1] },
    { id: "pC", label: "Pluck C", hint: "filtered", hue: 50, voice: pluck(hz(3)), key: KEY_ROW[2] },
    { id: "pE", label: "Pluck E", hint: "filtered", hue: 100, voice: pluck(hz(7)), key: KEY_ROW[3] },
    { id: "nC", label: "Key C", hint: "soft tri", hue: 165, voice: note(hz(3), "triangle", 0.5), key: KEY_ROW[4] },
    { id: "nE", label: "Key E", hint: "soft tri", hue: 195, voice: note(hz(7), "triangle", 0.5), key: KEY_ROW[5] },
    { id: "nG", label: "Key G", hint: "soft tri", hue: 265, voice: note(hz(10), "triangle", 0.5), key: KEY_ROW[6] },
    { id: "nC2", label: "Key C↑", hint: "soft tri", hue: 315, voice: note(hz(15), "triangle", 0.5), key: KEY_ROW[7] },
  ],
};

const FX_KIT: Kit = {
  id: "fx",
  name: "FX",
  icon: "zap",
  pads: [
    {
      id: "zap", label: "Zap", hint: "laser", hue: 350, key: KEY_ROW[0],
      voice: (ctx, out, t, v) => {
        const g = env(ctx, out, t, 0.5 * v, 0.005, 0.3);
        const o = tone(ctx, g, "sawtooth", 1800, t, 0.32);
        o.frequency.exponentialRampToValueAtTime(120, t + 0.28);
      },
    },
    {
      id: "rise", label: "Riser", hint: "sweep up", hue: 24, key: KEY_ROW[1],
      voice: (ctx, out, t, v) => {
        const g = env(ctx, out, t, 0.4 * v, 0.2, 0.4);
        const o = tone(ctx, g, "sawtooth", 120, t, 0.65);
        o.frequency.exponentialRampToValueAtTime(2400, t + 0.6);
      },
    },
    {
      id: "drop", label: "Drop", hint: "sweep dn", hue: 50, key: KEY_ROW[2],
      voice: (ctx, out, t, v) => {
        const g = env(ctx, out, t, 0.45 * v, 0.01, 0.5);
        const o = tone(ctx, g, "square", 2000, t, 0.55);
        o.frequency.exponentialRampToValueAtTime(80, t + 0.5);
      },
    },
    {
      id: "blip", label: "Blip", hint: "arcade", hue: 95, key: KEY_ROW[3],
      voice: (ctx, out, t, v) => {
        const g = env(ctx, out, t, 0.4 * v, 0.005, 0.12);
        tone(ctx, g, "square", hz(15), t, 0.06);
        tone(ctx, g, "square", hz(22), t + 0.06, 0.06);
      },
    },
    {
      id: "noise", label: "Sweep", hint: "white", hue: 168, key: KEY_ROW[4],
      voice: (ctx, out, t, v) => {
        const g = env(ctx, out, t, 0.5 * v, 0.05, 0.5);
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.setValueAtTime(400, t);
        bp.frequency.exponentialRampToValueAtTime(6000, t + 0.5);
        bp.Q.value = 4;
        bp.connect(g);
        noise(ctx, bp, t, 0.6);
      },
    },
    {
      id: "stab", label: "Stab", hint: "chord", hue: 195, key: KEY_ROW[5],
      voice: (ctx, out, t, v) => {
        const g = env(ctx, out, t, 0.3 * v, 0.005, 0.4);
        [hz(3), hz(7), hz(10)].forEach((f) => tone(ctx, g, "sawtooth", f, t, 0.4));
      },
    },
    {
      id: "wob", label: "Wobble", hint: "lfo bass", hue: 268, key: KEY_ROW[6],
      voice: (ctx, out, t, v) => {
        const g = env(ctx, out, t, 0.6 * v, 0.01, 0.55);
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 600;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 9;
        const lfoG = ctx.createGain();
        lfoG.gain.value = 400;
        lfo.connect(lfoG);
        lfoG.connect(lp.frequency);
        lfo.start(t);
        lfo.stop(t + 0.6);
        lp.connect(g);
        tone(ctx, lp, "sawtooth", hz(-21), t, 0.6);
      },
    },
    {
      id: "ping", label: "Ping", hint: "bell", hue: 315, key: KEY_ROW[7],
      voice: (ctx, out, t, v) => {
        const g = env(ctx, out, t, 0.4 * v, 0.002, 0.7);
        tone(ctx, g, "sine", hz(19), t, 0.75);
        const o2 = tone(ctx, g, "sine", hz(19) * 2.01, t, 0.4);
        o2.detune.value = 4;
      },
    },
  ],
};

const KITS: Kit[] = [DRUM_KIT, TONE_KIT, FX_KIT];

/* ------------------------------------------------------------------ *
 * Audio engine — lazy AudioContext, master gain, graceful fallback.
 * ------------------------------------------------------------------ */

function getAudioCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function audioSupported(): boolean {
  return getAudioCtor() !== undefined;
}

interface Engine {
  ctx: AudioContext;
  master: GainNode;
}

/* ------------------------------------------------------------------ *
 * Scoped styles — console body, glossy neon pads, active glow.
 * ------------------------------------------------------------------ */

const STYLES = `
.sb {
  --font-ui: "Space Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --bg: #0a0a0f;
  --bg-2: #101019;
  --console: #15151f;
  --console-2: #1c1c28;
  --edge: #2a2a3a;
  --groove: #07070b;
  --text: #f4f4fb;
  --muted: #8a8aa0;
  --faint: #54546a;
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
  padding:
    env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left);
}

.sb-grain {
  position: absolute; inset: 0; pointer-events: none; opacity: .5; mix-blend-mode: overlay;
  background-image: radial-gradient(rgba(255,255,255,.05) 1px, transparent 1px);
  background-size: 3px 3px;
}

.pad {
  position: relative;
  border-radius: 18px;
  background:
    linear-gradient(180deg, hsla(var(--h),85%,62%,0.20), hsla(var(--h),85%,40%,0.05) 55%, rgba(0,0,0,.35)),
    var(--console-2);
  border: 1px solid hsla(var(--h),80%,60%,0.32);
  box-shadow:
    inset 0 1px 0 hsla(var(--h),90%,75%,0.25),
    inset 0 -10px 20px rgba(0,0,0,.45),
    0 6px 14px rgba(0,0,0,.5);
  color: var(--text);
  transition: transform .07s ease, box-shadow .12s ease, filter .15s ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  overflow: hidden;
}
.pad::before {
  content: "";
  position: absolute; inset: 0; border-radius: 18px; pointer-events: none;
  background: radial-gradient(120% 80% at 50% -10%, hsla(var(--h),95%,75%,0.35), transparent 60%);
  opacity: .5;
}
.pad:active { transform: translateY(2px) scale(.985); }
.pad.hit {
  transform: translateY(1px) scale(.99);
  filter: saturate(1.4);
  box-shadow:
    inset 0 1px 0 hsla(var(--h),95%,80%,0.5),
    inset 0 0 24px hsla(var(--h),95%,60%,0.55),
    0 0 0 1px hsla(var(--h),95%,65%,0.9),
    0 0 34px 4px hsla(var(--h),95%,60%,0.65),
    0 6px 14px rgba(0,0,0,.5);
}

.pad-led {
  box-shadow: 0 0 8px hsla(var(--h),95%,65%,0.9);
}

.kit-btn { transition: background .15s ease, color .15s ease, box-shadow .15s ease; -webkit-tap-highlight-color: transparent; }

.slider {
  -webkit-appearance: none; appearance: none;
  height: 6px; border-radius: 99px; outline: none;
  background: linear-gradient(90deg, var(--accent) var(--fill,60%), var(--groove) var(--fill,60%));
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 22px; height: 22px; border-radius: 50%;
  background: #f4f4fb;
  border: 3px solid var(--accent);
  box-shadow: 0 2px 6px rgba(0,0,0,.6), 0 0 10px var(--accent);
  cursor: pointer;
}
.slider::-moz-range-thumb {
  width: 22px; height: 22px; border-radius: 50%;
  background: #f4f4fb; border: 3px solid var(--accent);
  box-shadow: 0 2px 6px rgba(0,0,0,.6);
  cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  .pad { transition: none; }
}
`;

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

const VOL_KEY = "soundboard-sampler:volume";
const KIT_KEY = "soundboard-sampler:kit";

function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOL_KEY);
    if (raw == null) return 0.8;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.8;
  } catch {
    return 0.8;
  }
}

function loadKit(): number {
  try {
    const id = localStorage.getItem(KIT_KEY);
    const idx = KITS.findIndex((k) => k.id === id);
    return idx >= 0 ? idx : 0;
  } catch {
    return 0;
  }
}

export default function App() {
  const [kitIndex, setKitIndex] = useState<number>(loadKit);
  const [volume, setVolume] = useState<number>(loadVolume);
  const [muted, setMuted] = useState(false);
  const [hits, setHits] = useState<Record<string, number>>({});
  const [armed, setArmed] = useState(false); // has audio been unlocked?

  const engineRef = useRef<Engine | null>(null);
  const hitTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const kit = KITS[kitIndex];
  const supported = useMemo(() => audioSupported(), []);

  /* Lazily build (or fetch) the audio engine. Returns null if Web
     Audio is unavailable — callers must tolerate that. */
  const ensureEngine = useCallback((): Engine | null => {
    if (engineRef.current) return engineRef.current;
    const Ctor = getAudioCtor();
    if (!Ctor) return null;
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    const master = ctx.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(ctx.destination);
    engineRef.current = { ctx, master };
    return engineRef.current;
  }, [muted, volume]);

  /* Keep master gain in sync with volume/mute. */
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const target = muted ? 0 : volume;
    try {
      eng.master.gain.setTargetAtTime(target, eng.ctx.currentTime, 0.01);
    } catch {
      eng.master.gain.value = target;
    }
  }, [volume, muted]);

  /* Persist volume + kit. */
  useEffect(() => {
    try {
      localStorage.setItem(VOL_KEY, String(volume));
    } catch {
      /* ignore */
    }
  }, [volume]);
  useEffect(() => {
    try {
      localStorage.setItem(KIT_KEY, kit.id);
    } catch {
      /* ignore */
    }
  }, [kit.id]);

  const flash = useCallback((padId: string) => {
    setHits((h) => ({ ...h, [padId]: (h[padId] ?? 0) + 1 }));
    clearTimeout(hitTimers.current[padId]);
    hitTimers.current[padId] = setTimeout(() => {
      setHits((h) => {
        const next = { ...h };
        delete next[padId];
        return next;
      });
    }, 140);
  }, []);

  /* Trigger a pad. ALWAYS flashes (visual feedback) and NEVER throws,
     even when Web Audio is missing — audio is best-effort. */
  const trigger = useCallback(
    (pad: Pad, velocity = 1) => {
      flash(pad.id);
      const eng = ensureEngine();
      if (!eng) return;
      const { ctx, master } = eng;
      if (!armed) setArmed(true);
      try {
        if (ctx.state === "suspended") void ctx.resume();
        pad.voice(ctx, master, ctx.currentTime + 0.001, velocity);
      } catch {
        /* a voice failed — don't break the UI */
      }
    },
    [ensureEngine, flash, armed]
  );

  /* Keyboard → pad mapping (current kit). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      const pad = kit.pads.find((p) => p.key === k);
      if (pad) {
        e.preventDefault();
        trigger(pad);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kit, trigger]);

  useEffect(() => {
    const timers = hitTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const fillPct = Math.round((muted ? 0 : volume) * 100);

  return (
    <div
      className="sb relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--text)]"
      style={{ "--accent": "#ff2e88" } as CSSProperties}
    >
      <style>{STYLES}</style>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 60% at 50% -8%, rgba(120,40,180,0.28), transparent 60%), radial-gradient(60% 50% at 100% 100%, rgba(20,120,180,0.18), transparent 65%)",
        }}
      />
      <div className="sb-grain" />

      {/* Console header */}
      <header className="relative z-10 flex items-center gap-3 px-4 pt-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{
              background: "linear-gradient(180deg,#ff2e88,#7a1fd0)",
              boxShadow: "0 0 18px rgba(255,46,136,0.5)",
            }}
          >
            <Drum className="h-5 w-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight">SAMPLER</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--faint)]">
              offline pad console
            </div>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold"
            style={{
              borderColor: armed ? "#2dd4bf55" : "var(--edge)",
              color: armed ? "#2dd4bf" : "var(--faint)",
            }}
            aria-label={armed ? "Audio engine live" : "Audio engine idle"}
          >
            <Power className="h-3 w-3" />
            {supported ? (armed ? "LIVE" : "TAP TO ARM") : "NO AUDIO"}
          </span>
        </div>
      </header>

      {/* Kit selector */}
      <nav
        className="relative z-10 mt-4 flex gap-2 overflow-x-auto px-4 sm:px-6"
        aria-label="Kit selector"
      >
        {KITS.map((k, i) => {
          const active = i === kitIndex;
          const Icon = k.icon === "drum" ? Drum : k.icon === "music" ? Music4 : Zap;
          return (
            <button
              key={k.id}
              onClick={() => setKitIndex(i)}
              aria-pressed={active}
              aria-label={`Kit ${k.name}`}
              className="kit-btn flex shrink-0 items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-semibold"
              style={{
                borderColor: active ? "#ff2e8866" : "var(--edge)",
                background: active
                  ? "linear-gradient(180deg,#ff2e8830,#7a1fd020)"
                  : "var(--console)",
                color: active ? "#fff" : "var(--muted)",
                boxShadow: active ? "0 0 18px rgba(255,46,136,0.25)" : "none",
              }}
            >
              <Icon className="h-4 w-4" />
              {k.name}
            </button>
          );
        })}
      </nav>

      {/* Pad grid */}
      <main className="relative z-10 flex flex-1 items-center px-4 py-4 sm:px-6">
        <div
          className="grid w-full grid-cols-2 gap-3 sm:grid-cols-4"
          role="group"
          aria-label={`${kit.name} pads`}
        >
          {kit.pads.map((pad) => {
            const isHit = hits[pad.id] != null;
            return (
              <button
                key={pad.id}
                className={`pad flex aspect-square flex-col items-start justify-between p-3 text-left sm:p-4${
                  isHit ? " hit" : ""
                }`}
                style={{ "--h": String(pad.hue) } as CSSProperties}
                aria-label={`Play ${pad.label}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  trigger(pad);
                }}
              >
                <div className="flex w-full items-center justify-between">
                  <span
                    className="pad-led h-2.5 w-2.5 rounded-full"
                    style={{
                      background: `hsl(${pad.hue} 95% 62%)`,
                      opacity: isHit ? 1 : 0.85,
                    }}
                  />
                  <span
                    className="rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase"
                    style={{
                      borderColor: `hsla(${pad.hue},80%,60%,0.35)`,
                      color: `hsl(${pad.hue} 85% 78%)`,
                    }}
                  >
                    {pad.key}
                  </span>
                </div>
                <div>
                  <div className="text-[15px] font-bold leading-tight sm:text-base">
                    {pad.label}
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">{pad.hint}</div>
                </div>
              </button>
            );
          })}
        </div>
      </main>

      {/* Master volume bar */}
      <footer className="relative z-10 flex items-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
        <button
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          className="kit-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
          style={{
            borderColor: "var(--edge)",
            background: "var(--console)",
            color: muted ? "#ff2e88" : "var(--text)",
          }}
        >
          {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        <div className="flex flex-1 items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              setVolume(Number(e.target.value) / 100);
              if (muted) setMuted(false);
            }}
            aria-label="Master volume"
            className="slider w-full"
            style={
              {
                "--fill": `${fillPct}%`,
                "--accent": "#ff2e88",
              } as CSSProperties
            }
          />
          <span
            className="w-10 text-right text-[12px] font-semibold tabular-nums text-[var(--muted)]"
            aria-hidden="true"
          >
            {fillPct}%
          </span>
        </div>
      </footer>
    </div>
  );
}
