import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Compass,
  Crosshair,
  ShieldCheck,
  Smartphone,
  AlertTriangle,
  Check,
} from "lucide-react";

/* ================================================================== *
 * Pocket Level & Compass
 * A precision analog instrument: spirit level + magnetic compass,
 * driven by DeviceOrientationEvent. Engraved, technical, deep-navy.
 *
 * All sensor math lives in pure, exported-internally helpers so they
 * can be exercised in jsdom where the sensors themselves are absent.
 * ================================================================== */

/* ------------------------------------------------------------------ *
 * Pure helpers (sensor-free, deterministic, unit-tested)
 * ------------------------------------------------------------------ */

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/** Tolerance (in degrees) under which a surface is considered "level". */
export const LEVEL_TOLERANCE = 1;

export interface TiltReading {
  /** Front/back tilt in degrees (from beta), clamped to ±90. */
  pitch: number;
  /** Left/right tilt in degrees (from gamma), clamped to ±90. */
  roll: number;
  /** Bubble X offset in unit space [-1, 1] (1 = right edge of vial). */
  x: number;
  /** Bubble Y offset in unit space [-1, 1] (1 = bottom edge of vial). */
  y: number;
  /** Combined tilt magnitude in degrees. */
  magnitude: number;
  /** True when within LEVEL_TOLERANCE of perfectly flat. */
  level: boolean;
}

/**
 * Convert raw DeviceOrientation beta (front/back) and gamma (left/right)
 * into a bubble position and tilt readout for a circular spirit vial.
 *
 * - beta: device front/back tilt, roughly [-180, 180]; flat ≈ 0.
 * - gamma: device left/right tilt, roughly [-90, 90]; flat ≈ 0.
 *
 * The bubble drifts toward the *high* side (away from gravity), like a
 * real bubble level: tilting the right side up sends the bubble right.
 */
export function computeTilt(
  beta: number | null | undefined,
  gamma: number | null | undefined,
  range = 30
): TiltReading {
  const b = Number.isFinite(beta as number) ? (beta as number) : 0;
  const g = Number.isFinite(gamma as number) ? (gamma as number) : 0;

  const pitch = clamp(b, -90, 90);
  const roll = clamp(g, -90, 90);

  // Map the working range to unit space; bubble rises to the high side.
  const x = clamp(roll / range, -1, 1);
  const y = clamp(pitch / range, -1, 1);

  const magnitude = Math.min(90, Math.hypot(pitch, roll));
  const level = Math.abs(pitch) < LEVEL_TOLERANCE && Math.abs(roll) < LEVEL_TOLERANCE;

  return { pitch, roll, x, y, magnitude, level };
}

