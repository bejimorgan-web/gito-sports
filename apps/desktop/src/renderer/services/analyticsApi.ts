import { API_BASE_URL } from "./api-client";
import type { AnalyticsSummary } from "../features/analytics/AnalyticsCommon";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;

    try {
      const body = await response.json();
      if (body?.message) {
        errorMessage = body.message;
      } else if (body?.error) {
        errorMessage = body.error;
      }
    } catch {
      // ignore invalid JSON
    }

    throw new Error(errorMessage);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.json();
  return (body?.data ?? body) as T;
}

export const analyticsApi = {
  getOverview() {
    return request<AnalyticsSummary>("/analytics/overview");
  },
  getStreams() {
    return request<AnalyticsSummary>("/analytics/streams");
  },
  getUsers() {
    return request<AnalyticsSummary>("/analytics/users");
  },
  getAds() {
    return request<AnalyticsSummary>("/analytics/ads");
  },
  getMatches() {
    return request<AnalyticsSummary>("/analytics/overview");
  }
};
