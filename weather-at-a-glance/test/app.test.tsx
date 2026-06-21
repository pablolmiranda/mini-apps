import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../src/weather-at-a-glance";

const STORAGE_KEY = "weather-at-a-glance:v1";

/* A fully-formed Open-Meteo current-conditions object (Celsius). */
function currentPayload(over: Partial<Record<string, number>> = {}) {
  return {
    current: {
      temperature_2m: 21,
      relative_humidity_2m: 55,
      apparent_temperature: 19,
      is_day: 1,
      precipitation: 0,
      weather_code: 0,
      wind_speed_10m: 12,
      ...over,
    },
  };
}

/** Seed a cached snapshot directly in localStorage (simulates a prior session). */
function seedCache(opts: {
  code?: number;
  isDay?: boolean;
  tempC?: number;
  feelsC?: number;
  humidity?: number;
  windKmh?: number;
  place?: string | null;
  fetchedAt?: number;
  units?: "c" | "f";
}) {
  const snapshot = {
    conditions: {
      tempC: opts.tempC ?? 20,
      feelsC: opts.feelsC ?? 18,
      humidity: opts.humidity ?? 60,
      windKmh: opts.windKmh ?? 10,
      precip: 0,
      code: opts.code ?? 0,
      isDay: opts.isDay ?? true,
    },
    lat: 51.51,
    lng: -0.13,
    place: opts.place ?? "London, England",
    fetchedAt: opts.fetchedAt ?? Date.now() - 2 * 60 * 60 * 1000,
  };
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ snapshot, units: opts.units ?? "c" })
  );
}

/** Install a geolocation mock that resolves with a fixed position. */
function mockGeolocation(ok = true) {
  const geolocation = {
    getCurrentPosition: vi.fn(
      (success: PositionCallback, error?: PositionErrorCallback) => {
        if (ok) {
          success({
            coords: {
              latitude: 51.51,
              longitude: -0.13,
              accuracy: 10,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        } else if (error) {
          error({ code: 1, message: "denied" } as GeolocationPositionError);
        }
      }
    ),
  };
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: geolocation,
  });
  return geolocation;
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
  // Default fetch returns clear-sky daytime conditions; reverse-geocode 2nd.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/v1/forecast")) {
        return { ok: true, json: async () => currentPayload() } as Response;
      }
      // geocoding reverse lookup
      return {
        ok: true,
        json: async () => ({ results: [{ name: "London", admin1: "England" }] }),
      } as Response;
    })
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WMO code → label/icon mapping (via rendered cache)", () => {
  it("renders clear-sky day with a sun and 'Clear sky'", async () => {
    seedCache({ code: 0, isDay: true });
    render(<App />);
    expect(await screen.findByText("Clear sky")).toBeTruthy();
    // lucide Sun icon carries class lucide-sun
    expect(document.querySelector(".lucide-sun")).toBeTruthy();
  });

  it("renders clear-sky night with a moon", async () => {
    seedCache({ code: 0, isDay: false });
    setOnline(false); // stay on cache, no network
    render(<App />);
    expect(await screen.findByText("Clear sky")).toBeTruthy();
    expect(document.querySelector(".lucide-moon")).toBeTruthy();
  });

  it("maps rain codes to 'Rain' with a rain-cloud icon", async () => {
    seedCache({ code: 63, isDay: true });
    setOnline(false);
    render(<App />);
    expect(await screen.findByText("Rain")).toBeTruthy();
    expect(document.querySelector(".lucide-cloud-rain")).toBeTruthy();
  });

  it("maps snow codes to a snow label/icon and thunder to thunderstorm", async () => {
    seedCache({ code: 75, isDay: true });
    setOnline(false);
    const a = render(<App />);
    expect(await screen.findByText("Heavy snow")).toBeTruthy();
    expect(document.querySelector(".lucide-cloud-snow")).toBeTruthy();
    a.unmount();
    cleanup();

    localStorage.clear();
    seedCache({ code: 95, isDay: true });
    setOnline(false);
    render(<App />);
    expect(await screen.findByText("Thunderstorm")).toBeTruthy();
    expect(document.querySelector(".lucide-cloud-lightning")).toBeTruthy();
  });

  it("maps fog code 45 to a fog icon", async () => {
    seedCache({ code: 45, isDay: true });
    setOnline(false);
    render(<App />);
    expect(await screen.findByText("Fog")).toBeTruthy();
    expect(document.querySelector(".lucide-cloud-fog")).toBeTruthy();
  });
});

