$path = 'c:\Users\morga\Desktop\Apps\Stream\GiTO Live Sports\apps\shared\src\sync\background-sync.ts'
$content = @'
/**
 * Background Sync Service
 *
 * Lightweight fallback sync loop that runs every 30-60 seconds.
 * Refetches IPTV channels, live scores, and stream status.
 * Does NOT override newer event-driven state (events take priority).
 */

export { getBackgroundSyncService } from "./background-sync-locked";
'@
[System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::UTF8)
