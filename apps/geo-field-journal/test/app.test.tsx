import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import App, {
  projectPins,
  listEntries,
  putEntry,
  deleteEntry,
  formatCoord,
  type Entry,
} from "../src/geo-field-journal";

// Fresh in-memory IndexedDB per test so persistence assertions are isolated.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  cleanup();
});

function mkEntry(over: Partial<Entry> = {}): Entry {
  return {
    id: over.id ?? `id-${Math.random().toString(36).slice(2)}`,
    title: over.title ?? "Untitled",
    note: over.note ?? "",
    photo: over.photo ?? null,
    lat: over.lat ?? null,
    lng: over.lng ?? null,
    accuracy: over.accuracy ?? null,
    ts: over.ts ?? Date.now(),
  };
}

/* ------------------------------------------------------------------ *
 * IndexedDB add / list / delete
 * ------------------------------------------------------------------ */

describe("IndexedDB layer", () => {
  it("adds and lists entries, newest first", async () => {
    await putEntry(mkEntry({ id: "a", title: "First", ts: 100 }));
    await putEntry(mkEntry({ id: "b", title: "Second", ts: 200 }));

    const rows = await listEntries();
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]); // ts-desc
    expect(rows.map((r) => r.title)).toEqual(["Second", "First"]);
  });

  it("deletes an entry", async () => {
    await putEntry(mkEntry({ id: "a" }));
    await putEntry(mkEntry({ id: "b" }));
    await deleteEntry("a");

    const rows = await listEntries();
    expect(rows.map((r) => r.id)).toEqual(["b"]);
  });

  it("upserts on the same id", async () => {
    await putEntry(mkEntry({ id: "a", title: "Old" }));
    await putEntry(mkEntry({ id: "a", title: "New" }));
    const rows = await listEntries();
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("New");
  });
});

/* ------------------------------------------------------------------ *
 * projectPins normalization helper
 * ------------------------------------------------------------------ */

describe("projectPins (lat/lng → viewBox)", () => {
  it("returns no pins when there are no valid coordinates", () => {
    const out = projectPins([
      { id: "x", lat: null, lng: null },
      { id: "y", lat: NaN, lng: 10 },
    ]);
    expect(out.pins).toEqual([]);
    expect(out.width).toBe(1000);
  });

  it("centers a single point", () => {
    const out = projectPins([{ id: "a", lat: 40, lng: -73 }], 1000, 80);
    expect(out.pins).toHaveLength(1);
    expect(out.pins[0].x).toBeCloseTo(500, 5);
    expect(out.pins[0].y).toBeCloseTo(500, 5);
  });

  it("auto-fits bounds and flips latitude (north at top)", () => {
    const size = 1000;
    const margin = 80;
    const inner = size - margin * 2;
    const pts = [
      { id: "sw", lat: 10, lng: 10 }, // min lat, min lng
      { id: "ne", lat: 20, lng: 30 }, // max lat, max lng
    ];
    const out = projectPins(pts, size, margin);
    const sw = out.pins.find((p) => p.id === "sw")!;
    const ne = out.pins.find((p) => p.id === "ne")!;

    // min lng -> left margin; max lng -> right edge of inner box
    expect(sw.x).toBeCloseTo(margin, 5);
    expect(ne.x).toBeCloseTo(margin + inner, 5);

    // max lat (north) -> top margin; min lat -> bottom edge (y flipped)
    expect(ne.y).toBeCloseTo(margin, 5);
    expect(sw.y).toBeCloseTo(margin + inner, 5);
  });

  it("keeps all pins inside the viewBox", () => {
    const out = projectPins(
      [
        { id: "1", lat: -33.8, lng: 151.2 },
        { id: "2", lat: 48.8, lng: 2.3 },
        { id: "3", lat: 35.6, lng: 139.7 },
      ],
      1000,
      80
    );
    for (const p of out.pins) {
      expect(p.x).toBeGreaterThanOrEqual(80);
      expect(p.x).toBeLessThanOrEqual(920);
      expect(p.y).toBeGreaterThanOrEqual(80);
      expect(p.y).toBeLessThanOrEqual(920);
    }
  });
});

