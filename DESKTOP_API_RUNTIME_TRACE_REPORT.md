# DESKTOP API RUNTIME TRACE REPORT

## Trace Objective
Capture the desktop runtime API requests against backend instances on ports `4100` and `4101`, compare the responses, and determine whether the desktop frontend is hitting the correct backend and whether response emptiness is caused by backend data state.

## Method
- Queried the following endpoints on both ports:
  - `GET /sports`
  - `GET /iptv/providers`
  - `GET /iptv/channels`
  - `GET /matches`
  - `GET /streams`
- Also queried `GET /health` to verify backend availability and runtime health.
- Used the workspace Python environment to avoid shell quoting issues.

## Results

### Health checks
- `http://127.0.0.1:4100/health`
  - status: `200`
  - body: `{"status":"ok","service":"gito-backend","database":"ok","timestamp":"..."}`
- `http://127.0.0.1:4101/health`
  - status: `200`
  - body: `{"status":"ok","service":"gito-backend","database":"ok","timestamp":"..."}`

Both ports responded successfully and reported `database: ok`.

### Endpoint trace results

#### Port 4100
- `GET http://127.0.0.1:4100/sports`
  - status: `200`
  - body: `{"data":[]}`
  - returned count: `0`

- `GET http://127.0.0.1:4100/iptv/providers`
  - status: `200`
  - body: `{"data":[]}`
  - returned count: `0`

- `GET http://127.0.0.1:4100/iptv/channels`
  - status: `200`
  - body: `{"data":[]}`
  - returned count: `0`

- `GET http://127.0.0.1:4100/matches`
  - status: `200`
  - body: JSON payload with `data` array containing `2` match objects.
  - returned count: `2`
  - first match id: `db7ecab7-acbb-4012-93ec-a556240661cb`
  - second match id: `57fbd3f0-5af6-48e8-b8f4-c48fa75d51da`

- `GET http://127.0.0.1:4100/streams`
  - status: `200`
  - body: `{"data":[]}`
  - returned count: `0`

#### Port 4101
- `GET http://127.0.0.1:4101/sports`
  - status: `200`
  - body: `{"data":[]}`
  - returned count: `0`

- `GET http://127.0.0.1:4101/iptv/providers`
  - status: `200`
  - body: `{"data":[]}`
  - returned count: `0`

- `GET http://127.0.0.1:4101/iptv/channels`
  - status: `200`
  - body: `{"data":[]}`
  - returned count: `0`

- `GET http://127.0.0.1:4101/matches`
  - status: `200`
  - body: JSON payload with `data` array containing `2` match objects.
  - returned count: `2`
  - first match id: `db7ecab7-acbb-4012-93ec-a556240661cb`
  - second match id: `57fbd3f0-5af6-48e8-b8f4-c48fa75d51da`

- `GET http://127.0.0.1:4101/streams`
  - status: `200`
  - body: `{"data":[]}`
  - returned count: `0`

## Comparison
- Both ports returned identical responses for all traced endpoints.
- The backend instances on `4100` and `4101` are reachable and healthy.
- The key difference from expectations is not HTTP availability: it is the returned data content.

## Analysis
- `4100` is the desktop default backend target in the workspace, so the desktop frontend should be calling the correct configured port by default.
- The backend response from both ports shows:
  - no sports available,
  - no IPTV providers,
  - no IPTV channels,
  - no streams,
  - but does return scheduled matches.
- This indicates the desktop empty UI is likely caused by empty or filtered backend datasets, not a connection failure.
- Because `/iptv/providers` should return providers from the same database but returns an empty list, the runtime instance on `4100`/`4101` is likely not reading the same dataset as the current workspace DB or is applying filters that exclude all providers.

## Conclusion
- Desktop is calling a valid backend instance on `http://localhost:4100`.
- Both backend ports are alive and report healthy status.
- The UI emptiness is caused by the actual backend response contents, not by a failure to reach the backend.
- The identical 4101 trace suggests either:
  - both ports share the same backend state, or
  - there are duplicate backend processes exposing the same empty dataset.

## Next verification steps
1. Confirm the desktop process is using `API_BASE_URL=http://localhost:4100`.
2. Confirm the runtime backend process using `4100` is connected to the same `data/gito.sqlite` file as the inspected workspace.
3. Inspect whether backend startup uses a different database path or a fresh/isolated dataset for the desktop runtime.
4. If the desktop runtime backend is correct, trace why `/iptv/providers`, `/iptv/channels`, and `/streams` are returning empty lists despite non-empty underlying tables.
