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

Salon users and platform admins use the same phone-and-password `/login` screen; the server chooses the account. A new salon owner moves through phone OTP, password creation, agreement acceptance, manual-transfer receipt upload, and admin review before product access. Pending owners can sign in but cannot open product screens. These signup/agreement/transfer write paths are disabled by default on the API. Platform admin UI includes message queues, VIP lists, and the activation-receipt review at `/admin/activation-receipts`. Salon VIP lives on the Opportunities flow when entitled.

See `docs/current-state-system-spec.md` for the screen inventory.
