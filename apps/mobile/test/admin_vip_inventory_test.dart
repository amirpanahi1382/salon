import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/core/theme/app_theme.dart';
import 'package:salon_mobile/core/theme/app_tokens.dart';
import 'package:salon_mobile/features/admin/admin_vip_screen.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

VipTargetList _list(
  String id,
  String name, {
  bool requestable = false,
  int total = 0,
  int open = 0,
  String status = 'ACTIVE',
  String? catalogMembership,
  String? regionCode,
  String? regionName,
  int contactCount = 2,
  int liveRequestCount = 0,
  List<VipContact> contacts = const [],
}) => VipTargetList(
  id: id,
  name: name,
  status: status,
  contactCount: contactCount,
  catalogMembership: catalogMembership,
  regionCode: regionCode,
  regionName: regionName,
  requestableBySalons: requestable,
  totalRequestCount: total,
  openRequestCount: open,
  liveRequestCount: liveRequestCount,
  contacts: contacts,
);

AdminVipInventoryPage _page({
  required List<VipTargetList> items,
  bool hasMore = false,
  String? nextCursor,
  int? listCount,
  int contactRowCount = 4,
}) => AdminVipInventoryPage(
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
  final patches = <Map<String, String?>>[];
  AdminVipInventoryPage page = _page(items: [_list('all-1', 'لیست همه')]);
  AdminVipInventoryPage? second;
  ItemPage<AdminVipOutreachFolder> salonResults = const ItemPage(items: [], hasMore: false);
  ItemPage<AdminVipOutreachFolder>? moreSalonResults;
  final salonResultCursors = <String?>[];

  @override
  Future<AdminVipInventoryPage> adminLists({String? cursor, String? catalogMembership}) async {
    calls.add(catalogMembership);
    if (cursor != null) {
      return second ?? _page(items: [_list('all-2', 'ادامه')]);
    }
    return page;
  }

  @override
  Future<ItemPage<AdminSalonSummary>> adminSalons({String? cursor, String? q}) async =>
      const ItemPage(items: [], hasMore: false);

  @override
  Future<VipTargetList> adminGetList(String id) async {
    return page.items.firstWhere((item) => item.id == id, orElse: () => _list(id, 'لیست همه'));
  }

  @override
  Future<ItemPage<AdminVipOutreachFolder>> adminListSalonResults(
    String listId, {
    String? cursor,
  }) async {
    salonResultCursors.add(cursor);
    return cursor == null
        ? salonResults
        : moreSalonResults ?? const ItemPage(items: [], hasMore: false);
  }

  @override
  Future<VipTargetList> patchList(
    String id, {
    String? name,
    String? availability,
    String? regionCode,
  }) async {
    patches.add({'id': id, 'name': name, 'availability': availability, 'regionCode': regionCode});
    page = _page(
      items: page.items
          .map(
            (item) => item.id == id
                ? _list(
                    id,
                    name ?? item.name,
                    requestable: availability == 'ACTIVE' && regionCode != null,
                    status: availability ?? item.status,
                    catalogMembership: availability == 'ACTIVE'
                        ? 'ORIGINAL_TEHRAN'
                        : item.catalogMembership,
                    regionCode: regionCode ?? item.regionCode,
                    regionName: regionCode != null ? 'منطقه $regionCode' : item.regionName,
                    total: item.totalRequestCount,
                    open: item.openRequestCount,
                    contactCount: item.contactCount,
                  )
                : item,
          )
          .toList(),
      listCount: page.listCount,
      contactRowCount: page.contactRowCount,
    );
    return page.items.firstWhere((item) => item.id == id);
  }
}

Future<void> _savePng(WidgetTester tester, String filename) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('admin-vip-screenshot')),
  );
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File('/Users/amir-panahi/Desktop/salon-admin-vip-screenshots/$filename')
      ..parent.createSync(recursive: true);
    file.writeAsBytesSync(bytes!.buffer.asUint8List());
  });
}

