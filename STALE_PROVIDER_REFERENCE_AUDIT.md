STALE PROVIDER REFERENCE AUDIT

Subject provider: 9fe16532-ac82-4650-9ae7-2dfab9f575f9

Investigation objective: Determine if stale references to this (non-existent) provider are stored in React state, localStorage, sessionStorage, or Electron config.

---

## Findings

### 1. Is this provider ID stored in React state?

**Answer: NO (in persistent form)**

Evidence:
- The provider ID `9fe16532-ac82-4650-9ae7-2dfab9f575f9` is NOT hardcoded in React state.
- `selectedProviderId` is a **component-local** state in `IptvManagementScreen`:
  ```typescript
  const [selectedProviderId, setSelectedProviderId] = useState("");
  ```
- Source: [apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx](apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx) line 39
- This state is **not persisted** to the App-level state tree, so it cannot survive a component unmount or page reload.
- Derivation: `selectedProviderId` is set only when the user clicks an "Edit" button on a provider from the `providers` prop (line 286).

### 2. Is it stored in localStorage?

**Answer: NO**

Evidence:
- localStorage key: `"gito-live-sports-operator-state"` (see [apps/desktop/src/renderer/App.tsx](apps/desktop/src/renderer/App.tsx) line 17)
- Stored fields: `assignment`, `channels`, `liveMatches`, `providers`, `previewedChannelId`, `selectedChannel`
- **NOT stored**: `selectedProviderId`
- Code reference: [apps/desktop/src/renderer/App.tsx](apps/desktop/src/renderer/App.tsx) lines 206-214:
  ```typescript
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      assignment,
      channels,
      liveMatches,
      providers,
      previewedChannelId,
      selectedChannel
    })
  );
  ```
- Conclusion: While the `providers` list is stored in localStorage, the specific `selectedProviderId` is not.

### 3. Is it stored in sessionStorage?

**Answer: NO**

Evidence:
- The codebase uses `window.localStorage`, NOT `window.sessionStorage`.
- No sessionStorage references found in the entire desktop renderer codebase.
- Search query on desktop source returned 0 matches for "sessionStorage".

### 4. Is it stored in Electron persistence/config?

**Answer: NO**

Evidence:
- Electron `main.ts` (see [apps/desktop/electron/main.ts](apps/desktop/electron/main.ts)):
  - Contains no state persistence logic
  - Contains no provider ID references
  - No ipcMain handlers for state synchronization
  - DevTools logs are printed to console but not persisted to disk
- Electron `preload.ts` (see [apps/desktop/electron/preload.ts](apps/desktop/electron/preload.ts)):
  - Minimal API exposure: only exposes `{ platform: "desktop" }`
  - No provider state sync mechanism
- Conclusion: No Electron-level persistence mechanism for provider IDs.

### 5. Which component triggers POST /iptv/providers/:providerId/test?

**Answer: IptvManagementScreen**

Evidence:
- Component: `IptvManagementScreen` — [apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx](apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx)
- Event handler: `handleTestProvider()` (line 102)
- UI element: Button labeled "Test Connection" (line 240-241)
- Call chain:
  1. User clicks "Test Connection" button
  2. `handleTestProvider()` is invoked
  3. If `selectedProviderId` is set, it calls `onTestProviderById(selectedProviderId)` (line 117)
  4. The prop `onTestProviderById` is provided by the parent component `App`

### 6. Where does that providerId originate?

**Answer: From the user's click on an "Edit" button**

Trace:

**Step 1: Edit button click (IptvManagementScreen, line 286)**
```typescript
<button
  type="button"
  onClick={() => {
    setSelectedProviderId(provider.id);  // <-- providerId comes from provider object
    setProviderName(provider.name);
    setBaseUrl(provider.baseUrl);
    setType(provider.type as CreateProviderRequest["type"]);
    setUsername("");
    setPassword("");
  }}
>
  Edit
</button>
```

**Step 2: provider object source**
- The `provider` is iterated from `providers` prop (line 273)
- The `providers` prop comes from the parent `App` component via props (line 29)
- Source: [apps/desktop/src/renderer/App.tsx](apps/desktop/src/renderer/App.tsx)

**Step 3: App-level providers source (App.tsx, line 118)**
```typescript
const [providers, setProviders] = useState<ProviderList>([]);
```

**Step 4: Providers populated via API call (App.tsx, refreshOperations)**
```typescript
const [providerData, channelData, liveData] = await Promise.all([
  apiClient.listProviders(),
  apiClient.listChannels(),
  apiClient.listLiveMatches()
]);
setProviders(providerData);
```

**Conclusion: The providerId originates from the backend API response (GET /iptv/providers).**

- If the backend returns a provider with this ID, it can be clicked and used.
- If the backend does NOT return it (which is the case — the provider is physically deleted from DB), the provider will not appear in the UI list, and therefore cannot be selected via the Edit button.

### 7. After a full page reload, does the stale provider ID still exist?

**Answer: NO**

Evidence and reasoning:

