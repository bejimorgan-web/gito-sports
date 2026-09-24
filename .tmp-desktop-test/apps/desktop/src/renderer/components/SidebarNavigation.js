import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function SidebarNavigation({ activeKey, items, onSelect }) {
    return (_jsx("nav", { className: "sidebar-nav", "aria-label": "Operator navigation", children: items.map((item) => (_jsxs("button", { className: item.key === activeKey ? "active" : "", type: "button", onClick: () => onSelect(item.key), children: [_jsx("span", { children: item.label }), _jsx("small", { children: item.description })] }, item.key))) }));
}
