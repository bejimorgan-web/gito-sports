# LOGO_DATA_LOSS_TRACE_REPORT

## Chosen sport across every layer

- Sport ID: `40658823-67c2-4564-8974-3ac180f8bb4e`
- Sport name: `Soccer`
- Backend database file: `apps/backend/data/gito.sqlite`

---

## 1. SQLite row

Source: `apps/backend/data/gito.sqlite`.

Query result for the chosen sport:

- `rowid`: `2`
- `id`: `40658823-67c2-4564-8974-3ac180f8bb4e`
- `name`: `Soccer`
- `slug`: `soccer`
- `status`: `active`
- `created_at`: `2026-05-30T00:24:52.916Z`
- `updated_at`: `2026-05-31T19:48:59.148Z`
- `logo_url`: `http://localhost:4100/uploads/1780256925486-v1iypx.png`
- `countryIds`: `[]`

This confirms the database row contains a non-null `logo_url`.

---

## 2. Repository mapping

File: `apps/backend/src/repositories/sports-repository.ts`

Mapping function:

```ts
export function listSports(): Sport[] {
  const rows = getDatabase()
    .prepare("SELECT id, name, slug, logo_url, status, created_at, updated_at FROM sports ORDER BY name")
    .all() as SportRow[];

  return rows.map(mapSport);
}

function mapSport(row: SportRow): Sport {
  const database = getDatabase();
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.logo_url ? { logoUrl: row.logo_url } : {}),
    countryIds: listSportCountryIds(database, row.id)
  };
}
```

For this sport, `row.logo_url` is defined, so `logoUrl` is included in the mapped `Sport` object.

---

## 3. Route serialization / GET /sports response

File: `apps/backend/src/routes/sports.ts`

The route returns:

```ts
response.json({ data: listSports().map((sport) => normalizeSport(request, sport)) });
```

`normalizeSport` is defined in `apps/backend/src/routes/asset-url.ts` and only rewrites URLs starting with `/uploads/`.

```ts
export function normalizeSport(request: Request, sport: Sport): Sport {
  if (!sport.logoUrl) {
    return sport;
  }

  return {
    ...sport,
    logoUrl: normalizeAssetUrl(request, sport.logoUrl)
  };
}
```

Because the sport row already contains an absolute URL, the route response preserves it unchanged.

### Exact GET `/sports` response JSON fragment for the sport

```json
{
  "id": "40658823-67c2-4564-8974-3ac180f8bb4e",
  "name": "Soccer",
  "slug": "soccer",
  "status": "active",
  "createdAt": "2026-05-30T00:24:52.916Z",
  "updatedAt": "2026-05-31T19:48:59.148Z",
  "logoUrl": "http://localhost:4100/uploads/1780256925486-v1iypx.png",
  "countryIds": []
}
```

Full response envelope is:

```json
{
  "data": [
    {
      "id": "40658823-67c2-4564-8974-3ac180f8bb4e",
      "name": "Soccer",
      "slug": "soccer",
      "status": "active",
      "createdAt": "2026-05-30T00:24:52.916Z",
      "updatedAt": "2026-05-31T19:48:59.148Z",
      "logoUrl": "http://localhost:4100/uploads/1780256925486-v1iypx.png",
      "countryIds": []
    }
  ]
}
```

---

## 4. API client response object received by desktop

File: `apps/desktop/src/renderer/services/api-client.ts`

The client code unwraps the response body and returns `body.data`.

```ts
const body = (await response.json()) as { data: T };
return body.data;
```

For `apiClient.listSports()`, the desktop receives a `Sport[]` array. The object for the chosen sport is exactly:

```ts
{
  id: "40658823-67c2-4564-8974-3ac180f8bb4e",
  name: "Soccer",
  slug: "soccer",
  status: "active",
  createdAt: "2026-05-30T00:24:52.916Z",
  updatedAt: "2026-05-31T19:48:59.148Z",
  logoUrl: "http://localhost:4100/uploads/1780256925486-v1iypx.png",
  countryIds: []
}
```

No additional transformation is applied to `logoUrl` in the desktop API client.

---

## 5. SportsWorkspaceScreen props/state exact sport object

File: `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`

`loadData()` loads the sports list and stores it in React state:

```ts
const [sports, setSports] = useState<Sport[]>([]);

const loadData = async () => {
  const [sportsData, countriesData, competitionData, teamData] = await Promise.all([
    apiClient.listSports(),
    apiClient.listCountries(),
    apiClient.listCompetitions(),
    apiClient.listTeams()
  ]);

  setSports(sportsData);
  // ...
};
```

The selected sport remains the exact object returned from `apiClient.listSports()`.

When a sport card is rendered:

```tsx
<EntityAvatar src={sport.logoUrl} fallback={sport.name} />
```

So the prop source is `sport.logoUrl` directly from React state.

Exact desktop sport object in state for the chosen sport is the same as the API client object:

```ts
{
  id: "40658823-67c2-4564-8974-3ac180f8bb4e",
  name: "Soccer",
  slug: "soccer",
  status: "active",
  createdAt: "2026-05-30T00:24:52.916Z",
  updatedAt: "2026-05-31T19:48:59.148Z",
  logoUrl: "http://localhost:4100/uploads/1780256925486-v1iypx.png",
  countryIds: []
}
```

---

## 6. EntityAvatar props exact `src` value

File: `apps/desktop/src/renderer/features/sports/SportsWorkspaceScreen.tsx`

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

For the chosen sport, the `EntityAvatar` prop is:

- `src`: `http://localhost:4100/uploads/1780256925486-v1iypx.png`
- `fallback`: `Soccer`

`resolveAssetUrl(src)` returns the same absolute URL unchanged.

---

## Conclusion: where does `logo_url` become null/undefined?

For sport ID `40658823-67c2-4564-8974-3ac180f8bb4e`, `logo_url` is present at every traced layer:

- SQLite row: present
- Repository mapping: preserved as `logoUrl`
- Route serialization: preserved in GET `/sports` response
- API client: preserved when unwrapping `body.data`
- React state: preserved in `sports` array and selected sport state
- `EntityAvatar` prop: receives the absolute URL

**Answer:** it does not become null/undefined in this trace. The logo value is preserved all the way through the traced path.

If the logo is still not rendering, the issue is not loss of `logoUrl` on this exact sport ID; it is likely either:

- a different sport selection with no `logoUrl`, or
- `resolveAssetUrl` returning falsy for an empty/blank value, or
- a rendering condition in `EntityAvatar` that falls back to initials when `resolvedSrc` is falsy.
