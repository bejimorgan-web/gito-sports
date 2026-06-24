import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./renderer/App";
import "./renderer/styles.css";

declare global {
  interface Window {
    gito?: {
      sendRendererError?: (data: unknown) => void;
      sendRendererConsoleError?: (args: unknown) => void;
    };
  }
}

export {}; 

function mountApp() {
  const rootEl = document.getElementById("root") as HTMLElement | null;
  if (!rootEl) {
    throw new Error("React mount failed: root element not found");
  }

  const rendererErrorHandler = (event: ErrorEvent) => {
    if (window.gito?.sendRendererError) {
      window.gito.sendRendererError({
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack ?? null,
      });
    }
  };

  const unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
    if (window.gito?.sendRendererError) {
      window.gito.sendRendererError({
        message: event.reason?.toString() ?? 'Unhandled rejection',
        reason: event.reason,
      });
    }
  };

  window.addEventListener('error', rendererErrorHandler);
  window.addEventListener('unhandledrejection', unhandledRejectionHandler);

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