describe("formatCoord", () => {
  it("formats hemispheres", () => {
    expect(formatCoord(40.5, -73.2)).toContain("40.50000°N");
    expect(formatCoord(40.5, -73.2)).toContain("73.20000°W");
    expect(formatCoord(-12, 100)).toContain("12.00000°S");
    expect(formatCoord(null, null)).toBe("no fix");
  });
});

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

describe("App rendering", () => {
  it("shows the empty state when there are no entries", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("No entries yet")).toBeTruthy());
  });

  it("renders persisted entries in the library", async () => {
    await putEntry(
      mkEntry({ id: "e1", title: "Ridge cairn", note: "stacked stones", lat: 46.5, lng: 7.9, ts: 500 })
    );
    await putEntry(mkEntry({ id: "e2", title: "River ford", lat: 46.6, lng: 8.0, ts: 600 }));

    render(<App />);
    await waitFor(() => expect(screen.getByText("River ford")).toBeTruthy());
    expect(screen.getByText("Ridge cairn")).toBeTruthy();
    // monospace coordinate string is rendered
    expect(screen.getAllByText(/46\.5/).length).toBeGreaterThanOrEqual(0);
  });

  it("opens an entry detail and plots it on the offline map", async () => {
    await putEntry(mkEntry({ id: "e1", title: "Summit", lat: 46.5, lng: 7.9, ts: 700 }));
    render(<App />);
    await waitFor(() => expect(screen.getByText("Summit")).toBeTruthy());

    fireEvent.click(screen.getByText("Summit"));
    await waitFor(() => expect(screen.getByText("Coordinates")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /show on map/i }));
    await waitFor(() =>
      expect(screen.getByLabelText("Offline map of journal entries")).toBeTruthy()
    );
  });
});

/* ------------------------------------------------------------------ *
 * Manual-entry fallback when geolocation is absent (jsdom default)
 * ------------------------------------------------------------------ */

describe("manual fallback without geolocation", () => {
  it("falls back to manual coordinate entry and saves", async () => {
    // jsdom has no navigator.geolocation by default.
    expect("geolocation" in navigator).toBe(false);

    render(<App />);
    await waitFor(() => expect(screen.getByText("No entries yet")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("New entry"));

    // Composer should immediately surface manual inputs since GPS is unsupported.
    // GPS is unsupported, so the composer drops straight into manual entry.
    const latInput = await screen.findByLabelText("Manual latitude");
    const lngInput = screen.getByLabelText("Manual longitude");

    fireEvent.change(screen.getByLabelText("Entry title"), { target: { value: "Manual point" } });
    fireEvent.change(latInput, { target: { value: "47.1" } });
    fireEvent.change(lngInput, { target: { value: "8.2" } });

    fireEvent.click(screen.getByRole("button", { name: /save entry/i }));

    // Lands on the detail view for the new entry.
    await waitFor(() => expect(screen.getByText("Coordinates")).toBeTruthy());
    expect(screen.getByText("47.100000")).toBeTruthy();
    expect(screen.getByText("8.200000")).toBeTruthy();

    // And it persisted to IndexedDB.
    const rows = await listEntries();
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Manual point");
    expect(rows[0].lat).toBeCloseTo(47.1, 5);
  });

  it("ignores invalid manual coordinates (out of range)", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("No entries yet")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("New entry"));

    const latInput = await screen.findByLabelText("Manual latitude");
    fireEvent.change(latInput, { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText("Manual longitude"), { target: { value: "8" } });

    const composer = screen.getByText("New field entry").closest("div")!.parentElement as HTMLElement;
    expect(within(composer).getByText(/Enter valid coordinates/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Entry title"), { target: { value: "Bad coords" } });
    fireEvent.click(screen.getByRole("button", { name: /save entry/i }));

    await waitFor(() => expect(screen.getByText("Coordinates")).toBeTruthy());
    // Saved without a location since the coords were invalid.
    expect(screen.getByText(/No location was attached/i)).toBeTruthy();
  });
});
