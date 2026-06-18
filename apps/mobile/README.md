# GiTO Mobile App

Open the app, tap a live match, then press WATCH LIVE.

The mobile viewer reads live match data from:

```bash
GET /mobile/matches/live
```

Default API base URL:

```bash
http://10.0.2.2:4100
```

To run locally with a custom API URL:

```bash
flutter run --dart-define=GITO_API_BASE_URL=http://localhost:4100
```
