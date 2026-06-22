import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ScanLine,
  Zap,
  ZapOff,
  SwitchCamera,
  History as HistoryIcon,
  X,
  Copy,
  Check,
  ExternalLink,
  Trash2,
  CameraOff,
  ShieldAlert,
  QrCode,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Types & native-API shims (BarcodeDetector isn't in lib.dom yet)
 * ------------------------------------------------------------------ */

interface DetectedBarcode {
  rawValue: string;
  format: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
}

interface Entry {
  id: string;
  value: string;
  format: string;
  ts: number;
}

type CamState = "idle" | "starting" | "live" | "denied" | "error" | "unsupported";

const STORAGE_KEY = "qr-scanner:history:v1";
const DEDUPE_MS = 2500;
const HISTORY_CAP = 250;

const FORMAT_LABEL: Record<string, string> = {
  qr_code: "QR",
  ean_13: "EAN-13",
  ean_8: "EAN-8",
  upc_a: "UPC-A",
  upc_e: "UPC-E",
  code_128: "Code 128",
  code_39: "Code 39",
  code_93: "Code 93",
  codabar: "Codabar",
  itf: "ITF",
  data_matrix: "Data Matrix",
  aztec: "Aztec",
  pdf417: "PDF417",
  unknown: "Code",
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function genId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fmtLabel(f: string): string {
  return FORMAT_LABEL[f] ?? f.replace(/_/g, " ").toUpperCase();
}

function isUrl(v: string): boolean {
  return /^https?:\/\/\S+$/i.test(v.trim());
}

function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getDetectorCtor(): BarcodeDetectorCtor | undefined {
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

function hasCamera(): boolean {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

function loadHistory(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Entry[]) : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * Scoped styles
 * ------------------------------------------------------------------ */

const STYLES = `
.qr {
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  --bg: #0a0b0d;
  --surface: #14161a;
  --surface-2: #1d2026;
  --text: #f4f6f8;
  --muted: #99a1ad;
  --faint: #5b6473;
  --border: #262b33;
  --accent: #a3e635;
  font-family: var(--font-ui);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  padding:
    env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left);
}
.mono { font-family: var(--font-mono); }

.scrim-top { background: linear-gradient(to bottom, rgba(0,0,0,.7), transparent); }
.scrim-bottom { background: linear-gradient(to top, rgba(0,0,0,.78), transparent); }

/* Dim everything outside the scan frame. */
.scan-dim { box-shadow: 0 0 0 9999px rgba(0,0,0,.55); }

.scan-line {
  background: linear-gradient(to right, transparent, var(--accent), transparent);
  box-shadow: 0 0 12px 2px var(--accent);
  animation: sweep 2.4s cubic-bezier(.5,0,.5,1) infinite;
}
@keyframes sweep {
  0%   { top: 4%;  opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  100% { top: 96%; opacity: 0; }
}

.live-dot { animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

.btn { transition: transform .08s ease, background .15s ease, color .15s ease; }
.btn:active { transform: scale(.93); }

.flash { animation: flash .4s ease; }
@keyframes flash { 0% { border-color: var(--accent); box-shadow: 0 0 0 9999px rgba(163,230,53,.12), 0 0 0 9999px rgba(0,0,0,.45); } 100% {} }

.sheet { animation: slideUp .28s cubic-bezier(.2,.8,.2,1) both; }
.sheet-bg { animation: fade .2s ease both; }
.card { animation: cardUp .28s cubic-bezier(.2,.8,.2,1) both; }
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes slideUp { from { transform: translateY(100%) } to { transform: none } }
@keyframes cardUp { from { transform: translateY(20px); opacity: 0 } to { transform: none; opacity: 1 } }

@media (prefers-reduced-motion: reduce) {
  .scan-line, .live-dot, .flash, .sheet, .sheet-bg, .card { animation: none; }
}
`;

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

export default function App() {
  const [camState, setCamState] = useState<CamState>("idle");
  const [history, setHistory] = useState<Entry[]>(() => loadHistory());
  const [result, setResult] = useState<Entry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [flashTick, setFlashTick] = useState(0);
  const [restartTick, setRestartTick] = useState(0);

  const supportCamera = useMemo(hasCamera, []);
  const detectorSupported = useMemo(() => Boolean(getDetectorCtor()), []);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const lastValueRef = useRef<string>("");
  const lastTimeRef = useRef<number>(0);

  const now = Date.now();

  /* Persist history. */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [history]);

  /* Build the detector once. */
  useEffect(() => {
    const Ctor = getDetectorCtor();
    if (!Ctor) return;
    try {
      detectorRef.current = new Ctor();
    } catch {
      detectorRef.current = null;
    }
  }, []);

  const handleDetected = useCallback((code: DetectedBarcode) => {
    const value = code.rawValue?.trim();
    if (!value) return;
    const t = Date.now();
    if (value === lastValueRef.current && t - lastTimeRef.current < DEDUPE_MS) return;
    lastValueRef.current = value;
    lastTimeRef.current = t;

    const entry: Entry = { id: genId(), value, format: code.format || "unknown", ts: t };
    setResult(entry);
    setFlashTick((n) => n + 1);
    setHistory((prev) => (prev[0]?.value === value ? prev : [entry, ...prev].slice(0, HISTORY_CAP)));

    try {
      (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(40);
    } catch {
      /* no haptics — fine */
    }
  }, []);

  /* Camera lifecycle + detection loop, restarted on camera switch. */
  useEffect(() => {
    if (!supportCamera) {
      setCamState("unsupported");
      return;
    }
    let cancelled = false;
    let loopTimer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      const v = videoRef.current;
      const d = detectorRef.current;
      if (!cancelled && v && d && v.readyState >= 2) {
        try {
          const codes = await d.detect(v);
          if (!cancelled && codes.length > 0) handleDetected(codes[0]);
        } catch {
          /* transient detect error — keep looping */
        }
      }
      if (!cancelled) loopTimer = setTimeout(loop, 250);
    };

    const start = async () => {
      setCamState("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorchAvailable(Boolean(caps.torch));
        setTorchOn(false);
        setCamState("live");
        if (detectorRef.current) loop();
      } catch (e) {
        const name = (e as DOMException)?.name;
        setCamState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (loopTimer) clearTimeout(loopTimer);
      const s = streamRef.current;
      if (s) s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
  }, [facingMode, supportCamera, handleDetected, restartTick]);

  const retry = useCallback(() => setRestartTick((n) => n + 1), []);

  const flip = useCallback(() => {
    setFacingMode((m) => (m === "environment" ? "user" : "environment"));
  }, []);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await (
        track as MediaStreamTrack & {
          applyConstraints: (c: { advanced: { torch: boolean }[] }) => Promise<void>;
        }
      ).applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch {
      /* torch not controllable — ignore */
    }
  }, [torchOn]);

  const copy = useCallback((entry: Entry) => {
    try {
      void navigator.clipboard?.writeText(entry.value);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((c) => (c === entry.id ? null : c)), 1400);
    } catch {
      /* clipboard blocked — ignore */
    }
  }, []);

  const openLink = useCallback((entry: Entry) => {
    try {
      window.open(entry.value, "_blank", "noopener,noreferrer");
    } catch {
      /* popup blocked — ignore */
    }
  }, []);

  const remove = useCallback((id: string) => {
    setHistory((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearAll = useCallback(() => setHistory([]), []);

  return (
    <div className="qr relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--bg)]">
      <style>{STYLES}</style>

      {/* Camera feed (kept mounted so the ref is stable). */}
      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full object-cover ${camState === "live" ? "opacity-100" : "opacity-0"}`}
        muted
        playsInline
        autoPlay
      />

      {/* Non-live backdrops */}
      {camState !== "live" && (
        <div className="absolute inset-0 bg-[radial-gradient(80%_60%_at_50%_30%,#16181d,transparent)]" />
      )}

      {/* Viewfinder overlay */}
      {camState === "live" && (
        <div className="absolute inset-0 z-[1] flex items-center justify-center">
          <div
            key={flashTick}
            className="scan-dim flash relative aspect-square w-[min(72vw,330px)] rounded-[28px] border-2 border-[var(--accent)]/70"
          >
            {/* corner brackets */}
            <Corner className="left-[-2px] top-[-2px] border-l-[3px] border-t-[3px] rounded-tl-[28px]" />
            <Corner className="right-[-2px] top-[-2px] border-r-[3px] border-t-[3px] rounded-tr-[28px]" />
            <Corner className="bottom-[-2px] left-[-2px] border-b-[3px] border-l-[3px] rounded-bl-[28px]" />
            <Corner className="bottom-[-2px] right-[-2px] border-b-[3px] border-r-[3px] rounded-br-[28px]" />
            {detectorSupported && (
              <span className="scan-line absolute left-[6%] right-[6%] h-[2px] rounded-full" />
            )}
          </div>
        </div>
      )}

      {/* Detection-unsupported banner over a working camera */}
      {camState === "live" && !detectorSupported && (
        <div className="absolute left-1/2 top-[18%] z-[2] -translate-x-1/2 rounded-full border border-[var(--border)] bg-black/70 px-4 py-2 text-center text-xs text-[var(--muted)]">
          Barcode detection isn’t supported in this browser
        </div>
      )}

      {/* Top bar */}
      <header className="scrim-top relative z-10 flex items-center gap-2 px-4 pb-6 pt-4">
        <div className="flex items-center gap-2">
          <ScanLine className="h-5 w-5 text-[var(--accent)]" />
          <span className="text-[15px] font-semibold tracking-tight">Scanner</span>
          {camState === "live" && (
            <span className="ml-1 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              scanning
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {camState === "live" && torchAvailable && (
            <IconBtn label="Toggle flashlight" onClick={toggleTorch} active={torchOn}>
              {torchOn ? <Zap className="h-[18px] w-[18px]" /> : <ZapOff className="h-[18px] w-[18px]" />}
            </IconBtn>
          )}
          {camState === "live" && (
            <IconBtn label="Switch camera" onClick={flip}>
              <SwitchCamera className="h-[18px] w-[18px]" />
            </IconBtn>
          )}
          <IconBtn label="History" onClick={() => setSheetOpen(true)}>
            <span className="relative">
              <HistoryIcon className="h-[18px] w-[18px]" />
              {history.length > 0 && (
                <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-black">
                  {history.length > 99 ? "99+" : history.length}
                </span>
              )}
            </span>
          </IconBtn>
        </div>
      </header>

      {/* Center messaging for non-live states */}
      {camState !== "live" && (
        <div className="relative z-10 flex flex-1 items-center justify-center px-8">
          <CamMessage
            state={camState}
            detectorSupported={detectorSupported}
            onRetry={retry}
          />
        </div>
      )}

      <div className="flex-1" />

      {/* Bottom: latest result card or hint */}
      <div className="scrim-bottom relative z-10 px-4 pb-6 pt-10">
        {result ? (
          <div className="card mx-auto w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-4 backdrop-blur">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-md bg-[var(--accent)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                {fmtLabel(result.format)}
              </span>
              <span className="text-[11px] text-[var(--faint)]">just scanned</span>
              <button
                onClick={() => setResult(null)}
                aria-label="Dismiss result"
                className="btn ml-auto flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mono mb-3 max-h-24 overflow-y-auto break-all text-sm text-[var(--text)]">
              {result.value}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => copy(result)}
                className="btn flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--surface-2)] py-2.5 text-sm font-medium"
              >
                {copiedId === result.id ? <Check className="h-4 w-4 text-[var(--accent)]" /> : <Copy className="h-4 w-4" />}
                {copiedId === result.id ? "Copied" : "Copy"}
              </button>
              {isUrl(result.value) && (
                <button
                  onClick={() => openLink(result)}
                  className="btn flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] py-2.5 text-sm font-semibold text-black"
                >
                  <ExternalLink className="h-4 w-4" /> Open
                </button>
              )}
            </div>
          </div>
        ) : (
          camState === "live" && (
            <p className="text-center text-[13px] text-[var(--muted)]">
              Point at a QR code or barcode
            </p>
          )
        )}
      </div>

      {/* History sheet */}
      {sheetOpen && (
        <div className="absolute inset-0 z-30 flex items-end justify-center">
          <button
            aria-label="Close history"
            className="sheet-bg absolute inset-0 bg-black/60"
            onClick={() => setSheetOpen(false)}
          />
          <div className="sheet relative flex max-h-[80%] w-full max-w-md flex-col rounded-t-3xl border border-[var(--border)] bg-[var(--surface)] pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-[var(--border)]" />
            <div className="flex items-center px-5 py-3">
              <h2 className="text-base font-semibold">History</h2>
              <span className="ml-2 text-xs text-[var(--faint)]">{history.length}</span>
              {history.length > 0 && (
                <button
                  onClick={clearAll}
                  aria-label="Clear history"
                  className="btn ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--surface-2)]"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3">
              {history.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-[var(--faint)]">
                  <QrCode className="h-8 w-8" />
                  <p className="text-sm">No scans yet</p>
                </div>
              ) : (
                history.map((e) => (
                  <div
                    key={e.id}
                    className="mb-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                        {fmtLabel(e.format)}
                      </span>
                      <span className="text-[10.5px] text-[var(--faint)]">{relTime(e.ts, now)}</span>
                      <div className="ml-auto flex items-center gap-0.5">
                        <button
                          onClick={() => copy(e)}
                          aria-label="Copy"
                          className="btn flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface)]"
                        >
                          {copiedId === e.id ? <Check className="h-3.5 w-3.5 text-[var(--accent)]" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                        {isUrl(e.value) && (
                          <button
                            onClick={() => openLink(e)}
                            aria-label="Open link"
                            className="btn flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface)]"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => remove(e.id)}
                          aria-label="Delete"
                          className="btn flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface)] hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mono mt-1.5 truncate text-[13px] text-[var(--text)]">{e.value}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Subcomponents
 * ------------------------------------------------------------------ */

function Corner({ className }: { className: string }) {
  return (
    <span
      className={`absolute h-6 w-6 border-[var(--accent)] ${className}`}
      aria-hidden="true"
    />
  );
}

function IconBtn({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`btn flex h-10 w-10 items-center justify-center rounded-full ${
        active ? "bg-[var(--accent)] text-black" : "bg-black/40 text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

function CamMessage({
  state,
  detectorSupported,
  onRetry,
}: {
  state: CamState;
  detectorSupported: boolean;
  onRetry: () => void;
}) {
  if (state === "starting" || state === "idle") {
    return (
      <div className="flex flex-col items-center gap-3 text-center text-[var(--muted)]">
        <ScanLine className="h-8 w-8 animate-pulse text-[var(--accent)]" />
        <p className="text-sm">Starting camera…</p>
      </div>
    );
  }

  const config =
    state === "denied"
      ? {
          icon: <ShieldAlert className="h-9 w-9 text-[var(--accent)]" />,
          title: "Camera access needed",
          body: "Allow camera permission to scan codes, then try again.",
        }
      : state === "unsupported"
        ? {
            icon: <CameraOff className="h-9 w-9 text-[var(--accent)]" />,
            title: "Camera unavailable",
            body: "This device or browser doesn’t support camera access.",
          }
        : {
            icon: <CameraOff className="h-9 w-9 text-[var(--accent)]" />,
            title: "Couldn’t start the camera",
            body: "Another app may be using it. Close it and try again.",
          };

  return (
    <div className="flex max-w-xs flex-col items-center gap-3 text-center">
      {config.icon}
      <h2 className="text-lg font-semibold text-[var(--text)]">{config.title}</h2>
      <p className="text-sm text-[var(--muted)]">{config.body}</p>
      {!detectorSupported && state !== "unsupported" && (
        <p className="text-xs text-[var(--faint)]">
          Note: barcode detection isn’t supported in this browser.
        </p>
      )}
      {state !== "unsupported" && (
        <button
          onClick={onRetry}
          className="btn mt-1 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-black"
        >
          Try again
        </button>
      )}
    </div>
  );
}
