import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/outreach/manual_outreach_selection.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

Customer _customer(int index) {
  return Customer(
    id: 'c$index',
    firstName: 'C$index',
    lastName: 'L',
    phoneNumber: '0912111111${index % 10}',
    createdAt: DateTime.utc(2026, 1, 1),
    updatedAt: DateTime.utc(2026, 1, 1),
  );
}

void main() {
  test('selection mode caps at 30 unique customers and clears on logout', () async {
    final container = ProviderContainer(
      overrides: [
        sessionStoreProvider.overrideWithValue(MemorySessionStore()),
        authRepositoryProvider.overrideWithValue(
          AuthRepository(
            api: ApiClient(
              baseUrl: 'http://example.test',
              sessionStore: MemorySessionStore(),
            ),
            sessionStore: MemorySessionStore(),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);

    final outreach = container.read(manualOutreachSelectionProvider.notifier);
    expect(container.read(manualOutreachSelectionProvider).selecting, isFalse);

    outreach.enterSelection();
    expect(container.read(manualOutreachSelectionProvider).selecting, isTrue);

    for (var i = 0; i < 30; i++) {
      expect(outreach.toggle(_customer(i)), isTrue);
    }
    expect(container.read(manualOutreachSelectionProvider).selectedCount, 30);
    expect(outreach.toggle(_customer(0)), isTrue);
    expect(container.read(manualOutreachSelectionProvider).selectedCount, 29);
    expect(outreach.toggle(_customer(0)), isTrue);
    expect(outreach.toggle(_customer(30)), isFalse);
    expect(container.read(manualOutreachSelectionProvider).selectedCount, 30);
    expect(
      container.read(manualOutreachSelectionProvider).limitMessage,
      AppStrings.selectionLimitReached,
    );

    outreach.confirmAndFocusOpportunities();
    expect(container.read(manualOutreachSelectionProvider).selecting, isFalse);
    expect(container.read(manualOutreachSelectionProvider).focusOutreachTab, isTrue);

    await container.read(authControllerProvider.notifier).logout();
    await Future<void>.delayed(Duration.zero);
    expect(container.read(manualOutreachSelectionProvider).customers, isEmpty);
    expect(container.read(manualOutreachSelectionProvider).selecting, isFalse);
  });
}
