import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Sun,
  Moon,
  Cloud,
  CloudSun,
  CloudMoon,
  CloudRain,
  CloudDrizzle,
  CloudSnow,
  CloudLightning,
  CloudFog,
  CloudHail,
  Wind,
  Droplets,
  Thermometer,
  Navigation,
  RefreshCw,
  MapPin,
  WifiOff,
  AlertTriangle,
  Loader2,
} from "lucide-react";

/* ------------------------------------------------------------------ *
 * Model
 * ------------------------------------------------------------------ */

type Units = "c" | "f";
type IconName =
  | "sun"
  | "moon"
  | "cloud-sun"
  | "cloud-moon"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "hail"
  | "thunder";

/** A weather "kind" drives both the icon and the atmospheric gradient. */
type Sky =
  | "clear"
  | "partly"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

interface Conditions {
  /** Temperature in Celsius (canonical). */
  tempC: number;
  /** Apparent (feels-like) temperature in Celsius. */
  feelsC: number;
  humidity: number; // %
  windKmh: number;
  precip: number; // mm
  code: number; // WMO weather code
  isDay: boolean;
}

interface Snapshot {
  conditions: Conditions;
  lat: number;
  lng: number;
  place: string | null;
  fetchedAt: number; // epoch ms
}

const ICONS: Record<IconName, LucideIcon> = {
  sun: Sun,
  moon: Moon,
  "cloud-sun": CloudSun,
  "cloud-moon": CloudMoon,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  hail: CloudHail,
  thunder: CloudLightning,
};

const STORAGE_KEY = "weather-at-a-glance:v1";

const GEO_URL =
  "https://geocoding-api.open-meteo.com/v1/reverse";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

/* ------------------------------------------------------------------ *
 * WMO weather-code mapping → label, icon, sky.
 * Reference: WMO code table 4677 (as used by Open-Meteo).
 * ------------------------------------------------------------------ */

interface CodeInfo {
  label: string;
  sky: Sky;
}

function describeCode(code: number): CodeInfo {
  switch (code) {
    case 0:
      return { label: "Clear sky", sky: "clear" };
    case 1:
      return { label: "Mainly clear", sky: "partly" };
    case 2:
      return { label: "Partly cloudy", sky: "partly" };
    case 3:
      return { label: "Overcast", sky: "cloud" };
    case 45:
      return { label: "Fog", sky: "fog" };
    case 48:
      return { label: "Rime fog", sky: "fog" };
    case 51:
      return { label: "Light drizzle", sky: "drizzle" };
    case 53:
      return { label: "Drizzle", sky: "drizzle" };
    case 55:
      return { label: "Dense drizzle", sky: "drizzle" };
    case 56:
      return { label: "Freezing drizzle", sky: "drizzle" };
    case 57:
      return { label: "Freezing drizzle", sky: "drizzle" };
    case 61:
      return { label: "Light rain", sky: "rain" };
    case 63:
      return { label: "Rain", sky: "rain" };
    case 65:
      return { label: "Heavy rain", sky: "rain" };
    case 66:
      return { label: "Freezing rain", sky: "rain" };
    case 67:
      return { label: "Freezing rain", sky: "rain" };
    case 71:
      return { label: "Light snow", sky: "snow" };
    case 73:
      return { label: "Snow", sky: "snow" };
    case 75:
      return { label: "Heavy snow", sky: "snow" };
    case 77:
      return { label: "Snow grains", sky: "snow" };
    case 80:
      return { label: "Light showers", sky: "rain" };
    case 81:
      return { label: "Showers", sky: "rain" };
    case 82:
      return { label: "Violent showers", sky: "rain" };
    case 85:
      return { label: "Snow showers", sky: "snow" };
    case 86:
      return { label: "Heavy snow showers", sky: "snow" };
    case 95:
      return { label: "Thunderstorm", sky: "thunder" };
    case 96:
      return { label: "Thunderstorm, hail", sky: "thunder" };
    case 99:
      return { label: "Thunderstorm, heavy hail", sky: "thunder" };
    default:
      return { label: "Unknown", sky: "cloud" };
  }
}

/** Pick the lucide icon name for a sky + day/night. */
function iconFor(sky: Sky, isDay: boolean): IconName {
  switch (sky) {
    case "clear":
      return isDay ? "sun" : "moon";
    case "partly":
      return isDay ? "cloud-sun" : "cloud-moon";
    case "cloud":
      return "cloud";
    case "fog":
      return "fog";
    case "drizzle":
      return "drizzle";
    case "rain":
      return "rain";
    case "snow":
      return "snow";
    case "thunder":
      return "thunder";
    default:
      return "cloud";
  }
}

