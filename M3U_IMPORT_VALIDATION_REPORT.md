# M3U Import Validation Report

## Summary

- Provider created successfully and M3U playlist ingested using `/iptv/providers/:providerId/m3u`.
- `channelsParsed`: 4
- `channelsCreated`: 4
- `channelsRejected`: 0
- Categories identified: 2 (`Sports`, `News`)
- SQLite verification confirmed provider and channel records.
- `GET /iptv/channels?providerId=<provider_id>` returned the imported channels.
- Activation gating worked: provider deactivated and reactivated successfully.
- Persistence verified after backend restart: provider, channels, and categories remained available.

## Provider

- Provider ID: `5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5`
- Provider name: `Lifecycle M3U Import Test Provider`

## Import results

### POST /iptv/providers

```json
{
  "status": 201,
  "body": {
    "data": {
      "id": "5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5",
      "name": "Lifecycle M3U Import Test Provider",
      "baseUrl": "https://example.com/playlist.m3u",
      "type": "m3u",
      "authType": "none",
      "status": "pending",
      "availabilityStatus": "unknown",
      "failedChannelLoads": 0,
      "healthScore": 100
    }
  }
}
```

### POST /iptv/providers/:providerId/m3u

```json
{
  "status": 201,
  "body": {
    "data": {
      "channelsCreated": 4,
      "channelsParsed": 4,
      "channelsRejected": 0,
      "categories": ["Sports", "News"],
      "rejectedChannels": []
    }
  }
}
```

## Channel verification

### GET /iptv/channels?providerId=5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5

```json
{
  "status": 200,
  "body": {
    "data": [
      {"name": "Channel 3", "url": "https://stream3.example.com/live.m3u8", "groupName": "News"},
      {"name": "Channel 4", "url": "https://stream4.example.com/live.m3u8", "groupName": "News"},
      {"name": "Channel 1", "url": "https://stream1.example.com/live.m3u8", "groupName": "Sports"},
      {"name": "Channel 2", "url": "https://stream2.example.com/live.m3u8", "groupName": "Sports"}
    ]
  }
}
```

## Category verification

### GET /iptv/categories?providerId=5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5 (after restart)

```json
{
  "status": 200,
  "body": {
    "data": ["News", "Sports"]
  }
}
```

> Note: the pre-restart categories endpoint returned an empty array, while the post-restart query returned the two categories correctly.

## SQLite evidence

### Provider row

```json
[
  {
    "id": "5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5",
    "name": "Lifecycle M3U Import Test Provider",
    "status": "active",
    "availability_status": "unknown",
    "created_at": "2026-05-30T11:48:55.635Z",
    "updated_at": "2026-05-30T11:48:58.486Z"
  }
]
```

### Channels table

```json
[
  {"name": "Channel 1", "url": "https://stream1.example.com/live.m3u8", "group_name": "Sports", "status": "active"},
  {"name": "Channel 2", "url": "https://stream2.example.com/live.m3u8", "group_name": "Sports", "status": "active"},
  {"name": "Channel 3", "url": "https://stream3.example.com/live.m3u8", "group_name": "News", "status": "active"},
  {"name": "Channel 4", "url": "https://stream4.example.com/live.m3u8", "group_name": "News", "status": "active"}
]
```

### Categories in SQLite

```json
[
  {"group_name": "Sports"},
  {"group_name": "News"}
]
```

## Activation gating

### POST /iptv/providers/:providerId/status {"status": "inactive"}

```json
{
  "status": 200,
  "body": {
    "data": {
      "id": "5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5",
      "status": "inactive"
    }
  }
}
```

### POST /iptv/providers/:providerId/status {"status": "active"}

```json
{
  "status": 200,
  "body": {
    "data": {
      "id": "5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5",
      "status": "active"
    }
  }
}
```

## Persistence after backend restart

### GET /iptv/providers/:providerId

```json
{
  "status": 200,
  "body": {
    "data": {
      "id": "5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5",
      "status": "active"
    }
  }
}
```

### GET /iptv/channels?providerId=5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5

```json
{
  "status": 200,
  "body": {
    "data": [
      {"name": "Channel 3", "groupName": "News"},
      {"name": "Channel 4", "groupName": "News"},
      {"name": "Channel 1", "groupName": "Sports"},
      {"name": "Channel 2", "groupName": "Sports"}
    ]
  }
}
```

### SQLite persistence after restart

```json
{
  "provider": [
    {"id": "5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5", "status": "active"}
  ],
  "channels": [
    {"name": "Channel 1", "group_name": "Sports"},
    {"name": "Channel 2", "group_name": "Sports"},
    {"name": "Channel 3", "group_name": "News"},
    {"name": "Channel 4", "group_name": "News"}
  ],
  "categories": [
    {"group_name": "Sports"},
    {"group_name": "News"}
  ]
}
```
