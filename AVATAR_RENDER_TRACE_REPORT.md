# AVATAR_RENDER_TRACE_REPORT

## Summary

The sports UI avatar rendering failure is rooted in `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`.

The `EntityAvatar` component receives `src={sport.logoUrl}` for each sport card, then resolves it using `resolveAssetUrl(src)`.

If the resolved value is falsy, the component renders fallback initials instead of an image.

---

## Component path

- `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`

## Exact component responsible

- `EntityAvatar` function inside `SportsWorkspaceScreen.tsx`

```tsx
function EntityAvatar({ src, fallback }: { src?: string | undefined; fallback: string }) {
  const resolvedSrc = resolveAssetUrl(src);

  return (
    <div className="entity-avatar">
      {resolvedSrc ? <img src={resolvedSrc} alt={fallback} /> : <span>{fallback.slice(0, 2).toUpperCase()}</span>}
    </div>
  );
}
```

## Render condition

The avatar renders an image only when:

- `resolveAssetUrl(src)` returns a truthy string

Otherwise it renders fallback initials.

Because `resolveAssetUrl()` returns `""` for empty or whitespace values, this means the failure mode is:

- `sport.logoUrl` is empty, undefined, or only whitespace

If `sport.logoUrl` were present and valid, the DOM would contain an `<img>` element.

## DOM evidence

For the sport card avatar, the rendered DOM is one of:

- Success path: `<div class="entity-avatar"><img src="..." alt="Sport Name" /></div>`
- Fallback path: `<div class="entity-avatar"><span>SP</span></div>`

The code proves that fallback initials are forced whenever `resolvedSrc` is falsy.

Because there is no broken-image fallback branch in `EntityAvatar`, showing initials is not caused by a bad URL load.

It is caused by the source being absent before rendering.

## What this means for the sports card

- A. Value received by avatar component: `src` is `sport.logoUrl`
- B. Avatar rendering condition: `resolvedSrc ? <img ... /> : <span>...</span>`
- C. Whether an element is created: no `<img>` is created when `resolvedSrc` is falsy
- D. Why fallback initials are displayed: `sport.logoUrl` is empty/undefined or normalizes to an empty resolveAssetUrl result
- E. Exact file/component responsible: `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`, `EntityAvatar`

## Related logic

- `resolveAssetUrl` is defined in `apps/desktop/src/renderer/components/asset-url.ts`
- It returns `""` when the value is missing or blank

```ts
export function resolveAssetUrl(value?: string) {
  if (!value?.trim()) {
    return "";
  }
  // ...
}
```

## Screenshots

Refer to existing workspace traces in:

- `reports/trace-sport-workspace.png`
- `reports/trace-sport-detail.png`

These images are the closest existing UI traces for the sports workspace and sport card rendering path.

## Conclusion

The UI failure is not in the upload endpoint or asset serving.

It is in the sports avatar render branch: no image is rendered because `sport.logoUrl` is absent or blank in the `SportsWorkspaceScreen` sports card data path.

The fix should be to ensure `sport.logoUrl` is populated correctly in the payload returned by `apiClient.listSports()` / backend, or to inspect why the stored sport record does not carry the logo URL into the sport list.