/* ------------------------------------------------------------------ *
 * Units + formatting
 * ------------------------------------------------------------------ */

function cToF(c: number): number {
  return c * (9 / 5) + 32;
}

function displayTemp(c: number, units: Units): number {
  return Math.round(units === "c" ? c : cToF(c));
}

function displayWind(kmh: number, units: Units): { value: number; unit: string } {
  // Pair the temperature unit with a sensible speed unit.
  if (units === "f") return { value: Math.round(kmh / 1.609344), unit: "mph" };
  return { value: Math.round(kmh), unit: "km/h" };
}

function relativeTime(from: number, now: number): string {
  const diff = Math.max(0, now - from);
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

/* ------------------------------------------------------------------ *
 * Atmospheric palette — gradient + accents per sky/day-night.
 * ------------------------------------------------------------------ */

interface Palette {
  /** Multi-stop CSS gradient string for the full-screen background. */
  bg: string;
  text: string;
  sub: string;
  /** Translucent surface for cards. */
  surface: string;
  border: string;
  /** A bright accent used for the icon halo / interactive bits. */
  accent: string;
  /** theme-color hint (solid). */
  solid: string;
}

function paletteFor(sky: Sky, isDay: boolean): Palette {
  const night: Palette = {
    bg: "radial-gradient(120% 90% at 50% -10%, #16204a 0%, #0b1530 45%, #060b1d 100%)",
    text: "#f4f6ff",
    sub: "#aab4d6",
    surface: "rgba(255,255,255,0.06)",
    border: "rgba(255,255,255,0.12)",
    accent: "#cbd6ff",
    solid: "#0b1530",
  };

  if (!isDay) {
    switch (sky) {
      case "rain":
      case "drizzle":
        return {
          ...night,
          bg: "radial-gradient(120% 90% at 50% -10%, #1b2740 0%, #0e1726 50%, #070c16 100%)",
          accent: "#8fb4ff",
          solid: "#0e1726",
        };
      case "snow":
        return {
          ...night,
          bg: "radial-gradient(120% 90% at 50% -10%, #28324f 0%, #161d33 50%, #0a0f1e 100%)",
          accent: "#dfe8ff",
          solid: "#161d33",
        };
      case "thunder":
        return {
          ...night,
          bg: "radial-gradient(120% 90% at 50% -10%, #2a2350 0%, #140f2c 50%, #08060f 100%)",
          accent: "#c4a8ff",
          solid: "#140f2c",
        };
      case "fog":
        return {
          ...night,
          bg: "radial-gradient(120% 90% at 50% -10%, #2b3348 0%, #1a2030 50%, #0d111a 100%)",
          accent: "#c2cbe0",
          solid: "#1a2030",
        };
      default:
        return night;
    }
  }

  // Daytime palettes.
  switch (sky) {
    case "clear":
      return {
        bg: "radial-gradient(120% 95% at 50% -5%, #6fc3ff 0%, #3d8bff 45%, #2563d6 100%)",
        text: "#ffffff",
        sub: "rgba(255,255,255,0.82)",
        surface: "rgba(255,255,255,0.16)",
        border: "rgba(255,255,255,0.28)",
        accent: "#fff4c2",
        solid: "#3d8bff",
      };
    case "partly":
      return {
        bg: "radial-gradient(120% 95% at 50% -5%, #9ad0ff 0%, #5ea0ee 50%, #4a7fcf 100%)",
        text: "#ffffff",
        sub: "rgba(255,255,255,0.82)",
        surface: "rgba(255,255,255,0.18)",
        border: "rgba(255,255,255,0.30)",
        accent: "#fff0bf",
        solid: "#5ea0ee",
      };
    case "cloud":
      return {
        bg: "radial-gradient(120% 95% at 50% -5%, #aebccf 0%, #8493a8 50%, #6b7889 100%)",
        text: "#ffffff",
        sub: "rgba(255,255,255,0.85)",
        surface: "rgba(255,255,255,0.18)",
        border: "rgba(255,255,255,0.30)",
        accent: "#ffffff",
        solid: "#8493a8",
      };
    case "fog":
      return {
        bg: "radial-gradient(120% 95% at 50% -5%, #cdd3da 0%, #a7aeb8 50%, #8c939e 100%)",
        text: "#222831",
        sub: "rgba(34,40,49,0.72)",
        surface: "rgba(255,255,255,0.42)",
        border: "rgba(34,40,49,0.16)",
        accent: "#ffffff",
        solid: "#a7aeb8",
      };
    case "drizzle":
    case "rain":
      return {
        bg: "radial-gradient(120% 95% at 50% -5%, #6d8aa8 0%, #4a647f 50%, #36495f 100%)",
        text: "#ffffff",
        sub: "rgba(255,255,255,0.84)",
        surface: "rgba(255,255,255,0.14)",
        border: "rgba(255,255,255,0.26)",
        accent: "#bcd6ff",
        solid: "#4a647f",
      };
    case "snow":
      return {
        bg: "radial-gradient(120% 95% at 50% -5%, #e6eef7 0%, #c2d2e6 50%, #9fb4cf 100%)",
        text: "#1e2733",
        sub: "rgba(30,39,51,0.70)",
        surface: "rgba(255,255,255,0.55)",
        border: "rgba(30,39,51,0.14)",
        accent: "#ffffff",
        solid: "#c2d2e6",
      };
    case "thunder":
      return {
        bg: "radial-gradient(120% 95% at 50% -5%, #5b5f8a 0%, #3c3d66 50%, #292a47 100%)",
        text: "#ffffff",
        sub: "rgba(255,255,255,0.82)",
        surface: "rgba(255,255,255,0.14)",
        border: "rgba(255,255,255,0.26)",
        accent: "#e6c8ff",
        solid: "#3c3d66",
      };
    default:
      return {
        bg: "radial-gradient(120% 95% at 50% -5%, #9ad0ff 0%, #5ea0ee 50%, #4a7fcf 100%)",
        text: "#ffffff",
        sub: "rgba(255,255,255,0.82)",
        surface: "rgba(255,255,255,0.18)",
        border: "rgba(255,255,255,0.30)",
        accent: "#fff0bf",
        solid: "#5ea0ee",
      };
  }
}

/* ------------------------------------------------------------------ *
 * Networking (runtime fetch — keyless, CORS-enabled Open-Meteo).
 * ------------------------------------------------------------------ */

interface ForecastResponse {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    is_day?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
}

async function fetchConditions(lat: number, lng: number): Promise<Conditions> {
  const url =
    `${FORECAST_URL}?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m` +
    `&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const data = (await res.json()) as ForecastResponse;
  const c = data.current;
  if (!c || typeof c.temperature_2m !== "number") {
    throw new Error("malformed forecast");
  }
  return {
    tempC: c.temperature_2m,
    feelsC: typeof c.apparent_temperature === "number" ? c.apparent_temperature : c.temperature_2m,
    humidity: typeof c.relative_humidity_2m === "number" ? c.relative_humidity_2m : 0,
    windKmh: typeof c.wind_speed_10m === "number" ? c.wind_speed_10m : 0,
    precip: typeof c.precipitation === "number" ? c.precipitation : 0,
    code: typeof c.weather_code === "number" ? c.weather_code : 0,
    isDay: c.is_day !== 0,
  };
}

interface GeoResponse {
  results?: Array<{ name?: string; admin1?: string; country_code?: string }>;
}

async function resolvePlace(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `${GEO_URL}?latitude=${lat}&longitude=${lng}&count=1&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as GeoResponse;
    const r = data.results && data.results[0];
    if (!r || !r.name) return null;
    return r.admin1 && r.admin1 !== r.name ? `${r.name}, ${r.admin1}` : r.name;
  } catch {
    return null;
  }
}

function getPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("no-geolocation"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
    );
  });
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

interface Persisted {
  snapshot: Snapshot | null;
  units: Units;
}

function loadPersisted(): Partial<Persisted> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Persisted>;
  } catch {
    return {};
  }
}

function savePersisted(p: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/* ------------------------------------------------------------------ *
 * Scoped styles — self-contained theming + motion.
 * ------------------------------------------------------------------ */

const STYLES = `
.wag {
  --font-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
  padding:
    env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left);
  transition: background .8s ease, color .5s ease;
}
.wag-temp {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  font-weight: 200;
  letter-spacing: -0.04em;
  line-height: 0.9;
}
.wag-halo {
  filter: drop-shadow(0 8px 28px var(--halo));
}
@keyframes wag-rise { from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none } }
.wag-rise { animation: wag-rise .55s cubic-bezier(.2,.7,.2,1) both; }
@keyframes wag-spin { to { transform: rotate(360deg) } }
.wag-spin { animation: wag-spin 1s linear infinite; }
@keyframes wag-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
.wag-float { animation: wag-float 5s ease-in-out infinite; }
.wag-card { backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
@media (prefers-reduced-motion: reduce) {
  .wag, .wag-rise, .wag-spin, .wag-float { transition: none; animation: none; }
}
`;

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

type Status = "idle" | "locating" | "loading" | "ready" | "offline" | "error";

export default function App() {
  const saved = useRef<Partial<Persisted>>(loadPersisted());

  const [units, setUnits] = useState<Units>(saved.current.units ?? "c");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(saved.current.snapshot ?? null);
  const [status, setStatus] = useState<Status>(saved.current.snapshot ? "offline" : "idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [now, setNow] = useState<number>(() => Date.now());
  const didInit = useRef(false);

  const geoSupported = useMemo(
    () => typeof navigator !== "undefined" && !!navigator.geolocation,
    []
  );

  /* Persist units + last snapshot. */
  useEffect(() => {
    savePersisted({ snapshot, units });
  }, [snapshot, units]);

  /* Keep "last updated" labels fresh. */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    setErrorMsg("");

    // Offline up front: fall back to cache if we have one.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setStatus(snapshot ? "offline" : "error");
      if (!snapshot) setErrorMsg("You're offline and there's no saved reading yet.");
      return;
    }

    if (!geoSupported) {
      setStatus(snapshot ? "offline" : "error");
      if (!snapshot) setErrorMsg("Location isn't available on this device.");
      return;
    }

    setStatus("locating");
    let lat: number;
    let lng: number;
    try {
      const pos = await getPosition();
      lat = pos.lat;
      lng = pos.lng;
    } catch {
      // Geolocation denied/failed → show cached reading if we have one.
      setStatus(snapshot ? "offline" : "error");
      if (!snapshot) setErrorMsg("Couldn't get your location. Allow location access and try again.");
      return;
    }

    setStatus("loading");
    try {
      const [conditions, place] = await Promise.all([
        fetchConditions(lat, lng),
        resolvePlace(lat, lng),
      ]);
      const snap: Snapshot = { conditions, lat, lng, place, fetchedAt: Date.now() };
      setSnapshot(snap);
      setStatus("ready");
      setNow(Date.now());
    } catch {
      // Network/fetch failed → cached fallback.
      setStatus(snapshot ? "offline" : "error");
      if (!snapshot) setErrorMsg("Couldn't reach the weather service. Check your connection.");
    }
  }, [geoSupported, snapshot]);

  /* Auto-load on first mount (guarded against StrictMode double-invoke). */
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Re-fetch when connectivity returns. */
  useEffect(() => {
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refresh]);

  const c = snapshot?.conditions;
  const info = c ? describeCode(c.code) : null;
  const sky: Sky = info ? info.sky : "partly";
  const isDay = c ? c.isDay : true;
  const palette = paletteFor(sky, isDay);
  const Icon = ICONS[iconFor(sky, isDay)];

  const busy = status === "locating" || status === "loading";
  const showOfflineBanner = status === "offline" && !!snapshot;

  const wind = c ? displayWind(c.windKmh, units) : null;

  return (
    <div
      className="wag relative flex h-[100dvh] w-full flex-col overflow-hidden"
      style={{
        background: palette.bg,
        color: palette.text,
        ["--halo" as string]: palette.accent + "66",
      } as CSSProperties}
    >
      <style>{STYLES}</style>

      {/* Top bar */}
      <header className="relative z-10 flex items-center gap-2 px-5 pt-5">
        <div className="flex min-w-0 items-center gap-1.5">
          <MapPin className="h-4 w-4 shrink-0" style={{ color: palette.sub }} />
          <span className="truncate text-sm font-medium" style={{ color: palette.text }}>
            {snapshot?.place
              ? snapshot.place
              : snapshot
                ? `${snapshot.lat.toFixed(2)}°, ${snapshot.lng.toFixed(2)}°`
                : "Your location"}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Units toggle */}
          <div
            className="flex items-center rounded-full p-0.5 text-xs font-semibold wag-card"
            style={{ background: palette.surface, border: `1px solid ${palette.border}` }}
            role="group"
            aria-label="Temperature units"
          >
            <button
              onClick={() => setUnits("c")}
              aria-pressed={units === "c"}
              aria-label="Celsius"
              className="rounded-full px-2.5 py-1 transition-colors"
              style={
                units === "c"
                  ? { background: palette.text, color: palette.solid }
                  : { color: palette.sub }
              }
            >
              °C
            </button>
            <button
              onClick={() => setUnits("f")}
              aria-pressed={units === "f"}
              aria-label="Fahrenheit"
              className="rounded-full px-2.5 py-1 transition-colors"
              style={
                units === "f"
                  ? { background: palette.text, color: palette.solid }
                  : { color: palette.sub }
              }
            >
              °F
            </button>
          </div>

          <button
            onClick={() => void refresh()}
            disabled={busy}
            aria-label="Refresh"
            title="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-60 wag-card"
            style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.text }}
          >
            <RefreshCw className={`h-[18px] w-[18px] ${busy ? "wag-spin" : ""}`} />
          </button>
        </div>
      </header>

      {/* Offline banner */}
      {showOfflineBanner && snapshot && (
        <div
          role="status"
          className="relative z-10 mx-5 mt-3 flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-[13px] wag-card"
          style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.text }}
        >
          <WifiOff className="h-4 w-4 shrink-0" style={{ color: palette.accent }} />
          <span>
            Offline — last updated {relativeTime(snapshot.fetchedAt, now)}
          </span>
        </div>
      )}

      {/* Body */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        {!snapshot && busy && (
          <div className="flex flex-col items-center gap-3" style={{ color: palette.sub }}>
            <Loader2 className="h-9 w-9 wag-spin" />
            <p className="text-sm">
              {status === "locating" ? "Finding your location…" : "Loading conditions…"}
            </p>
          </div>
        )}

        {!snapshot && status === "error" && (
          <div className="flex max-w-xs flex-col items-center gap-3">
            <AlertTriangle className="h-9 w-9" style={{ color: palette.accent }} />
            <p className="text-sm" style={{ color: palette.sub }}>
              {errorMsg || "Couldn't load the weather."}
            </p>
            <button
              onClick={() => void refresh()}
              className="mt-1 rounded-full px-4 py-2 text-sm font-semibold wag-card"
              style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.text }}
            >
              Try again
            </button>
          </div>
        )}

        {snapshot && c && info && (
          <div key={`${sky}-${isDay}`} className="wag-rise flex w-full max-w-md flex-col items-center">
            <div className="wag-halo wag-float mb-1" aria-hidden="true">
              <Icon className="h-24 w-24" strokeWidth={1.25} />
            </div>

            <div className="flex items-start">
              <span
                className="wag-temp text-[clamp(5rem,30vw,8.5rem)]"
                aria-label={`Temperature ${displayTemp(c.tempC, units)} degrees ${units === "c" ? "Celsius" : "Fahrenheit"}`}
              >
                {displayTemp(c.tempC, units)}
              </span>
              <span className="wag-temp mt-2 text-3xl font-light" aria-hidden="true">
                °{units === "c" ? "C" : "F"}
              </span>
            </div>

            <p className="mt-1 text-lg font-medium" style={{ color: palette.text }}>
              {info.label}
            </p>
            <p className="text-sm" style={{ color: palette.sub }}>
              Feels like {displayTemp(c.feelsC, units)}°{units === "c" ? "C" : "F"}
            </p>

            {/* Metrics */}
            <div className="mt-8 grid w-full grid-cols-3 gap-2.5">
              <Metric
                palette={palette}
                icon={<Droplets className="h-4 w-4" />}
                label="Humidity"
                value={`${Math.round(c.humidity)}%`}
              />
              <Metric
                palette={palette}
                icon={<Wind className="h-4 w-4" />}
                label="Wind"
                value={wind ? `${wind.value} ${wind.unit}` : "—"}
              />
              <Metric
                palette={palette}
                icon={<Thermometer className="h-4 w-4" />}
                label="Feels"
                value={`${displayTemp(c.feelsC, units)}°`}
              />
            </div>

            {c.precip > 0 && (
              <p className="mt-4 text-xs" style={{ color: palette.sub }}>
                {c.precip.toFixed(1)} mm precipitation
              </p>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 flex items-center justify-center gap-2 px-6 pb-6 text-[11px]" style={{ color: palette.sub }}>
        {snapshot ? (
          <span className="flex items-center gap-1.5">
            <Navigation className="h-3 w-3" />
            Updated {relativeTime(snapshot.fetchedAt, now)} · Open-Meteo
          </span>
        ) : (
          <span>Powered by Open-Meteo</span>
        )}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Subcomponents
 * ------------------------------------------------------------------ */

function Metric({
  palette,
  icon,
  label,
  value,
}: {
  palette: Palette;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      className="flex flex-col items-center gap-1 rounded-2xl px-2 py-3 wag-card"
      style={{ background: palette.surface, border: `1px solid ${palette.border}` }}
    >
      <span style={{ color: palette.accent }}>{icon}</span>
      <span className="text-base font-semibold tabular-nums" style={{ color: palette.text }}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: palette.sub }}>
        {label}
      </span>
    </div>
  );
}
