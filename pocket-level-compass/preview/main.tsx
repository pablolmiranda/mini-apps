import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "../src/pocket-level-compass";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
