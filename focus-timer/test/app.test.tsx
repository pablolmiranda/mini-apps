import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../src/focus-timer";

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

describe("Focus Timer", () => {
  it("starts in the Focus phase at the configured duration", () => {
    render(<App />);
    expect(screen.getByText("Focus")).toBeTruthy();
    expect(time()).toBe("25:00");
  });

  it("counts down while running and resets cleanly", () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText("Start"));
    expect(screen.getByLabelText("Pause")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(time()).toBe("24:57");

    fireEvent.click(screen.getByLabelText("Reset"));
    expect(time()).toBe("25:00");
    expect(screen.getByLabelText("Start")).toBeTruthy();
  });

  it("skips from Focus to a Short Break", () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText("Skip"));
    expect(screen.getByText("Short Break")).toBeTruthy();
    expect(time()).toBe("05:00");
  });

  it("persists settings across a reload (remount)", () => {
    const first = render(<App />);
    fireEvent.click(screen.getByLabelText("Settings"));
    fireEvent.click(screen.getByLabelText("Increase Focus"));
    expect(time()).toBe("26:00");

    first.unmount();
    render(<App />);
    expect(time()).toBe("26:00");
  });

  it("completes a focus session: advances to break and counts it", () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText("Settings"));
    // Drop focus length to its minimum (1 minute) for a fast completion.
    for (let i = 0; i < 24; i++) {
      fireEvent.click(screen.getByLabelText("Decrease Focus"));
    }
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(time()).toBe("01:00");

    fireEvent.click(screen.getByLabelText("Start"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText("Short Break")).toBeTruthy();
    expect(screen.getByText("1 today")).toBeTruthy();
  });
});