/** Normalize any heading into [0, 360). */
export function normalizeHeading(deg: number | null | undefined): number {
  if (!Number.isFinite(deg as number)) return 0;
  let d = (deg as number) % 360;
  if (d < 0) d += 360;
  return d;
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Cardinal = (typeof CARDINALS)[number];

/** Map a heading in degrees to its 8-point cardinal label. */
export function headingToCardinal(deg: number | null | undefined): Cardinal {
  const d = normalizeHeading(deg);
  const idx = Math.round(d / 45) % 8;
  return CARDINALS[idx];
}

/** Longer human label for a cardinal, used in the readout subtitle. */
export function cardinalName(c: Cardinal): string {
  return {
    N: "North",
    NE: "Northeast",
    E: "East",
    SE: "Southeast",
    S: "South",
    SW: "Southwest",
    W: "West",
    NW: "Northwest",
  }[c];
}

/** Format a degree value with a fixed width and the degree glyph. */
export function fmtDeg(n: number, digits = 1): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v.toFixed(digits)}°`;
}

export type SensorSupport = "unknown" | "supported" | "unsupported";

/** Feature-detect orientation sensor availability without touching it. */
export function detectSupport(
  win: Window | undefined = typeof window !== "undefined" ? window : undefined
): SensorSupport {
  if (!win) return "unsupported";
  const hasOrientation =
    "DeviceOrientationEvent" in win || "ondeviceorientation" in win;
  const hasAbsolute = "ondeviceorientationabsolute" in win;
  return hasOrientation || hasAbsolute ? "supported" : "unsupported";
}

/** Does this platform gate sensors behind an explicit permission grant? */
export function needsPermission(
  win: Window | undefined = typeof window !== "undefined" ? window : undefined
): boolean {
  if (!win) return false;
  const doe = (win as unknown as {
    DeviceOrientationEvent?: { requestPermission?: unknown };
  }).DeviceOrientationEvent;
  return typeof doe?.requestPermission === "function";
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

type Tab = "level" | "compass";
type Status = "idle" | "live" | "denied" | "unsupported";

interface DemoState {
  beta: number;
  gamma: number;
  heading: number;
}

export default function PocketLevelCompass() {
  const [tab, setTab] = useState<Tab>("level");
  const [status, setStatus] = useState<Status>("idle");

  const [beta, setBeta] = useState<number | null>(null);
  const [gamma, setGamma] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);

  // Gentle idle demo so the dials are presentable before sensors start
  // (and on desktop, where they never will).
  const [demo, setDemo] = useState<DemoState>({ beta: 0, gamma: 0, heading: 0 });

  const support = useMemo(() => detectSupport(), []);
  const gated = useMemo(() => needsPermission(), []);

  useEffect(() => {
    if (support === "unsupported") setStatus("unsupported");
  }, [support]);

  // Idle / demo animation — runs whenever sensors are NOT live.
  useEffect(() => {
    if (status === "live") return;
    let raf = 0;
    const start = performance.now();
    const loop = (t: number) => {
      const e = (t - start) / 1000;
      setDemo({
        beta: Math.sin(e * 0.7) * 9,
        gamma: Math.cos(e * 0.9) * 12,
        heading: (e * 14) % 360,
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [status]);

  const handlerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);

  const startListening = useCallback(() => {
    const onOrient = (e: DeviceOrientationEvent) => {
      setBeta(e.beta);
      setGamma(e.gamma);
      const wk = (e as unknown as { webkitCompassHeading?: number })
        .webkitCompassHeading;
      if (Number.isFinite(wk)) {
        setHeading(wk as number);
      } else if (Number.isFinite(e.alpha)) {
        // alpha increases counter-clockwise; convert to clockwise compass.
        setHeading(normalizeHeading(360 - (e.alpha as number)));
      }
    };
    handlerRef.current = onOrient;
    // Absolute event gives true (magnetic-north) heading where available.
    window.addEventListener("deviceorientationabsolute", onOrient as EventListener);
    window.addEventListener("deviceorientation", onOrient);
    setStatus("live");
  }, []);

  useEffect(() => {
    return () => {
      const h = handlerRef.current;
      if (h) {
        window.removeEventListener(
          "deviceorientationabsolute",
          h as EventListener
        );
        window.removeEventListener("deviceorientation", h);
      }
    };
  }, []);

  const enable = useCallback(async () => {
    if (support === "unsupported") {
      setStatus("unsupported");
      return;
    }
    try {
      if (gated) {
        const doe = (window as unknown as {
          DeviceOrientationEvent: { requestPermission: () => Promise<string> };
        }).DeviceOrientationEvent;
        const res = await doe.requestPermission();
        if (res !== "granted") {
          setStatus("denied");
          return;
        }
      }
      startListening();
    } catch {
      setStatus("denied");
    }
  }, [gated, support, startListening]);

  // Effective readings: live sensor data, else the idle demo.
  const live = status === "live";
  const effBeta = live ? beta : demo.beta;
  const effGamma = live ? gamma : demo.gamma;
  const effHeading = live ? heading : demo.heading;

  const tilt = useMemo(() => computeTilt(effBeta, effGamma), [effBeta, effGamma]);
  const compassHeading = useMemo(
    () => normalizeHeading(effHeading),
    [effHeading]
  );
  const cardinal = headingToCardinal(compassHeading);

  return (
    <div
      className="app relative flex h-[100dvh] w-full flex-col overflow-hidden text-[var(--ink)]"
      style={
        {
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        } as CSSProperties
      }
    >
      <ScopedStyle />

      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-md border border-[var(--hair)] bg-[var(--bezel)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <Crosshair className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.75} />
          </span>
          <div className="leading-tight">
            <div className="font-mono text-[13px] tracking-[0.22em] text-[var(--ink)]">
              POCKET
            </div>
            <div className="font-mono text-[10px] tracking-[0.34em] text-[var(--ink-dim)]">
              LEVEL · COMPASS
            </div>
          </div>
        </div>
        <StatusPill status={status} />
      </header>

      {/* Tabs */}
      <nav className="mt-4 px-5">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-[var(--hair)] bg-[var(--bezel)] p-1">
          <TabButton
            active={tab === "level"}
            onClick={() => setTab("level")}
            icon={<Crosshair className="h-4 w-4" strokeWidth={1.75} />}
            label="LEVEL"
          />
          <TabButton
            active={tab === "compass"}
            onClick={() => setTab("compass")}
            icon={<Compass className="h-4 w-4" strokeWidth={1.75} />}
            label="COMPASS"
          />
        </div>
      </nav>

      {/* Instrument stage */}
      <main className="flex min-h-0 flex-1 items-center justify-center px-5 py-4">
        {tab === "level" ? (
          <LevelDial tilt={tilt} live={live} />
        ) : (
          <CompassDial heading={compassHeading} cardinal={cardinal} live={live} />
        )}
      </main>

      {/* Footer control */}
      <footer className="px-5 pb-6">
        {status === "live" ? (
          <div className="flex items-center justify-center gap-2 font-mono text-[11px] tracking-[0.2em] text-[var(--ink-dim)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
            SENSORS LIVE
          </div>
        ) : status === "unsupported" ? (
          <UnsupportedNotice />
        ) : (
          <button
            onClick={enable}
            aria-label="Enable sensors"
            className="group flex w-full items-center justify-center gap-2.5 rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] px-5 py-4 font-mono text-[13px] tracking-[0.18em] text-[var(--accent)] transition active:scale-[0.99]"
          >
            <ShieldCheck className="h-4.5 w-4.5" strokeWidth={1.75} />
            ENABLE SENSORS
          </button>
        )}
        {status === "denied" && (
          <p className="mt-3 text-center font-mono text-[11px] leading-relaxed tracking-wide text-[var(--warn)]">
            Permission denied — showing idle demo. Re-enable in Settings, then tap
            again.
          </p>
        )}
        {(status === "idle" || status === "denied") &&
          support !== "unsupported" && (
            <p className="mt-3 text-center font-mono text-[10px] leading-relaxed tracking-[0.12em] text-[var(--ink-dim)]">
              {gated
                ? "iOS requires a tap to grant motion access."
                : "Tap to begin reading device orientation."}
            </p>
          )}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Subcomponents
 * ------------------------------------------------------------------ */

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    idle: { label: "IDLE", cls: "text-[var(--ink-dim)] border-[var(--hair)]" },
    live: { label: "LIVE", cls: "text-[var(--accent)] border-[var(--accent-line)]" },
    denied: { label: "DENIED", cls: "text-[var(--warn)] border-[var(--warn)]/40" },
    unsupported: {
      label: "N/A",
      cls: "text-[var(--ink-dim)] border-[var(--hair)]",
    },
  };
  const s = map[status];
  return (
    <span
      className={`rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.2em] ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center justify-center gap-2 rounded-md px-3 py-2.5 font-mono text-[12px] tracking-[0.18em] transition ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
          : "text-[var(--ink-dim)] hover:text-[var(--ink)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ----- Spirit level ----- */

