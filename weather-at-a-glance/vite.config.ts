import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Local preview host only — not part of the deliverable .tsx.
export default defineConfig({
  root: "preview",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist-preview",
    emptyOutDir: true,
  },
});
