import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../src/soundboard-sampler";

/* jsdom has no Web Audio. We deliberately leave AudioContext undefined for
   most tests to prove the UI logic never depends on (or throws without) it. */

beforeEach(() => {
  localStorage.clear();
  // Ensure a clean, audio-less environment.
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  delete (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Soundboard / Sampler — configuration & rendering", () => {
  it("renders the default (Drums) kit with 8 playable pads", () => {
    render(<App />);
    const group = screen.getByRole("group", { name: /drums pads/i });
    const pads = within(group).getAllByRole("button");
    expect(pads).toHaveLength(8);
    expect(screen.getByLabelText("Play Kick")).toBeTruthy();
    expect(screen.getByLabelText("Play Snare")).toBeTruthy();
  });

  it("offers three kits and switches between them", () => {
    render(<App />);
    expect(screen.getByLabelText("Kit Drums")).toBeTruthy();
    expect(screen.getByLabelText("Kit Tones")).toBeTruthy();
    expect(screen.getByLabelText("Kit FX")).toBeTruthy();

    // Drums kit has a Kick; Tones kit does not.
    expect(screen.queryByLabelText("Play Kick")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Kit Tones"));
    expect(screen.queryByLabelText("Play Kick")).toBeNull();
    expect(screen.getByLabelText("Play Bass C")).toBeTruthy();
    expect(screen.getByRole("group", { name: /tones pads/i })).toBeTruthy();
  });

  it("each pad shows a unique keyboard hint key within a kit", () => {
    render(<App />);
    const group = screen.getByRole("group", { name: /drums pads/i });
    const pads = within(group).getAllByRole("button");
    // The single-char key badge is rendered uppercased inside each pad.
    const keys = pads.map((p) => {
      const badge = p.querySelector("span.uppercase");
      return badge?.textContent?.trim().toLowerCase();
    });
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("Soundboard / Sampler — triggering without Web Audio", () => {
  it("does NOT throw when a pad is pressed and AudioContext is unavailable", () => {
    render(<App />);
    const pad = screen.getByLabelText("Play Kick");
    expect(audioContextIsAbsent()).toBe(true);
    expect(() => fireEvent.pointerDown(pad)).not.toThrow();
    // Header still reflects no-audio capability.
    expect(screen.getByText(/no audio/i)).toBeTruthy();
  });

  it("maps keyboard keys to pads and triggers without throwing", () => {
    render(<App />);
    // Drums pad "Kick" is bound to key "1".
    expect(() => fireEvent.keyDown(document.body, { key: "1" })).not.toThrow();
    // A key that maps to no pad is a harmless no-op.
    expect(() => fireEvent.keyDown(document.body, { key: "z" })).not.toThrow();
  });
});

describe("Soundboard / Sampler — audio engine (mocked)", () => {
  it("creates one AudioContext lazily and plays a voice on trigger", () => {
    const { play, ctor, resume } = installMockAudio();
    (window as unknown as { AudioContext: unknown }).AudioContext = ctor;

    render(<App />);
    expect(ctor).not.toHaveBeenCalled(); // lazy: nothing until a gesture

    fireEvent.pointerDown(screen.getByLabelText("Play Snare"));
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalled(); // suspended context resumed on gesture
    expect(play.connect).toHaveBeenCalled(); // a voice connected to master

    // A second hit reuses the same context (still one ctor call).
    fireEvent.pointerDown(screen.getByLabelText("Play Clap"));
    expect(ctor).toHaveBeenCalledTimes(1);

    // Header now reports the engine is LIVE.
    expect(screen.getByText(/live/i)).toBeTruthy();
  });
});

describe("Soundboard / Sampler — master volume & mute", () => {
  it("reflects volume changes in the readout and persists them", () => {
    const { unmount } = render(<App />);
    const slider = screen.getByLabelText("Master volume") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "40" } });
    expect(screen.getByText("40%")).toBeTruthy();
    expect(localStorage.getItem("soundboard-sampler:volume")).toBe("0.4");

    unmount();
    // Reloads at the persisted value.
    render(<App />);
    expect((screen.getByLabelText("Master volume") as HTMLInputElement).value).toBe("40");
  });

  it("mute toggles the readout to 0% and back", () => {
    render(<App />);
    const slider = screen.getByLabelText("Master volume") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "70" } });
    expect(screen.getByText("70%")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Mute"));
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByLabelText("Unmute")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Unmute"));
    expect(screen.getByText("70%")).toBeTruthy();
  });

  it("persists the selected kit across a remount", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByLabelText("Kit FX"));
    expect(screen.getByLabelText("Play Zap")).toBeTruthy();
    unmount();
    render(<App />);
    expect(screen.getByRole("group", { name: /fx pads/i })).toBeTruthy();
  });
});

/* ---- helpers ----------------------------------------------------- */

function audioContextIsAbsent(): boolean {
  return (
    (window as unknown as { AudioContext?: unknown }).AudioContext === undefined &&
    (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext ===
      undefined
  );
}

function installMockAudio() {
  // A minimal AudioNode stub: every node exposes connect + the params a
  // voice might poke. Returned `play` is the gain node voices connect to.
  const makeParam = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  const makeNode = () => ({
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    gain: makeParam(),
    frequency: makeParam(),
    detune: makeParam(),
    Q: makeParam(),
    type: "sine",
  });

  const master = makeNode();
  const resume = vi.fn(() => Promise.resolve());

  const ctxInstance = {
    state: "suspended" as AudioContextState,
    currentTime: 0,
    sampleRate: 44100,
    destination: makeNode(),
    resume,
    createGain: vi.fn(() => makeNode()),
    createOscillator: vi.fn(() => makeNode()),
    createBiquadFilter: vi.fn(() => makeNode()),
    createBufferSource: vi.fn(() => makeNode()),
    createBuffer: vi.fn(() => ({
      getChannelData: () => new Float32Array(64),
    })),
  };
  // The first createGain call (in ensureEngine) returns `master`.
  ctxInstance.createGain.mockImplementationOnce(() => master);

  const ctor = vi.fn(() => ctxInstance) as unknown as typeof AudioContext;
  return { ctor, play: master, resume };
}
