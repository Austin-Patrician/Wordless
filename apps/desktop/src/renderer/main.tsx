import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@wordless/ui-kit/styles.css";
import "./styles/app.css";
import { App } from "./app/App";
import { RendererErrorBoundary } from "./app/RendererErrorBoundary";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Wordless renderer root was not found.");
}

createRoot(root).render(
  <StrictMode>
    <RendererErrorBoundary>
      <App />
    </RendererErrorBoundary>
  </StrictMode>,
);