function LevelDial({ tilt, live }: { tilt: TiltReading; live: boolean }) {
  const size = 280;
  const r = size / 2;
  const usable = r - 34; // bubble travel radius
  const bx = r + tilt.x * usable;
  const by = r + tilt.y * usable;
  const isLevel = tilt.level;

  return (
    <div className="flex w-full max-w-[340px] flex-col items-center gap-6">
      <div
        className="relative grid place-items-center rounded-full"
        style={{ width: size, height: size }}
      >
        {/* Bezel */}
        <div className="absolute inset-0 rounded-full border border-[var(--hair)] bg-[var(--bezel)] shadow-[inset_0_2px_10px_rgba(0,0,0,0.5),0_8px_30px_rgba(0,0,0,0.4)]" />
        {/* Engraved tick ring */}
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {Array.from({ length: 72 }).map((_, i) => {
            const major = i % 6 === 0;
            const a = (i / 72) * Math.PI * 2;
            const r0 = 48;
            const r1 = major ? 43 : 45.5;
            return (
              <line
                key={i}
                x1={50 + r0 * Math.cos(a)}
                y1={50 + r0 * Math.sin(a)}
                x2={50 + r1 * Math.cos(a)}
                y2={50 + r1 * Math.sin(a)}
                stroke={major ? "var(--tick-major)" : "var(--tick-minor)"}
                strokeWidth={major ? 0.7 : 0.4}
              />
            );
          })}
        </svg>
        {/* Vial face */}
        <div
          className="relative grid place-items-center rounded-full"
          style={{ width: size - 56, height: size - 56 }}
        >
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_35%,var(--vial-hi),var(--vial-lo))] shadow-[inset_0_0_30px_rgba(0,0,0,0.55)]" />
          {/* Crosshair + concentric target rings */}
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            <circle cx="50" cy="50" r="14" fill="none" stroke="var(--ring)" strokeWidth="0.5" />
            <circle cx="50" cy="50" r="28" fill="none" stroke="var(--ring)" strokeWidth="0.4" />
            <line x1="50" y1="6" x2="50" y2="94" stroke="var(--ring)" strokeWidth="0.4" />
            <line x1="6" y1="50" x2="94" y2="50" stroke="var(--ring)" strokeWidth="0.4" />
            <circle
              cx="50"
              cy="50"
              r="13"
              fill="none"
              stroke={isLevel ? "var(--accent)" : "var(--ring-strong)"}
              strokeWidth="0.8"
            />
          </svg>
          {/* Bubble */}
          <div
            className="absolute h-12 w-12 rounded-full transition-[left,top] duration-100 ease-out"
            style={{
              left: bx - 56 / 2 - 24 + 28,
              top: by - 56 / 2 - 24 + 28,
              background: isLevel
                ? "radial-gradient(circle at 38% 32%, var(--bubble-hi-ok), var(--bubble-lo-ok))"
                : "radial-gradient(circle at 38% 32%, var(--bubble-hi), var(--bubble-lo))",
              boxShadow: isLevel
                ? "0 0 18px var(--accent), inset 0 1px 2px rgba(255,255,255,0.5)"
                : "0 2px 8px rgba(0,0,0,0.4), inset 0 1px 2px rgba(255,255,255,0.4)",
            }}
          />
        </div>
        {/* Level badge */}
        {isLevel && (
          <div className="pointer-events-none absolute -bottom-1 flex items-center gap-1.5 rounded-full border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-1 font-mono text-[10px] tracking-[0.24em] text-[var(--accent)] backdrop-blur">
            <Check className="h-3 w-3" strokeWidth={2.5} /> LEVEL
          </div>
        )}
      </div>

      {/* Axis readout */}
      <div className="grid w-full grid-cols-2 gap-3">
        <AxisCard label="ROLL · X" value={fmtDeg(tilt.roll)} flat={Math.abs(tilt.roll) < LEVEL_TOLERANCE} />
        <AxisCard label="PITCH · Y" value={fmtDeg(tilt.pitch)} flat={Math.abs(tilt.pitch) < LEVEL_TOLERANCE} />
      </div>
      {!live && (
        <p className="font-mono text-[10px] tracking-[0.16em] text-[var(--ink-dim)]">
          IDLE DEMO — enable sensors for live readings
        </p>
      )}
    </div>
  );
}

