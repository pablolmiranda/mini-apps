import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "../src/geo-field-journal";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
