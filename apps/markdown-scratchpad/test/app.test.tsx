import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import App from "../src/markdown-scratchpad";

// Fresh in-memory IndexedDB per test so persistence assertions are isolated.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  cleanup();
});

function editor() {
  return screen.getByLabelText("Note editor") as HTMLTextAreaElement;
}

describe("Markdown Scratchpad", () => {
  it("loads offline and shows a starter note", async () => {
    render(<App />);
    await waitFor(() => expect(editor().value).toContain("Welcome to your Scratchpad"));
    expect(screen.getByText("Works offline")).toBeTruthy();
  });

  it("autosaves edits and persists them across a reload (remount)", async () => {
    const first = render(<App />);
    await waitFor(() => expect(editor().value).toContain("Welcome"));

    fireEvent.change(editor(), { target: { value: "# My note\nhello world" } });
    // Autosave indicator confirms the write to IndexedDB completed.
    await screen.findByText("Saved");

    // Simulate a full reload: unmount, then mount a fresh instance against the
    // same (persisted) IndexedDB.
    first.unmount();
    render(<App />);

    await waitFor(() => expect(editor().value).toContain("My note"));
    expect(editor().value).toContain("hello world");
  });

  it("creates a new empty note", async () => {
    render(<App />);
    await waitFor(() => expect(editor().value).toContain("Welcome"));

    fireEvent.click(screen.getByLabelText("New note"));

    await waitFor(() => expect(editor().value).toBe(""));
    // Sidebar now lists two notes (starter + new).
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(2);
  });

  it("renders Markdown in preview and escapes HTML (no XSS)", async () => {
    render(<App />);
    await waitFor(() => expect(editor().value).toContain("Welcome"));

    fireEvent.change(editor(), {
      target: { value: "# Title\n**bold** and <script>alert(1)</script>" },
    });
    await screen.findByText("Saved");

    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    const preview = document.querySelector(".markdown-preview") as HTMLElement;
    await waitFor(() => expect(preview.querySelector("strong")).toBeTruthy());
    // The script tag must be inert text, never a real element.
    expect(preview.querySelector("script")).toBeNull();
    expect(preview.textContent).toContain("<script>alert(1)</script>");
    expect(within(preview).getByText("Title")).toBeTruthy();
  });

  it("renders blockquotes, headings and lists in preview", async () => {
    render(<App />);
    await waitFor(() => expect(editor().value).toContain("Welcome"));

    fireEvent.change(editor(), {
      target: { value: "## Heading\n- item one\n> a quotation" },
    });
    await screen.findByText("Saved");
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    const preview = document.querySelector(".markdown-preview") as HTMLElement;
    await waitFor(() => expect(preview.querySelector("blockquote")).toBeTruthy());
    expect(preview.querySelector("h2")?.textContent).toBe("Heading");
    expect(preview.querySelector("li")?.textContent).toBe("item one");
    expect(preview.querySelector("blockquote")?.textContent).toBe("a quotation");
  });

  it("deletes a note", async () => {
    render(<App />);
    await waitFor(() => expect(editor().value).toContain("Welcome"));

    fireEvent.click(screen.getByLabelText("New note"));
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(2));

    const firstItem = screen.getAllByRole("listitem")[0];
    fireEvent.click(within(firstItem).getByLabelText(/^Delete/));

    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(1));
  });
});
