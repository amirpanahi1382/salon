# Flutter client

Persian-first client for the Beauty Salon Revenue Intelligence platform. It is not a booking app.

```bash
cd apps/mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:3000
```

- Android emulator default host is `http://10.0.2.2:3000` unless `API_BASE_URL` is set (`lib/core/config/api_config.dart`).
- Physical devices should use the machine LAN IP, for example `flutter run --dart-define=API_BASE_URL=http://192.168.1.10:3000`.
- Production builds must use HTTPS.

Customers can be added one by one or imported from Excel (Name and Phone). Phones must be `09` + 9 digits.

Platform admin UI: `/admin/login`, message queue, VIP lists. Salon VIP lives on the Opportunities flow when entitled.

See `docs/current-state-system-spec.md` for the screen inventory.
