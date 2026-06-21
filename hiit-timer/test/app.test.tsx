import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import App from "../src/hiit-timer";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Seed a session straight into IndexedDB (matches the app's schema). */
function seedSession(s: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("hiit-timer", 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore("sessions", { keyPath: "id" });
      store.createIndex("updatedAt", "updatedAt");
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("sessions", "readwrite");
      tx.objectStore("sessions").put(s);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

const TINY = {
  id: "tiny",
  name: "Tiny",
  exercises: [
    { id: "a", name: "Alpha", durationSeconds: 3 },
    { id: "b", name: "Bravo", durationSeconds: 3 },
  ],
  setRepetitions: 2,
  restSeconds: 5,
  createdAt: 1,
  updatedAt: 1,
};

function timeText() {
  return (screen.getByLabelText("Time remaining") as HTMLElement).textContent;
}

describe("HIIT Timer — sessions", () => {
  it("seeds a sample session on first run", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Start Quick 7-Minute Burner")).toBeTruthy());
  });

  it("creates a session and persists it across a reload", async () => {
    const first = render(<App />);
    await screen.findByLabelText("Start Quick 7-Minute Burner");

    fireEvent.click(screen.getByLabelText("New session"));
    fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "My Workout" } });
    fireEvent.click(screen.getByLabelText("Save session"));

    await waitFor(() => expect(screen.getByLabelText("Start My Workout")).toBeTruthy());

    first.unmount();
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Start My Workout")).toBeTruthy());
  });

  it("edits a session name", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("Edit Quick 7-Minute Burner"));
    const nameField = screen.getByLabelText("Session name") as HTMLInputElement;
    expect(nameField.value).toBe("Quick 7-Minute Burner");
    fireEvent.change(nameField, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByLabelText("Save session"));
    await waitFor(() => expect(screen.getByLabelText("Start Renamed")).toBeTruthy());
  });

  it("deletes a session with confirmation", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("Delete Quick 7-Minute Burner"));
    fireEvent.click(screen.getByLabelText("Confirm delete Quick 7-Minute Burner"));
    await waitFor(() =>
      expect(screen.queryByLabelText("Start Quick 7-Minute Burner")).toBeNull()
    );
  });

  it("reorders exercises in the editor", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("New session"));
    fireEvent.click(screen.getByLabelText("Add exercise")); // now Exercise 1, Exercise 2

    let inputs = screen.getAllByLabelText("Exercise name") as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(["Exercise 1", "Exercise 2"]);

    fireEvent.click(screen.getByLabelText("Move Exercise 1 down"));
    inputs = screen.getAllByLabelText("Exercise name") as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(["Exercise 2", "Exercise 1"]);
  });
});

describe("HIIT Timer — player", () => {
  it("runs the full phase progression to DONE", async () => {
    await seedSession(TINY);
    render(<App />);
    const start = await screen.findByLabelText("Start Tiny");

    vi.useFakeTimers();
    fireEvent.click(start);

    // Lead-in countdown.
    expect(screen.getByText("Get ready")).toBeTruthy();
    expect(timeText()).toBe("10");

    const adv = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

    adv(10_000); // -> Set 1, Exercise 1 (Alpha)
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText(/Set 1/)).toBeTruthy();
    expect(screen.getByText(/Exercise 1 of 2/)).toBeTruthy();

    adv(3_000); // -> Rest before Bravo
    expect(screen.getByText("Rest")).toBeTruthy();

    adv(5_000); // -> Set 1, Exercise 2 (Bravo)
    expect(screen.getByText("Bravo")).toBeTruthy();
    expect(screen.getByText(/Exercise 2 of 2/)).toBeTruthy();

    adv(3_000); // -> Rest (between sets)
    expect(screen.getByText("Rest")).toBeTruthy();

    adv(5_000); // -> Set 2, Exercise 1 (Alpha)
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText(/Set 2/)).toBeTruthy();

    adv(3_000 + 5_000 + 3_000); // Bravo rep2 then finish
    expect(screen.getByText("DONE")).toBeTruthy();
    expect(screen.getByLabelText("Back to sessions")).toBeTruthy();
  });

  it("pauses and resumes, freezing the countdown", async () => {
    await seedSession(TINY);
    render(<App />);
    const start = await screen.findByLabelText("Start Tiny");

    vi.useFakeTimers();
    fireEvent.click(start);
    const adv = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

    adv(2_000);
    expect(timeText()).toBe("8");

    fireEvent.click(screen.getByLabelText("Pause"));
    adv(5_000); // time should not move while paused
    expect(timeText()).toBe("8");

    fireEvent.click(screen.getByLabelText("Resume"));
    adv(3_000);
    expect(timeText()).toBe("5");
  });
});
