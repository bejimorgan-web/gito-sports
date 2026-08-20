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
  | "mobileFeatures"
  | "news"
  | "clubs";
  

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
    key: "news",
    label: "News",
    description: "Editorial workspace for articles and sources"
  },
  {
    key: "clubs",
    label: "Clubs & Fixtures",
    description: "Manage canonical clubs, seasons, and fixtures"
  },
  {
    key: "sports",
    label: "Manage",
    description: "Manage sports, countries, competitions, and clubs"
  },
  {
    key: "mobileFeatures",
    label: "Mobile App",
    description: "Configure visible mobile navigation sections"
  },
  {
    key: "matchAssignment",
    label: "IPTV Content Browser",
    description: "Browse IPTV content and assign streams to matches"
  }
];
