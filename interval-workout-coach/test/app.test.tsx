import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../src/interval-workout-coach";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T08:00:00Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function time() {
  return (screen.getByLabelText("Time remaining") as HTMLElement).textContent;
}
function phase() {
  return (screen.getByLabelText("Phase") as HTMLElement).textContent;
}
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Configure a tiny workout via the settings sheet: prepare 5s, work 5s,
 *  rest 5s, rounds 2, sets 1 (set break irrelevant). */
function configureTiny() {
  fireEvent.click(screen.getByLabelText("Settings"));
  // prepare default 10 -> 5 (step 5): one decrease
  fireEvent.click(screen.getByLabelText("Decrease Prepare"));
  // work default 30 -> 5 (step 5): five decreases
  for (let i = 0; i < 5; i++) fireEvent.click(screen.getByLabelText("Decrease Work"));
  // rest default 15 -> 5 (step 5): two decreases
  for (let i = 0; i < 2; i++) fireEvent.click(screen.getByLabelText("Decrease Rest"));
  // rounds default 8 -> 2 (step 1): six decreases
  for (let i = 0; i < 6; i++) fireEvent.click(screen.getByLabelText("Decrease Rounds"));
  fireEvent.keyDown(document.body, { key: "Escape" });
}

describe("Interval Workout Coach", () => {
  it("starts in PREPARE at the configured duration", () => {
    render(<App />);
    expect(phase()).toBe("PREPARE");
    expect(time()).toBe("00:10"); // default prepare 10s
  });

  it("formats time as MM:SS", () => {
    render(<App />);
    configureTiny();
    expect(phase()).toBe("PREPARE");
    expect(time()).toBe("00:05");
  });

  it("runs the full sequence PREPARE -> WORK -> REST -> WORK -> DONE with round counting", () => {
    render(<App />);
    configureTiny();
    fireEvent.click(screen.getByLabelText("Start"));
    expect(phase()).toBe("PREPARE");

    // PREPARE (5s) -> WORK round 1
    advance(5000);
    expect(phase()).toBe("WORK");
    expect(screen.getByLabelText("Round").textContent).toContain("ROUND 1 / 2");

    // WORK (5s) -> REST (between round 1 and 2)
    advance(5000);
    expect(phase()).toBe("REST");

    // REST (5s) -> WORK round 2
    advance(5000);
    expect(phase()).toBe("WORK");
    expect(screen.getByLabelText("Round").textContent).toContain("ROUND 2 / 2");

    // WORK (5s) -> DONE (last round, no trailing rest)
    advance(5000);
    expect(phase()).toBe("DONE");
    expect(screen.getByText("WORKOUT COMPLETE")).toBeTruthy();
  });

  it("counts down accurately while running", () => {
    render(<App />);
    configureTiny();
    fireEvent.click(screen.getByLabelText("Start"));
    expect(time()).toBe("00:05");
    advance(2000);
    expect(time()).toBe("00:03");
  });

  it("pauses and resumes, holding the remaining time", () => {
    render(<App />);
    configureTiny();
    fireEvent.click(screen.getByLabelText("Start"));
    advance(2000);
    expect(time()).toBe("00:03");

    fireEvent.click(screen.getByLabelText("Pause"));
    // time stays frozen while paused
    advance(5000);
    expect(time()).toBe("00:03");
    expect(phase()).toBe("PREPARE");

    fireEvent.click(screen.getByLabelText("Start"));
    advance(3000);
    expect(phase()).toBe("WORK"); // resumed and advanced
  });

  it("resets back to the start", () => {
    render(<App />);
    configureTiny();
    fireEvent.click(screen.getByLabelText("Start"));
    advance(7000); // now in WORK
    expect(phase()).toBe("WORK");

    fireEvent.click(screen.getByLabelText("Reset"));
    expect(phase()).toBe("PREPARE");
    expect(time()).toBe("00:05");
    expect(screen.getByLabelText("Start")).toBeTruthy();
  });

  it("skips to the next phase", () => {
    render(<App />);
    configureTiny();
    expect(phase()).toBe("PREPARE");
    fireEvent.click(screen.getByLabelText("Skip"));
    expect(phase()).toBe("WORK");
    expect(screen.getByLabelText("Round").textContent).toContain("ROUND 1 / 2");
  });

  it("handles multiple sets with a SET BREAK between them", () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByLabelText("Decrease Prepare")); // 5
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByLabelText("Decrease Work")); // 5
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByLabelText("Decrease Rest")); // 5
    for (let i = 0; i < 7; i++) fireEvent.click(screen.getByLabelText("Decrease Rounds")); // 1
    fireEvent.click(screen.getByLabelText("Increase Sets")); // 2
    // set break default 60 -> 10: five decreases (step 10)
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByLabelText("Decrease Set break"));
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(screen.getByLabelText("Start"));
    advance(5000); // PREPARE -> WORK (set 1 round 1)
    expect(phase()).toBe("WORK");
    advance(5000); // WORK -> SET BREAK (last round of set 1, more sets)
    expect(phase()).toBe("SET BREAK");
    advance(10000); // SET BREAK -> WORK (set 2)
    expect(phase()).toBe("WORK");
    advance(5000); // WORK -> DONE
    expect(phase()).toBe("DONE");
  });

  it("persists settings across a reload (remount)", () => {
    const first = render(<App />);
    configureTiny();
    expect(time()).toBe("00:05");

    first.unmount();
    render(<App />);
    expect(phase()).toBe("PREPARE");
    expect(time()).toBe("00:05");
  });
});