Future<void> _pump(
  WidgetTester tester,
  _Inventory repository, {
  GoRouter? router,
  Size? size,
}) async {
  tester.view.physicalSize = size ?? const Size(900, 1600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  Widget wrap(Widget child) => RepaintBoundary(
    key: const ValueKey('admin-vip-screenshot'),
    child: ColoredBox(
      color: AppTokens.bg,
      child: Directionality(textDirection: TextDirection.rtl, child: child),
    ),
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [vipRepositoryProvider.overrideWithValue(repository)],
      child: router == null
          ? MaterialApp(
              theme: AppTheme.app(),
              locale: AppTheme.locale,
              home: wrap(const AdminVipScreen()),
            )
          : MaterialApp.router(
              theme: AppTheme.app(),
              locale: AppTheme.locale,
              builder: (context, child) => wrap(child ?? const SizedBox.shrink()),
              routerConfig: router,
            ),
    ),
  );
}

Future<void> loadVazirmatn() async {
  final loader = FontLoader('Vazirmatn')
    ..addFont(rootBundle.load('assets/fonts/Vazirmatn-Regular.ttf'))
    ..addFont(rootBundle.load('assets/fonts/Vazirmatn-Medium.ttf'))
    ..addFont(rootBundle.load('assets/fonts/Vazirmatn-SemiBold.ttf'));
  await loader.load();
}

