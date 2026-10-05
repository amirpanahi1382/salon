import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/admin/admin_vip_screen.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

VipTargetList _list(String id, String name) => VipTargetList(
      id: id,
      name: name,
      status: 'ACTIVE',
      contactCount: 2,
    );

AdminVipInventoryPage _page({
  required List<VipTargetList> items,
  bool hasMore = false,
  String? nextCursor,
  int? listCount,
  int contactRowCount = 4,
}) =>
    AdminVipInventoryPage(
      items: items,
      hasMore: hasMore,
      nextCursor: nextCursor,
      listCount: listCount ?? items.length,
      contactRowCount: contactRowCount,
      recordedContactCount: contactRowCount,
    );

class _Inventory extends VipRepository {
  _Inventory()
      : super(ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore()));

  final calls = <String?>[];
  Completer<AdminVipInventoryPage>? originalGate;
  bool holdOriginal = false;
  AdminVipInventoryPage original = _page(items: [_list('orig-1', 'لیست اصلی')]);
  AdminVipInventoryPage all = _page(items: [_list('all-1', 'لیست همه')]);
  AdminVipInventoryPage? second;

  @override
  Future<AdminVipInventoryPage> adminLists({
    String? cursor,
    String? catalogMembership,
  }) async {
    calls.add(catalogMembership);
    if (cursor != null) return second ?? _page(items: [_list('orig-2', 'ادامه اصلی')]);
    if (catalogMembership == 'ORIGINAL_TEHRAN' && holdOriginal) {
      return (originalGate ??= Completer()).future;
    }
    if (catalogMembership == 'ORIGINAL_TEHRAN') return original;
    return all;
  }

  @override
  Future<ItemPage<AdminSalonSummary>> adminSalons({String? cursor, String? q}) async =>
      const ItemPage(items: [], hasMore: false);

  @override
  Future<VipTargetList> adminGetList(String id) async => _list(id, 'لیست اصلی');
}

Future<void> _pump(WidgetTester tester, _Inventory repository, {GoRouter? router}) async {
  tester.view.physicalSize = const Size(900, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [vipRepositoryProvider.overrideWithValue(repository)],
      child: router == null
          ? const MaterialApp(home: AdminVipScreen())
          : MaterialApp.router(routerConfig: router),
    ),
  );
}

void main() {
  testWidgets('defaults to the original collection and does not show unclassified lists', (tester) async {
    final repository = _Inventory()
      ..original = _page(items: const [], listCount: 0, contactRowCount: 0)
      ..all = _page(items: [_list('regional-1', 'لیست منطقه‌ای')]);
    await _pump(tester, repository);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const ValueKey('vip-view-original')));
    expect(repository.calls.first, 'ORIGINAL_TEHRAN');
    expect(
      tester.widget<ChoiceChip>(find.byKey(const ValueKey('vip-view-original'))).selected,
      isTrue,
    );
    expect(find.text(AppStrings.vipOriginalCollectionEmpty), findsOneWidget);
    expect(find.text('لیست منطقه‌ای'), findsNothing);
    expect(find.text('0 لیست · 0 مخاطب'), findsOneWidget);
  });

  testWidgets('ignores a stale original response after switching to all lists', (tester) async {
    final repository = _Inventory()..holdOriginal = true;
    await _pump(tester, repository);
    await tester.pump();
    expect(repository.calls, ['ORIGINAL_TEHRAN']);
    await tester.ensureVisible(find.byKey(const ValueKey('vip-view-all')));
    await tester.tap(find.byKey(const ValueKey('vip-view-all')));
    await tester.pump();
    await tester.pump();
    expect(find.text('لیست همه'), findsOneWidget);
    repository.originalGate!.complete(_page(items: [_list('orig-1', 'لیست اصلی')]));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 20));
    expect(find.text('لیست همه'), findsOneWidget);
    expect(find.text('لیست اصلی'), findsNothing);
    expect(repository.calls, ['ORIGINAL_TEHRAN', null]);
  });

  testWidgets('paginates the selected view and resets the cursor when the view changes', (tester) async {
    final repository = _Inventory()
      ..original = _page(
        items: [_list('orig-1', 'صفحه اول')],
        hasMore: true,
        nextCursor: 'page-2',
        listCount: 2,
      )
      ..second = _page(items: [_list('orig-2', 'صفحه دوم')], listCount: 2);
    await _pump(tester, repository);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const ValueKey('vip-lists-load-more')));
    await tester.tap(find.byKey(const ValueKey('vip-lists-load-more')));
    await tester.pumpAndSettle();
    expect(find.text('صفحه اول'), findsOneWidget);
    expect(find.text('صفحه دوم'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('vip-view-all')));
    await tester.pumpAndSettle();
    expect(find.text('صفحه اول'), findsNothing);
    await tester.ensureVisible(find.text('لیست همه'));
    expect(find.text('لیست همه'), findsOneWidget);
    expect(repository.calls, ['ORIGINAL_TEHRAN', 'ORIGINAL_TEHRAN', null]);
  });

  testWidgets('opens list detail by name and returns to the inventory view', (tester) async {
    final repository = _Inventory();
    final router = GoRouter(
      initialLocation: '/admin/vip',
      routes: [
        GoRoute(path: '/admin/vip', builder: (context, state) => const AdminVipScreen()),
        GoRoute(
          path: '/admin/vip/:id',
          builder: (_, state) => AdminVipListDetailScreen(listId: state.pathParameters['id']!),
        ),
      ],
    );
    await _pump(tester, repository, router: router);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('لیست اصلی'));
    await tester.tap(find.text('لیست اصلی'));
    await tester.pumpAndSettle();
    expect(find.text('orig-1'), findsNothing);
    expect(find.text('لیست اصلی'), findsWidgets);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(
      tester.widget<ChoiceChip>(find.byKey(const ValueKey('vip-view-original'))).selected,
      isTrue,
    );
  });
}
