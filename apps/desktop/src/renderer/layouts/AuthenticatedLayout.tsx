import type { ReactNode } from "react";
import type { IPTVProvider } from "@gito/shared";

import { SidebarNavigation } from "../components/SidebarNavigation";
import { navigationItems, type NavigationKey } from "../types/navigation";

interface AuthenticatedLayoutProps {
  activeKey: NavigationKey;
  children: ReactNode;
  liveMode: boolean;
  onNavigate: (key: NavigationKey) => void;
  activeProvider?: IPTVProvider | undefined;
}

export function AuthenticatedLayout({
  activeKey,
  children,
  liveMode,
  onNavigate,
  activeProvider
}: AuthenticatedLayoutProps) {
  return (
    <main className={liveMode ? "app-shell live-mode-shell" : "app-shell"}>
      <aside className="sidebar">
        <div className="brand-block">
          <p className="eyebrow">GiTO</p>
          <h1>Live Sports</h1>
          <span>{liveMode ? "LIVE MODE" : "Operations Console"}</span>
        </div>
        {!liveMode ? (
          <>
            <SidebarNavigation
              activeKey={activeKey}
              items={navigationItems}
              onSelect={onNavigate}
            />
            {activeProvider ? (
              <div className="provider-card">
                <span className="card-label">Active Provider</span>
                <strong>{activeProvider.name}</strong>
                <small>Status: {activeProvider.availabilityStatus ?? "unknown"}</small>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="operator-card">
          <span>Signed in</span>
          <strong>Local Operator</strong>
        </div>
      </aside>
      <section className="workspace">{children}</section>
    </main>
  );
}
