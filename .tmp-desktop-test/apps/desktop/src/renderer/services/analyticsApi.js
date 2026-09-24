import { API_BASE_URL } from "./api-client";
async function request(path) {
    const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
    if (!response.ok) {
        let errorMessage = `Request failed with status ${response.status}`;
        try {
            const body = await response.json();
            if (body?.message) {
                errorMessage = body.message;
            }
            else if (body?.error) {
                errorMessage = body.error;
            }
        }
        catch {
            // ignore invalid JSON
        }
        throw new Error(errorMessage);
    }
    if (response.status === 204) {
        return undefined;
    }
    const body = await response.json();
    return (body?.data ?? body);
}
export const analyticsApi = {
    getOverview() {
        return request("/analytics/overview");
    },
    getStreams() {
        return request("/analytics/streams");
    },
    getUsers() {
        return request("/analytics/users");
    },
    getAds() {
        return request("/analytics/ads");
    },
    getMatches() {
        return request("/analytics/overview");
    }
};
