import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import App from "../src/read-it-later";

// Fresh in-memory IndexedDB + clean URL per test so assertions are isolated.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  window.history.replaceState({}, "", "/");
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
  // Guard: navigator.share is absent in jsdom; ensure tests didn't leak one.
  // (We assign it explicitly in the share test; remove it here.)
  delete (navigator as { share?: unknown }).share;
});

async function waitLoaded() {
  await waitFor(() =>
    expect(screen.queryByText("Loading your list…")).toBeNull()
  );
}

describe("Read-It-Later", () => {
  it("ingests an incoming Web Share Target payload and saves it", async () => {
    // Share Target (GET) delivers params before the app mounts.
    window.history.replaceState(
      {},
      "",
      "/?url=https%3A%2F%2Fexample.com%2Fpost&title=Hello%20World"
    );

    render(<App />);
    await waitLoaded();

    // The shared item is now in the (unread) list.
    expect(await screen.findByText("Hello World")).toBeTruthy();

    // URL was cleaned so a reload won't re-add it.
    await waitFor(() => expect(window.location.search).toBe(""));

    // Persisted to IndexedDB: remount against the same DB shows it again.
    cleanup();
    render(<App />);
    await waitLoaded();
    expect(await screen.findByText("Hello World")).toBeTruthy();
  });

  it("extracts a URL from shared free text when no url param is given", async () => {
    window.history.replaceState(
      {},
      "",
      "/?text=" + encodeURIComponent("Great read https://news.test/story rec")
    );
    render(<App />);
    await waitLoaded();
    // host shown on the card (as derived title and as the host label)
    expect((await screen.findAllByText("news.test")).length).toBeGreaterThan(0);
    // the remaining shared text is kept as an offline note
    expect(
      screen.getByText(/Great read https:\/\/news\.test\/story rec/)
    ).toBeTruthy();
  });

  it("adds a link manually and persists it (IndexedDB CRUD)", async () => {
    render(<App />);
    await waitLoaded();

    fireEvent.click(screen.getByLabelText("Add link"));
    fireEvent.change(screen.getByLabelText("Link URL"), {
      target: { value: "https://blog.test/one" },
    });
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "First Post" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save link" }));

    expect(await screen.findByText("First Post")).toBeTruthy();

    // Persisted across a remount (reload).
    cleanup();
    render(<App />);
    await waitLoaded();
    expect(await screen.findByText("First Post")).toBeTruthy();
  });

  it("rejects an invalid URL in the manual form", async () => {
    render(<App />);
    await waitLoaded();
    fireEvent.click(screen.getByLabelText("Add link"));
    fireEvent.change(screen.getByLabelText("Link URL"), {
      target: { value: "not a url" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save link" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("marks an item read/unread and filters by Read/Unread", async () => {
    window.history.replaceState(
      {},
      "",
      "/?url=https://example.com/a&title=Article%20A"
    );
    render(<App />);
    await waitLoaded();
    await screen.findByText("Article A");

    // Initially under Unread.
    fireEvent.click(screen.getByLabelText("Mark as read"));

    // It should now leave the Unread filter…
    await waitFor(() =>
      expect(screen.queryByText("Article A")).toBeNull()
    );

    // …and appear under the Read filter.
    fireEvent.click(screen.getByRole("tab", { name: /Read/ }));
    expect(await screen.findByText("Article A")).toBeTruthy();
  });

  it("archives and restores an item", async () => {
    window.history.replaceState(
      {},
      "",
      "/?url=https://example.com/b&title=Article%20B"
    );
    render(<App />);
    await waitLoaded();
    await screen.findByText("Article B");

    fireEvent.click(screen.getByLabelText("Archive"));
    await waitFor(() => expect(screen.queryByText("Article B")).toBeNull());

    // Visible under Archived.
    fireEvent.click(screen.getByRole("tab", { name: /Archived/ }));
    expect(await screen.findByText("Article B")).toBeTruthy();

    // Restore.
    fireEvent.click(screen.getByLabelText("Restore from archive"));
    await waitFor(() => expect(screen.queryByText("Article B")).toBeNull());
  });

  it("deletes an item from IndexedDB", async () => {
    window.history.replaceState(
      {},
      "",
      "/?url=https://example.com/c&title=Article%20C"
    );
    render(<App />);
    await waitLoaded();
    const card = (await screen.findByText("Article C")).closest("article")!;

    fireEvent.click(within(card).getByLabelText(/^Delete/));
    await waitFor(() => expect(screen.queryByText("Article C")).toBeNull());

    // Gone after remount too.
    cleanup();
    render(<App />);
    await waitLoaded();
    expect(screen.queryByText("Article C")).toBeNull();
  });

  it("shows a Share out button only when navigator.share exists", async () => {
    // Absent in jsdom by default → no Share button.
    window.history.replaceState(
      {},
      "",
      "/?url=https://example.com/d&title=Article%20D"
    );
    const first = render(<App />);
    await waitLoaded();
    await screen.findByText("Article D");
    expect(screen.queryByLabelText("Share out")).toBeNull();
    first.unmount();

    // Now provide a stub navigator.share and re-render.
    (navigator as { share?: (d: unknown) => Promise<void> }).share = async () => {};
    render(<App />);
    await waitLoaded();
    await screen.findByText("Article D");
    expect(screen.getByLabelText("Share out")).toBeTruthy();
  });
});