describe("cache write on success, then offline fallback", () => {
  it("fetches on mount, writes a snapshot to localStorage", async () => {
    mockGeolocation(true);
    render(<App />);

    expect(await screen.findByText("Clear sky")).toBeTruthy();
    // 21°C from the mocked payload
    expect(screen.getByText("21")).toBeTruthy();

    await waitFor(() => {
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw as string);
      expect(parsed.snapshot.conditions.tempC).toBe(21);
      expect(parsed.snapshot.conditions.code).toBe(0);
      expect(parsed.snapshot.place).toBe("London, England");
    });
  });

  it("falls back to the cached reading and shows the Offline banner when offline", async () => {
    // Seed a known cache, then simulate offline so no network is attempted.
    seedCache({ code: 2, isDay: true, tempC: 14, fetchedAt: Date.now() - 3 * 60 * 1000 });
    setOnline(false);

    render(<App />);

    expect(await screen.findByText("Partly cloudy")).toBeTruthy();
    expect(screen.getByText("14")).toBeTruthy();
    // Offline banner with relative time (banner has role="status")
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/Offline — last updated/);
    expect(banner.textContent).toMatch(/3 min ago/);
  });

  it("falls back to cache when the network fetch rejects", async () => {
    seedCache({ code: 3, isDay: true, tempC: 9 });
    // online, geolocation OK, but fetch rejects → cached fallback + banner
    mockGeolocation(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    render(<App />);

    expect(await screen.findByText(/Offline — last updated/)).toBeTruthy();
    expect(screen.getByText("Overcast")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
  });

  it("falls back to cache when geolocation is denied", async () => {
    seedCache({ code: 0, isDay: true, tempC: 25 });
    mockGeolocation(false); // error callback fires
    render(<App />);
    expect(await screen.findByText(/Offline — last updated/)).toBeTruthy();
    expect(screen.getByText("25")).toBeTruthy();
  });
});

describe("°C / °F conversion + toggle", () => {
  it("converts a cached Celsius reading to Fahrenheit and persists the choice", async () => {
    // 20°C → 68°F, feels 18°C → 64°F; wind 16 km/h → 10 mph
    seedCache({ code: 0, isDay: true, tempC: 20, feelsC: 18, windKmh: 16, units: "c" });
    setOnline(false);

    const view = render(<App />);
    expect(await screen.findByText("Clear sky")).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy(); // °C

    fireEvent.click(screen.getByLabelText("Fahrenheit"));
    expect(screen.getByText("68")).toBeTruthy(); // 20°C → 68°F
    // wind unit switches to mph
    expect(screen.getByText(/10 mph/)).toBeTruthy();

    // persisted to localStorage
    await waitFor(() => {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) as string);
      expect(parsed.units).toBe("f");
    });

    // remount: choice persists
    view.unmount();
    cleanup();
    setOnline(false);
    render(<App />);
    expect(await screen.findByText("68")).toBeTruthy();
  });

  it("shows km/h wind in Celsius mode", async () => {
    seedCache({ code: 0, isDay: true, windKmh: 18, units: "c" });
    setOnline(false);
    render(<App />);
    expect(await screen.findByText(/18 km\/h/)).toBeTruthy();
  });
});

describe("seeded cached state renders", () => {
  it("renders place, temperature, humidity and feels-like from a seeded snapshot", async () => {
    seedCache({
      code: 1,
      isDay: true,
      tempC: 17,
      feelsC: 15,
      humidity: 72,
      place: "Lisbon, Lisboa",
    });
    setOnline(false);

    render(<App />);

    expect(await screen.findByText("Lisbon, Lisboa")).toBeTruthy();
    expect(screen.getByText("Mainly clear")).toBeTruthy();
    expect(screen.getByText("17")).toBeTruthy();
    expect(screen.getByText("72%")).toBeTruthy();
    expect(screen.getByText(/Feels like 15°C/)).toBeTruthy();
  });

  it("does not make a network call when offline with a seeded cache", async () => {
    seedCache({ code: 0, isDay: true });
    setOnline(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    render(<App />);
    await screen.findByText("Clear sky");
    // wait a tick for any async effects
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
