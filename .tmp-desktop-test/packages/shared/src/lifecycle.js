export const matchLifecycleStates = [
    "draft",
    "scheduled",
    "assigned",
    "approved",
    "published",
    "live",
    "ended",
    "cancelled"
];
export const streamLifecycleStates = [
    "idle",
    "assigned",
    "testing",
    "approved",
    "active",
    "failed",
    "disabled"
];
export const matchLifecycleTransitions = {
    draft: ["scheduled", "cancelled"],
    scheduled: ["assigned", "cancelled"],
    assigned: ["approved", "cancelled"],
    approved: ["published", "cancelled"],
    published: ["live", "cancelled"],
    live: ["ended"],
    ended: [],
    cancelled: []
};
export const streamLifecycleTransitions = {
    idle: ["assigned", "disabled"],
    assigned: ["testing", "approved", "failed", "disabled"],
    testing: ["approved", "failed", "disabled"],
    approved: ["active", "failed", "disabled"],
    active: ["failed", "disabled"],
    failed: ["testing", "disabled"],
    disabled: []
};
export function canTransitionMatch(from, to) {
    return matchLifecycleTransitions[from].includes(to);
}
export function canTransitionStream(from, to) {
    return streamLifecycleTransitions[from].includes(to);
}
