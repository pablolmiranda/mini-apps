import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Local preview host only. None of this is part of the deliverable .tsx —
// the app source imports only `react` and `lucide-react`; Tailwind + the
// DOM mount live here in the harness.
export default defineConfig({
  root: "preview",
  plugins: [react(), tailwindcss()],
  build: {
    // Keep the preview build out of dist/ (which holds the upload artifact).
    outDir: "../dist-preview",
    emptyOutDir: true,
  },
});
