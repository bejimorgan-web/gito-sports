# Operator Guide

This guide is for match-day operators.

## Daily Startup

1. Start the backend.
2. Open the desktop app.
3. Confirm backend status is online.
4. Check provider status.
5. Enter LIVE MODE only when actively monitoring live broadcasts.

## IPTV Provider Setup

1. Open IPTV management.
2. Add provider name, base URL, type, and credentials if required.
3. Test the provider connection.
4. Ingest M3U playlist or sync Xtream channels.
5. Confirm channels appear in the channel list.

## Channel Preview

1. Select a channel.
2. Watch the preview panel.
3. Wait for a stable signal.
4. Do not assign a match until preview is confirmed.

## Match Creation And Assignment

1. Select the previewed IPTV channel.
2. Enter competition, home team, away team, sport, and kickoff time.
3. Assign the previewed stream.
4. Confirm the work item moves to approval.

## Stream Approval

1. Confirm the preview matches the intended event.
2. Confirm signal stability.
3. Approve the stream.
4. Do not publish if the stream is degraded unless operationally acceptable.

## Publishing

1. Confirm the approved stream and match metadata.
2. Click Publish Live.
3. Confirm status shows live/published.
4. Verify the mobile feed if possible.

## LIVE MODE

Use LIVE MODE during active broadcasts.

LIVE MODE shows:

- live matches
- actionable alerts
- backend or provider risk
- failed stream states

Exit LIVE MODE for setup tasks such as provider ingestion or match assignment.

## Troubleshooting

- Backend offline: keep monitoring cached state, then retry when online.
- Provider unstable: preview again before publishing.
- Stream failed: choose another source and repeat preview/assignment/approval.
- Mobile viewer cannot see match: verify match is published and stream is active.
- Wrong stream assigned: do not publish; assign the correct previewed channel.
