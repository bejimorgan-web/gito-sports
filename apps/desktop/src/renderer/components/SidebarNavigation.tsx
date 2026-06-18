import type { NavigationItem, NavigationKey } from "../types/navigation";

interface SidebarNavigationProps {
  activeKey: NavigationKey;
  items: NavigationItem[];
  onSelect: (key: NavigationKey) => void;
}

export function SidebarNavigation({
  activeKey,
  items,
  onSelect
}: SidebarNavigationProps) {
  return (
    <nav className="sidebar-nav" aria-label="Operator navigation">
      {items.map((item) => (
        <button
          className={item.key === activeKey ? "active" : ""}
          key={item.key}
          type="button"
          onClick={() => onSelect(item.key)}
        >
          <span>{item.label}</span>
          <small>{item.description}</small>
        </button>
      ))}
    </nav>
  );
}
