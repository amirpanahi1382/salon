# Flutter MVP

Mobile client for the Beauty Salon Revenue Intelligence platform.

It consumes the existing Phase 5 API. It is not a booking app.

Customers can be added one by one or imported from Excel (Name and Phone columns). Phone numbers must be exactly 11 digits and start with 09, for example 09121111111.

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:3000
```

Android emulator default API host is `http://10.0.2.2:3000` unless `API_BASE_URL` is set.

Physical devices should use your machine LAN IP, for example:

```bash
flutter run --dart-define=API_BASE_URL=http://192.168.1.10:3000
```

Production builds must use HTTPS.