function AxisCard({
  label,
  value,
  flat,
}: {
  label: string;
  value: string;
  flat: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--hair)] bg-[var(--bezel)] px-4 py-3">
      <div className="font-mono text-[10px] tracking-[0.22em] text-[var(--ink-dim)]">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-[22px] tabular-nums tracking-tight ${
          flat ? "text-[var(--accent)]" : "text-[var(--ink)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/* ----- Compass ----- */

function CompassDial({
  heading,
  cardinal,
  live,
}: {
  heading: number;
  cardinal: Cardinal;
  live: boolean;
}) {
  const size = 280;
  const marks = ["N", "E", "S", "W"];

  return (
    <div className="flex w-full max-w-[340px] flex-col items-center gap-6">
      <div
        className="relative grid place-items-center rounded-full"
        style={{ width: size, height: size }}
      >
        <div className="absolute inset-0 rounded-full border border-[var(--hair)] bg-[var(--bezel)] shadow-[inset_0_2px_10px_rgba(0,0,0,0.5),0_8px_30px_rgba(0,0,0,0.4)]" />

        {/* Fixed lubber line (top index) */}
        <div className="absolute left-1/2 top-1 z-20 h-4 w-[2px] -translate-x-1/2 rounded-full bg-[var(--accent)]" />

        {/* Rotating dial */}
        <div
          className="absolute inset-3 rounded-full transition-transform duration-150 ease-out"
          style={{ transform: `rotate(${-heading}deg)` }}
        >
          <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_30%,var(--vial-hi),var(--vial-lo))] shadow-[inset_0_0_30px_rgba(0,0,0,0.5)]" />
          <svg
            viewBox="0 0 100 100"
            className="absolute inset-0 h-full w-full"
            aria-hidden="true"
          >
            {Array.from({ length: 72 }).map((_, i) => {
              const major = i % 6 === 0;
              const a = (i / 72) * Math.PI * 2 - Math.PI / 2;
              const r0 = 47;
              const r1 = major ? 41 : 44;
              return (
                <line
                  key={i}
                  x1={50 + r0 * Math.cos(a)}
                  y1={50 + r0 * Math.sin(a)}
                  x2={50 + r1 * Math.cos(a)}
                  y2={50 + r1 * Math.sin(a)}
                  stroke={major ? "var(--tick-major)" : "var(--tick-minor)"}
                  strokeWidth={major ? 0.7 : 0.4}
                />
              );
            })}
            {marks.map((m, i) => {
              const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
              const rr = 33;
              return (
                <text
                  key={m}
                  x={50 + rr * Math.cos(a)}
                  y={50 + rr * Math.sin(a)}
                  fontSize="7"
                  fontFamily="ui-monospace, monospace"
                  fontWeight={m === "N" ? 700 : 500}
                  fill={m === "N" ? "var(--accent)" : "var(--ink)"}
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={`rotate(${heading} ${50 + rr * Math.cos(a)} ${
                    50 + rr * Math.sin(a)
                  })`}
                >
                  {m}
                </text>
              );
            })}
            {/* North needle */}
            <polygon
              points="50,12 46.5,50 53.5,50"
              fill="var(--accent)"
            />
            <polygon
              points="50,88 46.5,50 53.5,50"
              fill="var(--needle-s)"
            />
            <circle cx="50" cy="50" r="2.4" fill="var(--bezel)" stroke="var(--ink-dim)" strokeWidth="0.5" />
          </svg>
        </div>

        {/* Center digital readout */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="font-mono text-[40px] leading-none tabular-nums tracking-tight text-[var(--ink)]">
            {Math.round(heading)}
            <span className="text-[var(--ink-dim)]">&deg;</span>
          </div>
          <div className="mt-1 font-mono text-[14px] tracking-[0.3em] text-[var(--accent)]">
            {cardinal}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--hair)] bg-[var(--bezel)] px-5 py-3 text-center">
        <div className="font-mono text-[10px] tracking-[0.22em] text-[var(--ink-dim)]">
          HEADING
        </div>
        <div className="mt-0.5 font-mono text-[15px] tracking-[0.1em] text-[var(--ink)]">
          {fmtDeg(heading, 0)} · {cardinalName(cardinal)}
        </div>
      </div>
      {!live && (
        <p className="font-mono text-[10px] tracking-[0.16em] text-[var(--ink-dim)]">
          IDLE DEMO — enable sensors for live readings
        </p>
      )}
    </div>
  );
}

function UnsupportedNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--hair)] bg-[var(--bezel)] px-4 py-4">
      <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ink-dim)]" strokeWidth={1.6} />
      <div>
        <div className="flex items-center gap-1.5 font-mono text-[12px] tracking-[0.16em] text-[var(--warn)]">
          <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
          NO MOTION SENSORS
        </div>
        <p className="mt-1 font-mono text-[11px] leading-relaxed tracking-wide text-[var(--ink-dim)]">
          This device or browser doesn't expose orientation data. Open on a phone
          to use the live level and compass — an idle demo is shown meanwhile.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Scoped theme + texture (independent of the Store's Tailwind build)
 * ------------------------------------------------------------------ */

function ScopedStyle() {
  return (
    <style>{`
      .app {
        --bg: #0b1220;
        --bg-2: #0e1726;
        --bezel: #131c2e;
        --ink: #e8eef7;
        --ink-dim: #6f7f99;
        --hair: rgba(140,165,200,0.16);
        --accent: #f0b54a;
        --accent-soft: rgba(240,181,74,0.10);
        --accent-line: rgba(240,181,74,0.35);
        --warn: #e8825a;
        --tick-major: rgba(232,238,247,0.55);
        --tick-minor: rgba(140,165,200,0.28);
        --ring: rgba(140,165,200,0.30);
        --ring-strong: rgba(232,238,247,0.5);
        --vial-hi: #18243a;
        --vial-lo: #0a1120;
        --bubble-hi: #cfe0f5;
        --bubble-lo: #6b86ad;
        --bubble-hi-ok: #ffe7ad;
        --bubble-lo-ok: #f0b54a;
        --needle-s: #46566f;
        font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
        background:
          radial-gradient(1100px 600px at 50% -10%, var(--bg-2), transparent 60%),
          var(--bg);
        -webkit-tap-highlight-color: transparent;
      }
      .app::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background-image:
          linear-gradient(rgba(140,165,200,0.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(140,165,200,0.035) 1px, transparent 1px);
        background-size: 28px 28px;
        mask-image: radial-gradient(120% 90% at 50% 0%, #000 40%, transparent 100%);
      }
      .app button { -webkit-tap-highlight-color: transparent; }
    `}</style>
  );
}
