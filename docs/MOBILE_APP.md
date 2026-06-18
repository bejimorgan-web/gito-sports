# Mobile App

The mobile app is the viewer-facing live streaming application.

## Technology

- Flutter.
- Platform targets: Android first, iOS when required.
- Backend API integration for approved match and stream metadata.

## MVP Capabilities

- List competitions and scheduled matches.
- Show live and upcoming matches.
- Play approved live streams.
- Display match metadata clearly.
- Handle unavailable streams gracefully.

## Boundaries

- Mobile does not manage approvals.
- Mobile only consumes approved stream metadata.
- Mobile should not contain IPTV provider credentials.

