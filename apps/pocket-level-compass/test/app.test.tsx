import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App, {
  clamp,
  computeTilt,
  normalizeHeading,
  headingToCardinal,
  cardinalName,
  fmtDeg,
  detectSupport,
  needsPermission,
  LEVEL_TOLERANCE,
} from "../src/pocket-level-compass";

afterEach(() => cleanup());

describe("clamp", () => {
  it("clamps below, within, and above range", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("computeTilt — beta/gamma → bubble + tilt", () => {
  it("is dead level at 0/0 and centers the bubble", () => {
    const t = computeTilt(0, 0);
    expect(t.level).toBe(true);
    expect(t.x).toBe(0);
    expect(t.y).toBe(0);
    expect(t.pitch).toBe(0);
    expect(t.roll).toBe(0);
    expect(t.magnitude).toBe(0);
  });

  it("treats null/undefined/NaN as zero", () => {
    expect(computeTilt(null, undefined).level).toBe(true);
    expect(computeTilt(NaN, NaN).x).toBe(0);
  });

  it("drives the bubble toward the high (right) side on positive gamma", () => {
    const t = computeTilt(0, 15);
    expect(t.x).toBeGreaterThan(0);
    expect(t.roll).toBe(15);
    expect(t.level).toBe(false);
  });

  it("drives the bubble down on positive beta", () => {
    const t = computeTilt(15, 0);
    expect(t.y).toBeGreaterThan(0);
    expect(t.pitch).toBe(15);
  });

  it("clamps tilt angles to ±90 and bubble offsets to ±1", () => {
    const t = computeTilt(170, 140);
    expect(t.pitch).toBe(90);
    expect(t.roll).toBe(90);
    expect(t.x).toBe(1);
    expect(t.y).toBe(1);
    const n = computeTilt(-200, -200);
    expect(n.x).toBe(-1);
    expect(n.y).toBe(-1);
  });

  it("is NOT level just outside the tolerance and level just inside", () => {
    expect(computeTilt(LEVEL_TOLERANCE + 0.2, 0).level).toBe(false);
    expect(computeTilt(LEVEL_TOLERANCE - 0.2, 0).level).toBe(true);
  });

  it("computes a combined magnitude via hypot", () => {
    const t = computeTilt(3, 4);
    expect(t.magnitude).toBeCloseTo(5, 5);
  });

  it("honors a custom working range when mapping to unit space", () => {
    expect(computeTilt(0, 15, 30).x).toBeCloseTo(0.5, 5);
    expect(computeTilt(0, 15, 15).x).toBe(1);
  });
});

describe("normalizeHeading", () => {
  it("wraps into [0,360)", () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(360)).toBe(0);
    expect(normalizeHeading(370)).toBe(10);
    expect(normalizeHeading(-10)).toBe(350);
  });
  it("defaults non-finite to 0", () => {
    expect(normalizeHeading(null)).toBe(0);
    expect(normalizeHeading(NaN)).toBe(0);
  });
});

describe("headingToCardinal", () => {
  it("maps the eight principal directions", () => {
    expect(headingToCardinal(0)).toBe("N");
    expect(headingToCardinal(45)).toBe("NE");
    expect(headingToCardinal(90)).toBe("E");
    expect(headingToCardinal(135)).toBe("SE");
    expect(headingToCardinal(180)).toBe("S");
    expect(headingToCardinal(225)).toBe("SW");
    expect(headingToCardinal(270)).toBe("W");
    expect(headingToCardinal(315)).toBe("NW");
  });
  it("rounds to nearest sector and wraps 360 back to N", () => {
    expect(headingToCardinal(22)).toBe("N");
    expect(headingToCardinal(23)).toBe("NE");
    expect(headingToCardinal(359)).toBe("N");
  });
  it("has a long-form name for each cardinal", () => {
    expect(cardinalName("N")).toBe("North");
    expect(cardinalName("SE")).toBe("Southeast");
  });
});

describe("fmtDeg", () => {
  it("formats with the degree glyph and fixed digits", () => {
    expect(fmtDeg(3.14159, 1)).toBe("3.1°");
    expect(fmtDeg(90, 0)).toBe("90°");
    expect(fmtDeg(NaN)).toBe("0.0°");
  });
});

describe("feature detection", () => {
  it("reports unsupported when no window is given", () => {
    expect(detectSupport(undefined)).toBe("unsupported");
    expect(needsPermission(undefined)).toBe(false);
  });
  it("detects orientation support from a stub window", () => {
    const win = { DeviceOrientationEvent: function () {} } as unknown as Window;
    expect(detectSupport(win)).toBe("supported");
    expect(needsPermission(win)).toBe(false);
  });
  it("detects the iOS permission gate", () => {
    const win = {
      DeviceOrientationEvent: { requestPermission: () => Promise.resolve("granted") },
    } as unknown as Window;
    expect(needsPermission(win)).toBe(true);
  });
});

describe("rendering (sensors absent in jsdom)", () => {
  it("renders both instrument tabs as toggle buttons", () => {
    render(<App />);
    // "LEVEL" can also appear in the bubble badge, so target the tab role.
    expect(screen.getByRole("button", { name: /LEVEL/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /COMPASS/ })).toBeTruthy();
  });

  it("shows the unsupported notice in jsdom (no orientation API)", () => {
    // jsdom exposes no DeviceOrientationEvent, so detection reports
    // unsupported and we render the graceful fallback notice instead of the
    // Enable button.
    render(<App />);
    expect(detectSupport(window)).toBe("unsupported");
    expect(screen.getByText("NO MOTION SENSORS")).toBeTruthy();
    expect(screen.queryByLabelText("Enable sensors")).toBeNull();
  });

  it("shows an Enable sensors button when orientation IS supported", () => {
    const desc = Object.getOwnPropertyDescriptor(window, "DeviceOrientationEvent");
    // @ts-expect-error - inject a stub orientation API for this render.
    window.DeviceOrientationEvent = function () {};
    try {
      render(<App />);
      expect(screen.getByLabelText("Enable sensors")).toBeTruthy();
    } finally {
      if (desc) Object.defineProperty(window, "DeviceOrientationEvent", desc);
      else delete (window as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent;
    }
  });

  it("switches to the compass instrument when its tab is tapped", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /COMPASS/ }));
    expect(screen.getByText("HEADING")).toBeTruthy();
  });
});