void main() {
  setUpAll(loadVazirmatn);

  testWidgets('inventory lists every list without the original-Tehran filter', (tester) async {
    final repository = _Inventory()
      ..page = _page(
        items: [
          _list('regional-1', 'لیست منطقه‌ای', total: 3, open: 1),
          _list('orig-1', 'لیست اصلی', requestable: true),
        ],
        listCount: 2,
        contactRowCount: 4,
      );
    await _pump(tester, repository);
    await tester.pumpAndSettle();
    expect(repository.calls, [null]);
    expect(find.byKey(const ValueKey('vip-view-original')), findsNothing);
    expect(find.byKey(const ValueKey('vip-view-all')), findsNothing);
    expect(find.text('لیست منطقه‌ای'), findsOneWidget);
    expect(find.text('لیست اصلی'), findsOneWidget);
    expect(find.text(AppStrings.vipGrant), findsNothing);
    expect(find.text(AppStrings.searchSalons), findsNothing);
    expect(find.text('۲ لیست  ·  ۴ مخاطب'), findsOneWidget);
    expect(find.text('۳ درخواست'), findsOneWidget);
    expect(find.text('۱ در جریان'), findsOneWidget);
    expect(find.textContaining(AppStrings.adminVipListRequestTotal), findsNothing);
  });

  testWidgets('paginates the full inventory', (tester) async {
    final repository = _Inventory()
      ..page = _page(
        items: [_list('all-1', 'صفحه اول')],
        hasMore: true,
        nextCursor: 'page-2',
        listCount: 2,
      )
      ..second = _page(items: [_list('all-2', 'صفحه دوم')], listCount: 2);
    await _pump(tester, repository);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(const ValueKey('vip-lists-load-more')));
    await tester.tap(find.byKey(const ValueKey('vip-lists-load-more')));
    await tester.pumpAndSettle();
    expect(find.text('صفحه اول'), findsOneWidget);
    expect(find.text('صفحه دوم'), findsOneWidget);
    expect(repository.calls, [null, null]);
  });

  testWidgets('opens list detail by name and returns to inventory', (tester) async {
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
    await tester.ensureVisible(find.text('لیست همه'));
    await tester.tap(find.text('لیست همه'));
    await tester.pumpAndSettle();
    expect(find.text('لیست همه'), findsWidgets);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('لیست همه'), findsOneWidget);
  });

  testWidgets('list detail shows paginated per-salon execution results', (tester) async {
    final repository = _Inventory()
      ..salonResults = ItemPage(
        items: [
          AdminVipOutreachFolder(
            salonId: 'salon-1',
            salonName: 'سالن محسن',
            requestCount: 3,
            recipientCount: 100,
            pendingMessageCount: 18,
            sentMessageCount: 80,
            failedMessageCount: 2,
            cancelledMessageCount: 0,
            latestActivityAt: DateTime.utc(2026, 10, 28, 8, 30),
          ),
        ],
        hasMore: true,
        nextCursor: 'next-results',
      )
      ..moreSalonResults = const ItemPage(
        items: [
          AdminVipOutreachFolder(
            salonId: 'salon-2',
            salonName: 'سالن دوم',
            requestCount: 1,
            recipientCount: 30,
            pendingMessageCount: 30,
            sentMessageCount: 0,
            failedMessageCount: 0,
            cancelledMessageCount: 0,
          ),
        ],
        hasMore: false,
      );
    final router = GoRouter(
      initialLocation: '/admin/vip/all-1',
      routes: [
        GoRoute(
          path: '/admin/vip/:id',
          builder: (_, state) => AdminVipListDetailScreen(listId: state.pathParameters['id']!),
        ),
      ],
    );
    await _pump(tester, repository, router: router, size: const Size(900, 1900));
    await tester.pumpAndSettle();

    expect(find.text(AppStrings.adminVipListSalonResults), findsOneWidget);
    expect(find.text('سالن محسن'), findsOneWidget);
    expect(find.text('۳ درخواست'), findsWidgets);
    expect(find.text('۱۰۰ مخاطب'), findsOneWidget);
    expect(find.text('۸۰ ارسال ثبت‌شده'), findsOneWidget);
    expect(find.text('۱۸ در صف'), findsOneWidget);
    expect(find.text('۲ ناموفق'), findsOneWidget);
    expect(find.textContaining('آخرین فعالیت:'), findsOneWidget);
    await _savePng(tester, 'admin-vip-list-salon-results.png');

    await tester.ensureVisible(find.text(AppStrings.loadMore));
    await tester.tap(find.text(AppStrings.loadMore));
    await tester.pumpAndSettle();
    expect(find.text('سالن دوم'), findsOneWidget);
    expect(repository.salonResultCursors, [null, 'next-results']);
  });

  testWidgets('empty inventory uses the all-lists empty copy', (tester) async {
    final repository = _Inventory()
      ..page = _page(items: const [], listCount: 0, contactRowCount: 0);
    await _pump(tester, repository);
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipNoLists), findsOneWidget);
    expect(find.text(AppStrings.vipOriginalCollectionEmpty), findsNothing);
  });

  testWidgets('shows pending, requestable, missing-region, and IN_USE locked lists', (
    tester,
  ) async {
    final repository = _Inventory()
      ..page = _page(
        items: [
          _list(
            'imported-1',
            'لیست واردشده فعال',
            status: 'ACTIVE',
            contactCount: 3,
            contacts: const [
              VipContact(displayName: 'نام آزمایشی', phoneNumber: '09120000000', sortOrder: 1),
            ],
          ),
          _list(
            'reviewed-1',
            'لیست بررسی‌شده',
            requestable: true,
            catalogMembership: 'ORIGINAL_TEHRAN',
            regionCode: '01',
            regionName: 'شمال',
            total: 2,
            open: 1,
          ),
          _list(
            'inuse-1',
            'لیست رزروشده',
            status: 'IN_USE',
            catalogMembership: 'ORIGINAL_TEHRAN',
            regionCode: '01',
            regionName: 'شمال',
            total: 1,
            open: 1,
            liveRequestCount: 1,
          ),
        ],
        listCount: 3,
        contactRowCount: 7,
      );
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
    expect(find.text('۳ لیست  ·  ۷ مخاطب'), findsOneWidget);
    expect(find.textContaining(AppStrings.adminVipMissingRegionReason), findsNothing);
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('vip-availability-imported-1')),
        matching: find.text(AppStrings.vipInactive),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('vip-availability-reviewed-1')),
        matching: find.text(AppStrings.vipActive),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const ValueKey('vip-availability-inuse-1')),
        matching: find.text(AppStrings.vipInUse),
      ),
      findsOneWidget,
    );
    expect(find.text('۲ درخواست'), findsOneWidget);
    expect(find.text('۱ در جریان'), findsNWidgets(2));
    await _savePng(tester, 'admin-vip-inventory-nonzero.png');

    await tester.tap(find.text('لیست واردشده فعال'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('vip-unavailability-reason')), findsOneWidget);
    expect(find.textContaining(AppStrings.adminVipMissingRegionReason), findsWidgets);
    expect(find.text(AppStrings.vipActive), findsNothing);
    expect(find.text('نام آزمایشی'), findsNothing);
    expect(find.text('09120000000'), findsNothing);
    expect(tester.getSize(find.byKey(const ValueKey('vip-activate-list'))).width, lessThan(240));
    expect(tester.getSize(find.byKey(const ValueKey('vip-deactivate-list'))).width, lessThan(240));
    expect(
      tester.widget<FilledButton>(find.byKey(const ValueKey('vip-activate-list'))).onPressed,
      isNotNull,
    );
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('لیست بررسی‌شده'));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.vipActive), findsWidgets);
    expect(find.byKey(const ValueKey('vip-unavailability-reason')), findsNothing);
    expect(
      tester.widget<FilledButton>(find.byKey(const ValueKey('vip-activate-list'))).onPressed,
      isNull,
    );
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('لیست رزروشده'));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.adminVipInUseReason), findsOneWidget);
    expect(find.byKey(const ValueKey('vip-reopen-list')), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(const ValueKey('vip-activate-list'))).onPressed,
      isNull,
    );
    expect(
      tester.widget<FilledButton>(find.byKey(const ValueKey('vip-deactivate-list'))).onPressed,
      isNotNull,
    );
  });

  testWidgets(
    'activation requires a canonical region then patches availability and region together',
    (tester) async {
      final repository = _Inventory()
        ..page = _page(
          items: [_list('pending-1', 'لیست در انتظار', status: 'PENDING', contactCount: 3)],
        );
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
      await tester.tap(find.text('لیست در انتظار'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('vip-activate-list')));
      await tester.pumpAndSettle();
      expect(find.textContaining(AppStrings.adminVipActivateListConfirm), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byKey(const ValueKey('vip-activate-confirm'))).onPressed,
        isNull,
      );
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('vip-activate-region-03')),
        80,
        scrollable: find.descendant(
          of: find.byType(AlertDialog),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.tap(find.byKey(const ValueKey('vip-activate-region-03')));
      await tester.pumpAndSettle();
      expect(find.textContaining('03 — '), findsWidgets);
      await tester.tap(find.byKey(const ValueKey('vip-activate-confirm')));
      await tester.pumpAndSettle();
      expect(repository.patches, [
        {'id': 'pending-1', 'name': null, 'availability': 'ACTIVE', 'regionCode': '03'},
      ]);
      expect(find.text(AppStrings.vipActive), findsWidgets);
    },
  );

  testWidgets(
    'activation of an existing region shows that region and does not offer a replacement',
    (tester) async {
      final repository = _Inventory()
        ..page = _page(
          items: [
            _list(
              'stored-1',
              'لیست با منطقه',
              status: 'INACTIVE',
              regionCode: '03',
              regionName: 'شمال‌غرب؛ سعادت‌آباد، پونک و جنت‌آباد',
            ),
          ],
        );
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
      await tester.tap(find.text('لیست با منطقه'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('vip-activate-list')));
      await tester.pumpAndSettle();
      expect(Directionality.of(tester.element(find.byType(AlertDialog))), TextDirection.rtl);
      expect(find.text(AppStrings.adminVipActivateKeepsRegion), findsOneWidget);
      expect(find.textContaining(AppStrings.adminVipActivateListConfirm), findsNothing);
      expect(find.byKey(const ValueKey('vip-activate-region-03')), findsNothing);
      expect(find.byKey(const ValueKey('vip-activate-region-04')), findsNothing);
      expect(find.textContaining('${AppStrings.adminVipStoredRegion}: 03 — '), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byKey(const ValueKey('vip-activate-confirm'))).onPressed,
        isNotNull,
      );
      await tester.tap(find.byKey(const ValueKey('vip-activate-confirm')));
      await tester.pumpAndSettle();
      expect(repository.patches, [
        {'id': 'stored-1', 'name': null, 'availability': 'ACTIVE', 'regionCode': '03'},
      ]);
    },
  );
}
