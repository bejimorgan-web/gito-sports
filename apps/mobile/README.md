# GiTO Mobile App

Open the app, tap a live match, then press WATCH LIVE.

The mobile viewer reads live match data from:

```bash
GET /mobile/matches/live
```

Default API base URL:

```text
https://gito-sports.onrender.com
```

To run locally with a custom API URL:

```bash
flutter run --dart-define=API_URL=http://10.0.2.2:4100
```

For production builds point the app to the deployed Render backend:

```bash
flutter build apk --dart-define=API_URL=https://gito-sports.onrender.com
```
