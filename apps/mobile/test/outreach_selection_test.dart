import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/outreach/manual_outreach_selection.dart';
import 'package:salon_mobile/features/outreach/manual_outreach_state.dart';
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

    outreach.markSubmitted(
      customerId: 'c0',
      messageRequestId: 'm0',
      status: 'QUEUED',
      requestedAt: DateTime.utc(2026, 9, 11),
    );
    expect(container.read(manualOutreachSelectionProvider).inbox, hasLength(30));
    expect(
      container.read(manualOutreachSelectionProvider).inbox.where((item) => item.submitted),
      hasLength(1),
    );
    outreach.ingestRequested([
      const OutreachCustomerRef(
        id: 'c0',
        fullName: 'C0 L',
        messageRequestId: 'm0',
        status: 'DISPATCHED',
      ),
    ]);
    expect(
      container
          .read(manualOutreachSelectionProvider)
          .inbox
          .firstWhere((item) => item.id == 'c0')
          .status,
      'DISPATCHED',
    );
    outreach.remove('c0');
    expect(
      container.read(manualOutreachSelectionProvider).inbox.where((item) => item.id == 'c0'),
      hasLength(1),
    );

    await container.read(authControllerProvider.notifier).logout();
    await Future<void>.delayed(Duration.zero);
    expect(container.read(manualOutreachSelectionProvider).customers, isEmpty);
    expect(container.read(manualOutreachSelectionProvider).requested, isEmpty);
    expect(container.read(manualOutreachSelectionProvider).selecting, isFalse);
  });

  test('inbox reconstructs submitted customers from the server without local selection', () {
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
    outreach.ingestRequested([
      OutreachCustomerRef(
        id: 'c1',
        fullName: 'A One',
        messageRequestId: 'm1',
        status: 'QUEUED',
        requestedAt: DateTime.utc(2026, 9, 11),
      ),
      OutreachCustomerRef(
        id: 'c2',
        fullName: 'B Two',
        messageRequestId: 'm2',
        status: 'SENT',
        requestedAt: DateTime.utc(2026, 9, 11),
      ),
    ]);
    final inbox = container.read(manualOutreachSelectionProvider).inbox;
    expect(inbox, hasLength(2));
    expect(inbox.every((item) => item.submitted), isTrue);
    expect(inbox.map((item) => item.status), ['QUEUED', 'SENT']);
  });
}
