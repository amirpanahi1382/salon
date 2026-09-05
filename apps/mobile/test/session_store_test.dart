import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/storage/session_store.dart';

void main() {
  test(
    'memory session store persists and clears without storing a password',
    () async {
      final store = MemorySessionStore();
      await store.write(
        const StoredSession(
          accessToken: 'token',
          userId: 'u1',
          tenantId: 't1',
          role: 'OWNER',
          name: 'Leila',
          email: 'leila@example.test',
        ),
      );
      final stored = await store.read();
      expect(stored?.accessToken, 'token');
      expect(stored?.toJson().containsKey('password'), isFalse);
      await store.clear();
      expect(await store.read(), isNull);
    },
  );
}
