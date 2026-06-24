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
    key: "analyticsOverview",
    label: "Analytics Overview",
    description: "View real-time platform metrics"
  },
  {
    key: "analyticsStreaming",
    label: "Streaming Analytics",
    description: "Stream performance and watch time"
  },
  {
    key: "analyticsUsers",
    label: "Users Analytics",
    description: "Audience and session metrics"
  },
  {
    key: "analyticsMatches",
    label: "Matches Analytics",
    description: "Match viewing and watch time"
  },
  {
    key: "analyticsAds",
    label: "Ads Analytics",
    description: "Ad delivery and reward metrics"
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
  },
  {
    key: "mobileFeatures",
    label: "Mobile Navigation",
    description: "Control viewer navigation tabs remotely"
  }
];
