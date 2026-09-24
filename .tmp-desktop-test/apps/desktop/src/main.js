import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./renderer/App";
import "./renderer/styles.css";
function mountApp() {
    const rootEl = document.getElementById("root");
    if (!rootEl) {
        throw new Error("React mount failed: root element not found");
    }
    const rendererErrorHandler = (event) => {
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
    const unhandledRejectionHandler = (event) => {
        if (window.gito?.sendRendererError) {
            window.gito.sendRendererError({
                message: event.reason?.toString() ?? 'Unhandled rejection',
                reason: event.reason,
            });
        }
    };
    window.addEventListener('error', rendererErrorHandler);
    window.addEventListener('unhandledrejection', unhandledRejectionHandler);
    ReactDOM.createRoot(rootEl).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
}
if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", mountApp, { once: true });
}
else {
    mountApp();
}
