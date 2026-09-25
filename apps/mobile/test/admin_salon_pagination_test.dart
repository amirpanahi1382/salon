import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/admin/admin_vip_screen.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

const first = AdminSalonSummary(id: 's1', name: 'Same salon', entitled: false);
const second = AdminSalonSummary(id: 's2', name: 'Same salon', entitled: false);

class _Salons extends VipRepository {
  _Salons()
    : super(
        ApiClient(
          baseUrl: 'http://example.test',
          sessionStore: MemorySessionStore(),
        ),
      );

  final calls = <(String?, String?)>[];
  bool failNext = true;
  Completer<ItemPage<AdminSalonSummary>>? searchGate;

  @override
  Future<ItemPage<VipTargetList>> adminLists({String? cursor}) async =>
      const ItemPage(items: [], hasMore: false);

  @override
  Future<ItemPage<AdminSalonSummary>> adminSalons({
    String? cursor,
    String? q,
  }) async {
    calls.add((cursor, q));
    if (q == 'slow') return (searchGate ??= Completer()).future;
    if (q == 'target') {
      return const ItemPage(items: [second], hasMore: false);
    }
    if (cursor == null) {
      return const ItemPage(
        items: [first],
        hasMore: true,
        nextCursor: 'page-2',
      );
    }
    if (failNext) {
      failNext = false;
      throw StateError('later page failed');
    }
    return const ItemPage(items: [second], hasMore: false);
  }
}

Future<void> _pump(WidgetTester tester, _Salons repository) async {
  tester.view.physicalSize = const Size(900, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [vipRepositoryProvider.overrideWithValue(repository)],
      child: const MaterialApp(home: AdminVipScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'append and retry keep distinct salon IDs despite duplicate names',
    (tester) async {
      final repository = _Salons();
      await _pump(tester, repository);
      expect(find.byKey(const ValueKey('s1')), findsOneWidget);
      await tester.tap(find.text(AppStrings.loadMore));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('s1')), findsOneWidget);
      expect(find.text(AppStrings.retry), findsOneWidget);
      await tester.tap(find.text(AppStrings.retry));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('s1')), findsOneWidget);
      expect(find.byKey(const ValueKey('s2')), findsOneWidget);
      expect(repository.calls.map((call) => call.$1).toList(), [
        null,
        'page-2',
        'page-2',
      ]);
    },
  );

  testWidgets('search resets the cursor and ignores stale responses', (
    tester,
  ) async {
    final repository = _Salons();
    await _pump(tester, repository);
    await tester.enterText(find.byType(TextField), 'slow');
    await tester.pump(const Duration(milliseconds: 350));
    expect(repository.calls.last.$2, 'slow');
    await tester.enterText(find.byType(TextField), 'target');
    await tester.pump(const Duration(milliseconds: 350));
    await tester.pump();
    expect(repository.calls.last, (null, 'target'));
    expect(find.byKey(const ValueKey('s2')), findsOneWidget);
    repository.searchGate!.complete(
      const ItemPage(items: [first], hasMore: false),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('s2')), findsOneWidget);
    expect(find.byKey(const ValueKey('s1')), findsNothing);
  });
}
