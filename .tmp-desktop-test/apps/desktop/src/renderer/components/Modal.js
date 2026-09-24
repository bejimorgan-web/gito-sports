import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Modal({ title, children, footer, onClose }) {
    return (_jsx("div", { className: "modal-backdrop", role: "dialog", "aria-modal": "true", children: _jsxs("div", { className: "modal-panel", children: [_jsxs("div", { className: "modal-header", children: [_jsxs("div", { children: [_jsx("p", { className: "eyebrow", children: "Manage" }), _jsx("h3", { children: title })] }), _jsx("button", { type: "button", className: "modal-close", onClick: onClose, "aria-label": "Close dialog", children: "\u00D7" })] }), _jsx("div", { className: "modal-body", children: children }), footer ? _jsx("div", { className: "modal-footer", children: footer }) : null] }) }));
}
