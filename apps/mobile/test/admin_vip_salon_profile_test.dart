import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/core/theme/app_theme.dart';
import 'package:salon_mobile/core/theme/app_tokens.dart';
import 'package:salon_mobile/features/admin/admin_vip_outreach_screen.dart';
import 'package:salon_mobile/features/admin/admin_vip_salon_profile_screen.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

class _Repo extends VipRepository {
  _Repo({required this.profile, this.entitledAfter})
      : super(ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore()));

  AdminSalonProfile profile;
  AdminSalonProfile? entitledAfter;
  int grants = 0;
  int revokes = 0;

  @override
  Future<AdminSalonProfile> adminSalonProfile(String salonId) async => profile;

  @override
  Future<void> grantEntitlement(String salonId, String key) async {
    grants += 1;
    if (entitledAfter != null) profile = entitledAfter!;
  }

  @override
  Future<void> revokeEntitlement(String salonId, String key) async {
    revokes += 1;
  }

  @override
  Future<ItemPage<AdminVipOutreachFolder>> adminOutreachSalons({
    String? cursor,
    String? query,
  }) async =>
      const ItemPage(items: [], hasMore: false);
}

AdminSalonProfile _profile({
  required bool entitled,
  int distinct = 0,
  int vipTotal = 0,
  int vipOpen = 0,
  int ordinary = 0,
  int vipSends = 0,
  int ordinarySends = 0,
}) =>
    AdminSalonProfile(
      salonId: 's1',
      salonName: 'محسن',
      accessState: 'PRODUCT',
      entitled: entitled,
      asOf: DateTime.utc(2026, 10, 25, 7),
      explanation: 'live',
      distinctVipListsRequested: distinct,
      vipRequestCount: vipTotal,
      vipOpenRequestCount: vipOpen,
      ordinaryMessageRequestCount: ordinary,
      vipRecordedSendCount: vipSends,
      ordinaryRecordedSendCount: ordinarySends,
    );

Future<void> loadVazirmatn() async {
  final loader = FontLoader('Vazirmatn')
    ..addFont(rootBundle.load('assets/fonts/Vazirmatn-Regular.ttf'))
    ..addFont(rootBundle.load('assets/fonts/Vazirmatn-Medium.ttf'))
    ..addFont(rootBundle.load('assets/fonts/Vazirmatn-SemiBold.ttf'));
  await loader.load();
}

void main() {
  setUpAll(loadVazirmatn);

  testWidgets('inactive salon profile shows enable and zeros', (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          vipRepositoryProvider.overrideWithValue(_Repo(profile: _profile(entitled: false))),
        ],
        child: const MaterialApp(
          home: AdminVipSalonProfileScreen(salonId: 's1'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('محسن'), findsWidgets);
    expect(find.text(AppStrings.adminVipEnable), findsOneWidget);
    expect(find.text(AppStrings.adminVipDisable), findsNothing);
    expect(find.text(AppStrings.adminVipDistinctLists), findsOneWidget);
    expect(find.text('0'), findsWidgets);
  });

  testWidgets('enable asks for confirmation before granting', (tester) async {
    final repo = _Repo(
      profile: _profile(entitled: false),
      entitledAfter: _profile(entitled: true),
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [vipRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(home: AdminVipSalonProfileScreen(salonId: 's1')),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text(AppStrings.adminVipEnable));
    await tester.pumpAndSettle();
    expect(find.textContaining('فعال‌سازی VIP برای «محسن»'), findsOneWidget);
    expect(repo.grants, 0);
    await tester.tap(find.text(AppStrings.cancel));
    await tester.pumpAndSettle();
    expect(repo.grants, 0);
    await tester.tap(find.text(AppStrings.adminVipEnable));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, AppStrings.adminVipEnable).last);
    await tester.pumpAndSettle();
    expect(repo.grants, 1);
  });

  testWidgets('outreach header shows horizontal glass VIP actions', (tester) async {
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          vipRepositoryProvider.overrideWithValue(_Repo(profile: _profile(entitled: false))),
        ],
        child: const MaterialApp(home: AdminVipOutreachFoldersScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.adminVipLists), findsOneWidget);
    expect(find.text(AppStrings.adminVipActivateSalons), findsOneWidget);
    final lists = tester.getRect(find.text(AppStrings.adminVipLists));
    final activate = tester.getRect(find.text(AppStrings.adminVipActivateSalons));
    expect(lists.width, lessThan(320));
    expect(activate.width, lessThan(320));
    expect((lists.center.dy - activate.center.dy).abs(), lessThan(2));
    expect(find.byKey(const Key('admin-vip-quick-actions')), findsOneWidget);
    expect(find.byIcon(Icons.format_list_bulleted_rounded), findsOneWidget);
    expect(find.byIcon(Icons.storefront_outlined), findsOneWidget);
  });

  testWidgets('salon profile shows nonzero live counts', (tester) async {
    tester.view.physicalSize = const Size(900, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          vipRepositoryProvider.overrideWithValue(
            _Repo(
              profile: _profile(
                entitled: true,
                distinct: 4,
                vipTotal: 5,
                vipOpen: 4,
                ordinary: 4,
                vipSends: 2,
                ordinarySends: 1,
              ),
            ),
          ),
        ],
        child: MaterialApp(
          theme: AppTheme.app(),
          locale: AppTheme.locale,
          home: const RepaintBoundary(
            key: ValueKey('admin-vip-screenshot'),
            child: ColoredBox(
              color: AppTokens.bg,
              child: Directionality(
                textDirection: TextDirection.rtl,
                child: AdminVipSalonProfileScreen(salonId: 's1'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('admin-vip-profile-distinct')), findsOneWidget);
    expect(find.text('4'), findsWidgets);
    expect(find.text('5'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
    expect(find.text(AppStrings.adminVipRequestTotal), findsOneWidget);
    final boundary = tester.renderObject<RenderRepaintBoundary>(
      find.byKey(const ValueKey('admin-vip-screenshot')),
    );
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 1);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      File('/Users/amir-panahi/Desktop/salon-admin-vip-screenshots/admin-vip-salon-profile-nonzero.png')
        ..parent.createSync(recursive: true)
        ..writeAsBytesSync(bytes!.buffer.asUint8List());
    });
  });
}
