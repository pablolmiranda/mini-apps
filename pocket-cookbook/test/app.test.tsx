import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import App from "../src/pocket-cookbook";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("Pocket Cookbook", () => {
  it("seeds sample recipes on first run (offline)", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Open Weeknight Tomato Pasta")).toBeTruthy());
    expect(screen.getByLabelText("Open Fluffy Buttermilk Pancakes")).toBeTruthy();
  });

  it("opens a recipe and checks off an ingredient", async () => {
    render(<App />);
    const card = await screen.findByLabelText("Open Weeknight Tomato Pasta");
    fireEvent.click(card);

    // Cook view shows ingredients + method.
    expect(await screen.findByText("Ingredients")).toBeTruthy();
    const checks = screen.getAllByRole("checkbox");
    expect(checks[0].getAttribute("aria-checked")).toBe("false");
    fireEvent.click(checks[0]);
    expect(checks[0].getAttribute("aria-checked")).toBe("true");
  });

  it("adds a recipe and persists it across a reload", async () => {
    const first = render(<App />);
    await screen.findByLabelText("Open Weeknight Tomato Pasta");

    fireEvent.click(screen.getByLabelText("Add recipe"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Test Omelette" } });
    fireEvent.change(screen.getByLabelText("Ingredients"), { target: { value: "3 eggs\nbutter\nsalt" } });
    fireEvent.change(screen.getByLabelText("Steps"), { target: { value: "Beat eggs\nCook gently" } });
    fireEvent.click(screen.getByLabelText("Save recipe"));

    // Lands on the new recipe's cook view.
    await waitFor(() => expect(screen.getByText("Test Omelette")).toBeTruthy());

    // Reload: fresh mount reads it back from IndexedDB.
    first.unmount();
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Open Test Omelette")).toBeTruthy());
  });

  it("deletes a recipe with confirmation", async () => {
    render(<App />);
    const card = await screen.findByLabelText("Open Fluffy Buttermilk Pancakes");
    fireEvent.click(card);

    fireEvent.click(await screen.findByLabelText("Delete recipe"));
    fireEvent.click(screen.getByLabelText("Confirm delete"));

    await waitFor(() =>
      expect(screen.queryByLabelText("Open Fluffy Buttermilk Pancakes")).toBeNull()
    );
    // Back in the library, the other recipe remains.
    expect(screen.getByLabelText("Open Weeknight Tomato Pasta")).toBeTruthy();
  });

  it("filters recipes via search", async () => {
    render(<App />);
    await screen.findByLabelText("Open Weeknight Tomato Pasta");

    fireEvent.change(screen.getByLabelText("Search recipes"), { target: { value: "pancake" } });

    expect(screen.getByLabelText("Open Fluffy Buttermilk Pancakes")).toBeTruthy();
    expect(screen.queryByLabelText("Open Weeknight Tomato Pasta")).toBeNull();
  });
});
