# GiTO Live Sports — Product Hardening Audit Matrix

## DESKTOP RESPONSIVENESS AUDIT

### 1. IPTV PROVIDERS SCREEN
| Action | Request | Current State | Issue | Fix Priority |
|--------|---------|---------------|-------|--------------|
| Validate & Save | POST /providers + test connection | Shows "Validating…" then "Saving…" | Good state tracking | ✓ VERIFIED |
| Validate Connection | GET provider test | Shows "Validating…" | Good | ✓ VERIFIED |
| Delete Provider | DELETE /providers/{id} | Sets status but may not prevent re-click | Needs duplicate-prevention | MEDIUM |
| Set Status (Activate/Deactivate) | PUT /providers/{id}/status | Shows "Updating…" | Missing visual feedback | HIGH |

**FINDING**: Provider screen has basic loading states but "Set Status" lacks immediate feedback. Button remains visually idle during status change.

---

### 2. IPTV IMPORT SCREEN  
| Action | Request | Current State | Issue | Fix Priority |
|--------|---------|---------------|-------|--------------|
| Sync Xtream | POST /iptv/operations (xtream_channel_sync) | Starts operation, shows progress | ✓ GOOD - uses operations | ✓ VERIFIED |
| Validate M3U | POST /iptv/operations (m3u_validation) | Starts operation, shows progress | ✓ GOOD | ✓ VERIFIED |
| Import M3U | POST /iptv/operations (m3u_import) | Starts operation, shows progress | ✓ GOOD | ✓ VERIFIED |

**FINDING**: Import screen correctly uses background operations. No immediate issue.

---

### 3. IPTV CHANNELS LIST
| Scenario | Current Behavior | Issue | Fix Priority |
|----------|------------------|-------|--------------|
| Load 28k channels | All loaded client-side into React state | PERFORMANCE: Renders all channels at once; no pagination | CRITICAL |
| Filter by provider | useMemo filters entire list | Performance degrades with size | CRITICAL |
| Search | useMemo filters entire list | No server-side search; all filtering client-side | CRITICAL |
| Category filter | useMemo filters entire list | Client-side only | CRITICAL |

**FINDING**: Channel list is the single largest bottleneck. No pagination implemented on desktop. Renders tens of thousands of channel objects in a single component.

---

### 4. NEWS WORKSPACE SCREEN
| Action | Request | Current State | Issue | Fix Priority |
|--------|---------|---------------|-------|--------------|
| Research Article | GET /news/{id}/research | `researchLoading` state; status text shows | ✓ GOOD state tracking | ✓ VERIFIED |
| Generate Draft | POST /news/{id}/generate | `isGeneratingDraft` state; but VERY large component (400+ lines) | Large component, hard to trace state | MEDIUM |
| Classify (AI) | POST /news/{id}/classify | `aiClassificationStatus` state | ✓ GOOD | ✓ VERIFIED |
| Approve Classification | PUT /news/{id}/categories | No explicit loading state shown to user | Missing feedback | MEDIUM |
| Publish Article | POST /news/{id}/publish | Status shown in text, no dedicated button feedback | Missing visual feedback | MEDIUM |

**FINDING**: News has loading states but:
1. Component is 400+ lines and extremely complex
2. No explicit button visual feedback for approve/publish
3. Full refresh of article list after mutations (expensive)
4. No pagination on article list

---

### 5. MOBILE APP CONFIGURATION
| Action | Request | Current State | Issue | Fix Priority |
|--------|---------|---------------|-------|--------------|
| Load Features | GET /mobile/features | Loading spinner shown | ✓ GOOD | ✓ VERIFIED |
| Toggle Feature | (local state only) | Instant, no request | ✓ GOOD | ✓ VERIFIED |
| Save Changes | PUT /api/admin/mobile/features | "Saving…" shown; disabled during save | ✓ GOOD | ✓ VERIFIED |
| Error handling | Failed requests | Shows error toast + status message | ✓ GOOD | ✓ VERIFIED |

**FINDING**: Mobile configuration screen is well-implemented. No issues found.

---

### 6. SPORTS WORKSPACE
| Action | Request | Current State | Issue | Fix Priority |
|--------|---------|---------------|-------|--------------|
| Create/Update Sport | POST/PUT /sports | `isSaving` state; buttons disabled | ✓ GOOD | ✓ VERIFIED |
| Delete Sport | DELETE /sports/{id} | Confirmation prompt; status message | ✓ GOOD | ✓ VERIFIED |
| Upload Logo | POST /upload | `isLogoUploading` state tracked | ✓ GOOD | ✓ VERIFIED |

**FINDING**: Sports screen is properly implemented. No issues.

---

## ROOT CAUSES IDENTIFIED

### CRITICAL
1. **IPTV Channel List has No Pagination**
   - All 28k+ channels loaded into React state and rendered
   - No server-side pagination used (API supports it via `listChannelPage`)
   - Desktop filters 28k channels client-side
   - Will freeze when list grows further

2. **News Workspace Component Massive & Complex**
   - 400+ lines in single component
   - Multiple independent state management concerns (articles, sources, research, classification, etc.)
   - Full data reload after mutations instead of targeted updates
   - Makes it hard to add proper button feedback

### HIGH
3. **Missing Visual Feedback on IPTV Status Changes**
   - "Activate / Deactivate" provider buttons don't show "Activating…" / "Deactivating…"
   - Button appears frozen to user
   - No duplicate-click prevention

4. **News Approval & Publish Actions Lack Button Feedback**
   - Buttons don't change state during operations
   - User doesn't know if click was registered

### MEDIUM
5. **No Server-Side Channel Search**
   - Desktop filters by search/category/provider entirely client-side
   - Should use server-side filtering for 28k channel dataset

---

## PLANNED FIXES (IN ORDER)

1. ✓ **Local admin auth** (completed in previous session)
2. **IPTV Channel Pagination** (fixes largest bottleneck)
3. **IPTV Provider Status Button Feedback** (quick win)
4. **News Button Visual Feedback** (medium refactor)
5. **Mobile Config Verification** (already good)
6. **Render Backend Testing** (dependency on #2-4)
7. **Full Build & Test Matrix** (validation)

---

## API CAPABILITIES VERIFIED

✓ IPTV Operations (background sync/import/validation)
✓ Channel Pagination support (`listChannelPage`)
✓ Channel Search/Filter support
✓ Mobile Feature configuration
✓ News Article operations
✓ Provider status updates

All APIs exist; UX issue is primarily in desktop component implementation, not backend capability.