**Before reload:**
- User might have `selectedProviderId = "9fe16532-ac82-4650-9ae7-2dfab9f575f9"` in memory (IptvManagementScreen component state).

**During reload:**
- React component state is lost (not persisted).
- localStorage is read only to restore App-level state (see [apps/desktop/src/renderer/App.tsx](apps/desktop/src/renderer/App.tsx) line 170-184).
- localStorage contains: `assignment`, `channels`, `liveMatches`, `providers`, `previewedChannelId`, `selectedChannel`
- `selectedProviderId` is NOT in localStorage.
- The stored `providers` list is loaded from localStorage and then **overwritten** by a fresh API call to `listProviders()`:
  ```typescript
  await apiClient.login("operator@gito.local")
    .then(() => refreshOperations("full"))  // <-- fetches fresh providers from backend
  ```

**After reload:**
- `IptvManagementScreen` component re-mounts with `useState("")`.
- `selectedProviderId` is reset to empty string.
- The `providers` prop contains only the providers returned by the backend (now excludes the deleted provider).
- **The stale provider ID does NOT exist in any state after reload.**

### Summary: Could a stale provider reference trigger a test call after reload?

**Scenario: Attempting to call POST /iptv/providers/9fe16532-ac82-4650-9ae7-2dfab9f575f9/test after reload**

Answer: **NO — under normal UI flow.**

Reasoning:
1. `selectedProviderId` is not persisted (component-local state only).
2. localStorage does not store `selectedProviderId`.
3. After reload, `selectedProviderId` resets to `""`.
4. The "Test Connection" button requires `selectedProviderId` to have a value.
5. To set a value, the user must click "Edit" on a provider from the `providers` list.
6. The `providers` list comes from the backend API, which does not include the deleted provider.
7. Therefore, the Edit button for the deleted provider would not appear.

**However, a stale reference COULD exist if:**
- A running frontend instance had the provider in memory before it was deleted from the backend.
- The user had selected that provider and kept the browser window open.
- The user clicked "Test Connection" on the stale in-memory provider.
- Result: HTTP 404 from backend (provider row not found in DB).

---

## Detailed Component Trace

**POST /iptv/providers/:providerId/test call chain:**

1. **User interaction**: Click "Test Connection" button in UI
   - Location: [apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx](apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx) line 240-241

2. **Event handler**: `handleTestProvider()` in IptvManagementScreen
   - Location: [apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx](apps/desktop/src/renderer/features/iptv/IptvManagementScreen.tsx) line 102
   - Checks: if `selectedProviderId && onTestProviderById` then call prop handler

3. **Prop provider**: `onTestProviderById` callback passed from App component
   - Location: [apps/desktop/src/renderer/App.tsx](apps/desktop/src/renderer/App.tsx) line 435
   - Implementation:
     ```typescript
     const testProviderById = useCallback(async (providerId: string) => {
       if (backendStatus !== "online") throw new Error("backend_offline");
       const result = await apiClient.testProviderById(providerId);
       await refreshOperations("full");
       return result;
     }, [backendStatus, refreshOperations]);
     ```

4. **API client**: `apiClient.testProviderById(providerId)`
   - Location: [apps/desktop/src/renderer/services/api-client.ts](apps/desktop/src/renderer/services/api-client.ts) line 84
   - Implementation:
     ```typescript
     testProviderById(providerId: string) {
       return request(`/iptv/providers/${providerId}/test`, { method: "POST" });
     }
     ```

5. **Backend route**: POST /iptv/providers/:providerId/test
   - Location: [apps/backend/src/routes/iptv.ts](apps/backend/src/routes/iptv.ts) line 183
   - Behavior: Returns 404 if provider not found in DB

---

## Storage Analysis Table

| Storage Medium | Contains provider ID? | Persists across reload? | Can cause stale test call? |
|---|---|---|---|
| React component state (IptvManagementScreen) | selectedProviderId, not hardcoded | NO | NO |
| localStorage | providers array only, not selectedProviderId | YES | NO (selectedProviderId not persisted) |
| sessionStorage | NOT USED | N/A | NO |
| Electron main process | NO state persistence | N/A | NO |
| Electron preload API | NO provider data exposed | N/A | NO |
| URL query params | Not observed in codebase | N/A | NO |
| Environment config | Not found | N/A | NO |

---

## Conclusion

The stale provider ID `9fe16532-ac82-4650-9ae7-2dfab9f575f9` is **NOT** stored in any persistent storage mechanism:
- Not in React component state (component-local only)
- Not in localStorage (selectedProviderId explicitly excluded from persisted state)
- Not in sessionStorage (not used)
- Not in Electron config (no persistence layer)

**After a full page reload, the stale provider ID completely disappears from the frontend.** 

The only scenario where a stale reference could exist is:
- A long-running browser session where the provider was in App state before deletion
- User still has the provider selected in memory
- User clicks "Test Connection" before the next backend refresh
- But even then, the backend would reject it with 404 (provider row absent from DB)

**No persistence mechanism exists to cause the provider ID to "ghost" in the UI after reload.**

Evidence-only audit complete.
