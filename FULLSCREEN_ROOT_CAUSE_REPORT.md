# Fullscreen Root Cause Report

## Root Cause

The fullscreen player regression was caused by route-based fullscreen rendering that duplicated the playback surface. The previous fullscreen implementation pushed `FullScreenPlaybackScreen`, mounted another `VideoPlayer`, and could create or dispose a second `VideoPlayerController` when a shared controller was unavailable. This introduced a second video texture during the portrait-to-landscape transition.

That duplicate texture path allowed audio to continue from the controller while the visible video texture went black. Returning to portrait left the original route with a stale or disrupted texture, so audio continued but the portrait video stayed black until navigation recreated playback.

## Fix

Fullscreen is now a state of `PlaybackScreen`, not a second route. The implementation keeps one `VideoPlayerController.networkUrl` and one `VideoPlayer` widget in `apps/mobile/lib/main.dart`.

- Removed the obsolete `FullScreenPlaybackScreen`.
- Removed fullscreen `Navigator.push`.
- Removed duplicate fullscreen controller ownership/disposal.
- Removed duplicate fullscreen `VideoPlayer` texture creation.
- Added `_enterFullscreen()` and `_exitFullscreen()` to change orientation and system UI in place.
- Added `_buildVideoSurface()` as the single video rendering surface for portrait and landscape.

## Validation

Static fullscreen audit:

- `VideoPlayerController.networkUrl`: one occurrence.
- `VideoPlayer(...)`: one occurrence.
- `FullScreenPlaybackScreen`: zero occurrences.
- Forbidden duplicated fullscreen route implementation: removed.

Build validation:

- `flutter analyze`: no issues found.
- `flutter build bundle`: completed successfully.

Runtime validation still requires a device or emulator with a playable stream to visually confirm continuous portrait to landscape to portrait rendering.
