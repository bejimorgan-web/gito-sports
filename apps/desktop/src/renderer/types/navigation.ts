export type NavigationKey =
  | "dashboard"
  | "analyticsOverview"
  | "analyticsStreaming"
  | "analyticsUsers"
  | "analyticsMatches"
  | "analyticsAds"
  | "iptv"
  | "preview"
  | "matchAssignment"
  | "sports"
  | "approvals"
  | "matches"
  | "mobileFeatures";

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
    description: "Manage IPTV accounts and credentials"
  },
  {
    key: "matchAssignment",
    label: "IPTV Content Browser",
    description: "Browse IPTV content and assign streams to matches"
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
    key: "mobileFeatures",
    label: "Mobile Navigation",
    description: "Control viewer navigation tabs remotely"
  }
];
