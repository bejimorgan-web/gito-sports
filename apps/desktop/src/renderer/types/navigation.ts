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
    key: "matchAssignment",
    label: "IPTV Content Browser",
    description: "Browse IPTV content and assign streams to matches"
  }
];
