import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "../src/metronome";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
