# IPTV System

The IPTV system connects provider configuration, stream discovery, preview, and approval.

## Concepts

- Provider: an IPTV service or source owner.
- Stream source: a playable URL or channel entry from a provider.
- Preview: operator playback check before approval.
- Match stream: the assignment between a scheduled match and a stream source.

## MVP Provider Support

- Store provider connection metadata.
- Store stream source URLs.
- Support manual provider and stream entry first.
- Add playlist import after the manual workflow is stable.

## Approval Workflow

1. Operator creates or imports stream source.
2. Operator assigns stream source to a match.
3. Operator previews the stream.
4. Operator submits approval decision.
5. Approved streams become available to mobile clients.

## Security

- Keep IPTV credentials server-side.
- Mask sensitive provider fields in UI.
- Log approval events without logging full secrets.

