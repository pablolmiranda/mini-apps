import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import App, {
  clampBpm,
  tempoMarking,
  computeTapBpm,
  barSeconds,
  formatHMS,
  buildTrainerSegments,
  buildWorkoutSegments,
} from "../src/metronome";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ---------------- Pure helpers ---------------- */

describe("helpers", () => {
  it("clamps BPM into range", () => {
    expect(clampBpm(10)).toBe(30);
    expect(clampBpm(999)).toBe(300);
    expect(clampBpm(123.4)).toBe(123);
  });

  it("maps tempo markings", () => {
    expect(tempoMarking(50)).toBe("Largo");
    expect(tempoMarking(90)).toBe("Andante");
    expect(tempoMarking(120)).toBe("Allegro");
    expect(tempoMarking(210)).toBe("Prestissimo");
  });

  it("computes tap tempo from timestamps", () => {
    expect(computeTapBpm([0, 500, 1000])).toBe(120);
    expect(computeTapBpm([0, 1000])).toBe(60);
    expect(computeTapBpm([100])).toBeNull();
  });

  it("computes bar length and formats HMS", () => {
    expect(barSeconds({ bpm: 120, beats: 4 })).toBeCloseTo(2);
    expect(formatHMS(3)).toBe("0:03");
    expect(formatHMS(65)).toBe("1:05");
    expect(formatHMS(3661)).toBe("1:01:01");
  });

  it("builds trainer segments ramping to the target", () => {
    const segs = buildTrainerSegments({
      bpm: 80, beats: 4, denom: 4, subdivision: 1, accentFirst: true,
      startBpm: 80, incrementBpm: 10, intervalSeconds: 60, targetBpm: 100,
    });
    expect(segs.map((s) => s.params.bpm)).toEqual([80, 90, 100]);
    expect(segs.every((s) => s.end.unit === "time" && s.end.value === 60)).toBe(true);
  });

  it("builds workout segments with rests between exercises", () => {
    const segs = buildWorkoutSegments({
      id: "x", name: "X", rest: { unit: "time", value: 15 }, createdAt: 0, updatedAt: 0,
      exercises: [
        { id: "a", name: "A", bpm: 80, beats: 4, denom: 4, subdivision: 1, accentFirst: true, duration: { unit: "time", value: 30 } },
        { id: "b", name: "B", bpm: 100, beats: 4, denom: 4, subdivision: 2, accentFirst: true, duration: { unit: "bars", value: 8 } },
      ],
    });
    expect(segs.map((s) => s.kind)).toEqual(["exercise", "rest", "exercise"]);
    expect(segs[1].params.silent).toBe(true);
    expect(segs[2].end).toEqual({ unit: "bars", value: 8 });
  });
});

/* ---------------- Metronome UI ---------------- */

describe("metronome view", () => {
  it("shows tempo + marking and adjusts BPM and beats", () => {
    render(<App />);
    expect(screen.getByText("Allegro")).toBeTruthy();
    const tempo = screen.getByLabelText("Tempo") as HTMLInputElement;
    expect(tempo.value).toBe("120");

    fireEvent.click(screen.getByLabelText("Increase tempo"));
    expect((screen.getByLabelText("Tempo") as HTMLInputElement).value).toBe("121");

    expect(screen.getByLabelText("Beats").children.length).toBe(4);
    fireEvent.click(screen.getByLabelText("More beats"));
    expect(screen.getByLabelText("Beats").children.length).toBe(5);

    fireEvent.click(screen.getByLabelText("Eighth"));
    expect(screen.getByLabelText("Eighth").getAttribute("aria-pressed")).toBe("true");
  });
});

/* ---------------- Workout CRUD ---------------- */

async function gotoWorkout() {
  fireEvent.click(screen.getByLabelText("Choose mode"));
  fireEvent.click(screen.getByLabelText("Workout mode"));
}

describe("workouts", () => {
  it("seeds a sample, creates + persists, and deletes", async () => {
    const first = render(<App />);
    await gotoWorkout();
    await waitFor(() => expect(screen.getByLabelText("Run Warm-up Ladder")).toBeTruthy());

    // Create
    fireEvent.click(screen.getByLabelText("New workout"));
    fireEvent.change(screen.getByLabelText("Workout name"), { target: { value: "My Routine" } });
    fireEvent.click(screen.getByLabelText("Save workout"));
    await waitFor(() => expect(screen.getByLabelText("Run My Routine")).toBeTruthy());

    // Persist across reload (mode persists to localStorage too)
    first.unmount();
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Run My Routine")).toBeTruthy());

    // Delete the sample
    fireEvent.click(screen.getByLabelText("Delete Warm-up Ladder"));
    fireEvent.click(screen.getByLabelText("Confirm delete Warm-up Ladder"));
    await waitFor(() => expect(screen.queryByLabelText("Run Warm-up Ladder")).toBeNull());
    expect(screen.getByLabelText("Run My Routine")).toBeTruthy();
  });
});

/* ---------------- Practice tracking ---------------- */

class StubAudioContext {
  currentTime = 0;
  state = "running";
  destination = {};
  resume() { return Promise.resolve(); }
  createOscillator() {
    return { connect() {}, frequency: { value: 0 }, type: "", start() {}, stop() {} };
  }
  createGain() {
    return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } };
  }
}

describe("practice tracking", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", StubAudioContext);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.useFakeTimers();
  });

  it("accumulates while running and stops when stopped, persisting per day", () => {
    const first = render(<App />);

    fireEvent.click(screen.getByLabelText("Start"));
    act(() => { vi.advanceTimersByTime(3000); });
    expect((screen.getByLabelText("Practice time today").textContent || "")).toContain("0:03");

    fireEvent.click(screen.getByLabelText("Stop"));
    act(() => { vi.advanceTimersByTime(5000); });
    expect((screen.getByLabelText("Practice time today").textContent || "")).toContain("0:03");

    // Persisted: a fresh mount shows the same accumulated time.
    first.unmount();
    render(<App />);
    expect((screen.getByLabelText("Practice time today").textContent || "")).toContain("0:03");
  });
});
