export type NavigationKey =
  | "dashboard"
  | "iptv"
  | "preview"
  | "matchAssignment"
  | "sports"
  | "approvals"
  | "matches";

export interface NavigationItem {
  key: NavigationKey;
  label: string;
  description: string;
}

export const navigationItems: NavigationItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Live operations overview"
  },
  {
    key: "iptv",
    label: "IPTV Management",
    description: "Providers and channels"
  },
  {
    key: "preview",
    label: "Stream Preview",
    description: "Review source quality"
  },
  {
    key: "matchAssignment",
    label: "Match Assignment",
    description: "Assign streams to matches"
  },
  {
    key: "sports",
    label: "Sports",
    description: "Manage sports, countries, competitions, and teams"
  },
  {
    key: "approvals",
    label: "Live Approvals",
    description: "Publish match streams"
  },
  {
    key: "matches",
    label: "Matches",
    description: "Schedule and manage matches"
  }
];
