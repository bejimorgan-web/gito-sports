import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./renderer/App";
import "./renderer/styles.css";

function mountApp() {
  const rootEl = document.getElementById("root") as HTMLElement | null;
  if (!rootEl) {
    throw new Error("React mount failed: root element not found");
  }
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", mountApp, { once: true });
} else {
  mountApp();
}

