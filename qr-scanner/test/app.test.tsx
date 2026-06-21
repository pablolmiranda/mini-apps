import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "../src/qr-scanner";

const KEY = "qr-scanner:history:v1";

function seed(entries: Array<{ id: string; value: string; format: string; ts: number }>) {
  localStorage.setItem(KEY, JSON.stringify(entries));
}

beforeEach(() => {
  localStorage.clear();
  // jsdom has no camera; the app should detect that gracefully.
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("QR / Barcode Scanner", () => {
  it("shows an unsupported state when there's no camera API", () => {
    render(<App />);
    expect(screen.getByText("Camera unavailable")).toBeTruthy();
    // History remains reachable even without a camera.
    expect(screen.getByLabelText("History")).toBeTruthy();
  });

  it("loads scan history from storage and shows a badge count", () => {
    seed([
      { id: "1", value: "https://example.com", format: "qr_code", ts: Date.now() },
      { id: "2", value: "0123456789012", format: "ean_13", ts: Date.now() },
    ]);
    render(<App />);

    expect(screen.getByText("2")).toBeTruthy(); // count badge
    fireEvent.click(screen.getByLabelText("History"));

    expect(screen.getByText("https://example.com")).toBeTruthy();
    expect(screen.getByText("0123456789012")).toBeTruthy();
    // Only the URL entry exposes an "Open link" action.
    expect(screen.getAllByLabelText("Copy").length).toBe(2);
    expect(screen.getAllByLabelText("Open link").length).toBe(1);
  });

  it("copies a value to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    seed([{ id: "1", value: "hello-code", format: "code_128", ts: Date.now() }]);
    render(<App />);

    fireEvent.click(screen.getByLabelText("History"));
    fireEvent.click(screen.getByLabelText("Copy"));
    expect(writeText).toHaveBeenCalledWith("hello-code");
  });

  it("deletes a single entry and clears all", () => {
    seed([
      { id: "1", value: "aaa", format: "qr_code", ts: Date.now() },
      { id: "2", value: "bbb", format: "qr_code", ts: Date.now() },
    ]);
    render(<App />);
    fireEvent.click(screen.getByLabelText("History"));

    const rows = screen.getAllByLabelText("Delete");
    expect(rows.length).toBe(2);
    fireEvent.click(rows[0]);
    expect(screen.getAllByLabelText("Delete").length).toBe(1);

    fireEvent.click(screen.getByLabelText("Clear history"));
    expect(screen.getByText("No scans yet")).toBeTruthy();
  });

  it("persists deletions to storage", () => {
    seed([{ id: "1", value: "aaa", format: "qr_code", ts: Date.now() }]);
    render(<App />);
    fireEvent.click(screen.getByLabelText("History"));
    fireEvent.click(screen.getByLabelText("Clear history"));

    expect(JSON.parse(localStorage.getItem(KEY) || "[]")).toEqual([]);
  });
});
