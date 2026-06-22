import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import App from "../src/offline-expense-tracker";

// Fresh in-memory IndexedDB per test so persistence assertions are isolated.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  setOnline(true);
  // No real network in tests: make any fetch resolve immediately so the
  // foreground flush "upload" succeeds deterministically.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true } as Response))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Override navigator.onLine (read-only) for offline/online tests.
function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

function amountInput() {
  return screen.getByLabelText("Amount") as HTMLInputElement;
}

async function addExpense(amount: string, opts?: { category?: string; note?: string }) {
  if (opts?.note !== undefined) {
    fireEvent.change(screen.getByLabelText("Note mobile"), {
      target: { value: opts.note },
    });
  }
  if (opts?.category) {
    fireEvent.click(screen.getByRole("button", { name: opts.category }));
  }
  fireEvent.change(amountInput(), { target: { value: amount } });
  // jsdom doesn't reliably translate a submit-button click into a form submit,
  // so submit the form directly.
  fireEvent.submit(amountInput().closest("form") as HTMLFormElement);
}

describe("Offline Expense Tracker", () => {
  it("loads offline and shows the empty state", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("No expenses yet")).toBeTruthy());
  });

  it("adds an expense, lists it, and persists across a remount (reload)", async () => {
    const first = render(<App />);
    await waitFor(() => expect(screen.getByText("No expenses yet")).toBeTruthy());

    await addExpense("12.50", { category: "Food", note: "Lunch" });

    await waitFor(() => expect(screen.getByText("Lunch")).toBeTruthy());
    expect(screen.getByLabelText("Total spent").textContent).toBe("12.50");
    // amount input cleared after submit
    expect(amountInput().value).toBe("");

    // Simulate a reload: unmount, remount against the same persisted DB.
    first.unmount();
    render(<App />);
    await waitFor(() => expect(screen.getByText("Lunch")).toBeTruthy());
    expect(screen.getByLabelText("Total spent").textContent).toBe("12.50");
  });

  it("flushes pending -> synced when online", async () => {
    setOnline(true);
    render(<App />);
    await waitFor(() => expect(screen.getByText("No expenses yet")).toBeTruthy());

    await addExpense("8.00", { category: "Coffee", note: "Latte" });
    await waitFor(() => expect(screen.getByText("Latte")).toBeTruthy());

    // Once online flush completes, the row badge flips to Synced and the
    // pending counter reaches zero.
    await waitFor(
      () => {
        const row = screen.getByText("Latte").closest("li") as HTMLElement;
        expect(within(row).getByLabelText("Synced")).toBeTruthy();
      },
      { timeout: 3000 }
    );

    await waitFor(() =>
      expect(screen.getByText("pending").parentElement?.textContent).toContain("0")
    );
  });

  it("keeps expenses pending while offline", async () => {
    setOnline(false);
    render(<App />);
    await waitFor(() => expect(screen.getByText("No expenses yet")).toBeTruthy());
    // Offline banner / status visible.
    expect(screen.getAllByText("Offline").length).toBeGreaterThan(0);

    await addExpense("20.00", { category: "Transport", note: "Taxi" });
    await waitFor(() => expect(screen.getByText("Taxi")).toBeTruthy());

    const row = screen.getByText("Taxi").closest("li") as HTMLElement;
    expect(within(row).getByLabelText("Pending sync")).toBeTruthy();

    // Give any (guarded) flush a chance to run — it must NOT mark synced.
    await new Promise((r) => setTimeout(r, 400));
    expect(within(row).getByLabelText("Pending sync")).toBeTruthy();
  });

  it("flushes pending when the connection is restored (online event)", async () => {
    setOnline(false);
    render(<App />);
    await waitFor(() => expect(screen.getByText("No expenses yet")).toBeTruthy());

    await addExpense("5.25", { category: "Food", note: "Snack" });
    await waitFor(() => expect(screen.getByText("Snack")).toBeTruthy());
    let row = screen.getByText("Snack").closest("li") as HTMLElement;
    expect(within(row).getByLabelText("Pending sync")).toBeTruthy();

    // Reconnect.
    setOnline(true);
    fireEvent(window, new Event("online"));

    await waitFor(
      () => {
        row = screen.getByText("Snack").closest("li") as HTMLElement;
        expect(within(row).getByLabelText("Synced")).toBeTruthy();
      },
      { timeout: 3000 }
    );
  });

  it("computes totals by category", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("No expenses yet")).toBeTruthy());

    await addExpense("10.00", { category: "Food", note: "A" });
    await waitFor(() => expect(screen.getByText("A")).toBeTruthy());
    await addExpense("5.00", { category: "Food", note: "B" });
    await waitFor(() => expect(screen.getByText("B")).toBeTruthy());
    await addExpense("4.00", { category: "Coffee", note: "C" });
    await waitFor(() => expect(screen.getByText("C")).toBeTruthy());

    expect(screen.getByLabelText("Total spent").textContent).toBe("19.00");

    // Category breakdown: the "By category" section must contain a card whose
    // Food total is the combined 15.00 (10 + 5), and Coffee 4.00.
    await waitFor(() => {
      const heading = screen.getByText("By category");
      const section = heading.parentElement as HTMLElement;
      // Each card shows "$<amount>" — find the Food card by locating the label
      // within the section's grid (not the picker button at the bottom).
      const cards = Array.from(section.querySelectorAll("div")).filter((d) =>
        /\$\d/.test(d.textContent ?? "")
      );
      const foodCard = cards.find(
        (c) => c.textContent?.includes("Food") && c.textContent?.includes("15.00")
      );
      expect(foodCard).toBeTruthy();
      const coffeeCard = cards.find(
        (c) => c.textContent?.includes("Coffee") && c.textContent?.includes("4.00")
      );
      expect(coffeeCard).toBeTruthy();
    });
  });

  it("does not crash when SyncManager / service worker are unavailable", async () => {
    // No serviceWorker on navigator in jsdom — registration must be guarded.
    expect("serviceWorker" in navigator).toBe(false);
    render(<App />);
    await waitFor(() => expect(screen.getByText("No expenses yet")).toBeTruthy());
    await addExpense("1.00", { note: "Guard" });
    await waitFor(() => expect(screen.getByText("Guard")).toBeTruthy());
  });
});
