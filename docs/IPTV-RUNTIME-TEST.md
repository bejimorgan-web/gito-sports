# IPTV Runtime Verification

This procedure is for testing real IPTV providers through the existing GiTO UI. GiTO does not proxy or relay IPTV media: the client connects directly to the saved provider stream URL.

## Runtime Setup

Open two PowerShell terminals at the repository root.

Terminal 1, backend:

```powershell
npm run dev -w apps/backend
```

The backend reads `.env`, uses `DATABASE_PATH=data/gito.sqlite`, and listens on `http://localhost:4100` by default.

Terminal 2, desktop Vite and Electron:

```powershell
npm run electron:dev -w apps/desktop
```

Vite listens on `http://localhost:4200`. Electron waits for that URL and loads the desktop renderer. The renderer uses `VITE_API_URL` when configured; for local development set it in an uncommitted local environment file to `http://localhost:4100` or use the existing development fallback. Do not put provider credentials in `.env`, source files, fixtures, or committed documentation.

Confirm the backend before opening the desktop app:

```powershell
Invoke-WebRequest http://localhost:4100/health
```

The response should report an available database.

## Enable Runtime Diagnostics

Diagnostics are opt-in and are disabled by default.

After the desktop app opens and the renderer DevTools is available, run:

```js
localStorage.setItem("GITO_IPTV_DIAGNOSTICS", "1");
location.reload();
```

Open the Console and Network panels. Filter Console output by `GITO-PREVIEW` or `GITO-SELECTION-TRACE`. Filter Network requests by `m3u8`, `m4s`, `ts`, or the provider hostname.

To disable diagnostics after testing:

```js
localStorage.removeItem("GITO_IPTV_DIAGNOSTICS");
location.reload();
```

Diagnostic URLs are redacted before logging. Do not share unfiltered browser exports if they contain provider query parameters or credentials.

## Authentication

Sign in through the normal desktop login screen using the local development operator account configured for the environment. Do not record the password in this document or in a repository file.

## M3U Test

1. Open IPTV Management and choose **Add an account**.
2. Enter an account name.
3. Choose **Force M3U** or leave source type on **Auto-detect**.
4. Enter the real M3U playlist URL in **Base URL / Playlist**.
5. Choose **Create & Save**. GiTO validates the playlist, persists channels, and preserves group metadata. For an existing provider, use **Validate & Save** after changing the URL.
6. Confirm the provider becomes active and its channel count is populated.
7. Open the IPTV Content Browser for that provider. Confirm the real channel names and original groups are visible.
8. Select one channel known to play continuously. Record its provider ID, channel ID, name, content type, and redacted saved URL.
9. Leave it selected long enough to observe `currentTime` progression and repeated fragment events.
10. Select the channel previously reported to stop. Repeat the same observation window and capture the same evidence.

The direct import controls can also be used for a playlist body: select the saved M3U provider, use the existing M3U import control, and follow the operation progress. Do not paste or save credentials in the repository; a playlist containing credentials belongs only in the protected UI request flow and should not be included in logs or screenshots.

## Xtream Test

1. Open IPTV Management and choose **Add an account**.
2. Enter an account name.
3. Choose **Force Xtream**.
4. Enter the real server/host URL, username, and password in the UI fields.
5. Choose **Validate Connection** and wait for the validation result.
6. Choose **Create & Save**. Provider creation starts the canonical full Xtream synchronization. For an existing provider, **Validate & Save** followed by the existing Xtream sync action starts the same canonical operation.
7. Wait for operation progress to complete. Confirm live categories and channels appear. Confirm movies, series, seasons, and episodes only where the provider supplies them.
8. Select one live Xtream channel from the Content Browser.
9. Capture the saved URL from diagnostics only in redacted form. Verify the hostname, protocol, path, and stream identifier using the provider UI/network request, without sharing username or password.
10. Observe the manifest and fragment requests in Network and the matching HLS diagnostics in Console.

Credentials are entered in the desktop form, sent to the backend through the existing authenticated provider API, and stored using the existing provider credential columns. They are used server-side for Xtream API synchronization. Normal application logs and preview diagnostics must not contain complete credentials.

## Evidence To Capture

For each selected channel, preserve only redacted output containing:

- provider ID and provider type
- channel ID, channel name, and content type
- redacted saved/playback URL
- selected-channel changes and provider context
- preview session start, mount, and unmount
- HLS instance creation and cleanup reason
- manifest loading, loaded, and parsed events
- level loading/loaded events
- fragment loading, loaded, buffered, and aborted events
- HLS error type, detail, fatal flag, and HTTP response code when available
- native video events, `currentTime`, ready state, network state, pause/ended state, and media errors
- player state transitions and retry attempts
- channel refresh/polling start, result, failure, and auto-rebind events

Do not copy request headers, cookies, authorization values, query credentials, or complete Xtream stream URLs.

## Interpret The Trace

- **GiTO destroys the player:** `HLS_CLEANUP_DESTROY` appears with `component_unmount` or an unexpected replacement reason while the selected channel is unchanged.
- **Provider/network stops supplying media:** manifest and/or fragment requests begin failing, time out, or stop returning media while the preview remains mounted and the selected identity is unchanged.
- **Manifest failure:** `HLS_MANIFEST_LOADING` is followed by an HLS error without `HLS_MANIFEST_LOADED` or `HLS_MANIFEST_PARSED`.
- **Segment failure:** manifest parsing succeeds, but fragment requests report errors or never reach `HLS_FRAG_LOADED`/`HLS_FRAG_BUFFERED`.
- **Playback does not progress:** fragments load successfully, but `currentTime` remains unchanged and native video/HLS errors identify the media or decoder failure.
- **Normal playback:** the selected identity remains stable, the preview remains mounted, manifests and fragments load repeatedly, `currentTime` increases, and no unexpected cleanup occurs.

Do not change HLS configuration based only on a stop or buffer symptom. Change player code only when the trace shows a GiTO lifecycle or player-side cause.

## Cleanup

After testing, remove the diagnostic localStorage flag, sign out, and remove any screenshots or exported logs containing provider-specific data. Real provider credentials must never be committed.
