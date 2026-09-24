import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
export function Toast({ id, message, type = "info", onClose }) {
    const [exiting, setExiting] = useState(false);
    useEffect(() => {
        const showTimer = window.setTimeout(() => setExiting(true), 3000);
        const removeTimer = window.setTimeout(() => onClose(id), 3250);
        return () => {
            window.clearTimeout(showTimer);
            window.clearTimeout(removeTimer);
        };
    }, [id, onClose]);
    const handleClose = () => {
        // begin exit animation then remove
        setExiting(true);
        window.setTimeout(() => onClose(id), 220);
    };
    const role = type === "error" ? "alert" : "status";
    const ariaLive = type === "error" ? "assertive" : "polite";
    return (_jsxs("div", { className: `toast ${type} ${exiting ? "exit" : "enter"}`, role: role, "aria-live": ariaLive, "aria-atomic": "true", children: [_jsx("div", { className: "toast-content", children: message }), _jsx("button", { className: "toast-close", "aria-label": "Dismiss", onClick: handleClose, children: "\u00D7" })] }));
}
