import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/admin/admin_message_queue_screen.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore());
}

class _FakeFolders extends AdminMessageRepository {
  _FakeFolders(this.folders, {this.detail, this.item, this.queryResponses = const {}})
      : super(_client());

  final List<AdminNormalSalonFolder> folders;
  final AdminNormalSalonFolderDetail? detail;
  final AdminQueueItem? item;
  final Map<String, Future<ItemPage<AdminNormalSalonFolder>>> queryResponses;

  @override
  Future<ItemPage<AdminNormalSalonFolder>> listNormalSalons({
    String? cursor,
    String? query,
  }) async {
    final q = query?.trim() ?? '';
    final controlled = queryResponses[q];
    if (controlled != null) {
      return controlled;
    }
    final items = q.isEmpty
        ? folders
        : folders.where((row) => row.salonName.contains(q)).toList();
    return ItemPage(items: items, hasMore: false);
  }

  @override
  Future<AdminNormalSalonFolderDetail> getNormalSalon(
    String salonId, {
    String? cursor,
  }) async {
    return detail!;
  }

  @override
  Future<AdminQueueItem> getById(String id) async => item!;
}

void main() {
  testWidgets('normal destination shows salon folders and sent/total', (tester) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          adminMessageRepositoryProvider.overrideWithValue(
            _FakeFolders([
              const AdminNormalSalonFolder(
                salonId: 's1',
                salonName: 'گل',
                totalMessageCount: 37,
                sentMessageCount: 24,
                pendingMessageCount: 10,
                failedMessageCount: 2,
                cancelledMessageCount: 1,
              ),
            ]),
          ),
        ],
        child: const MaterialApp(home: AdminMessageQueueScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.adminQueueTitle), findsWidgets);
    expect(find.text('گل'), findsOneWidget);
    expect(find.text(AppStrings.sentOfTotal(24, 37)), findsOneWidget);
    expect(find.text(AppStrings.adminVipMessagingTitle), findsWidgets);
  });

  testWidgets('normal folder detail shows cancel only when server allows it', (tester) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          adminMessageRepositoryProvider.overrideWithValue(
            _FakeFolders(
              const [],
              detail: AdminNormalSalonFolderDetail(
                salonId: 's1',
                salonName: 'گل',
                totalMessageCount: 2,
                sentMessageCount: 1,
                pendingMessageCount: 1,
                failedMessageCount: 0,
                cancelledMessageCount: 0,
                page: ItemPage(
                  items: [
                    AdminQueueItem(
                      id: 'q1',
                      salonId: 's1',
                      salonName: 'گل',
                      customerId: 'c1',
                      customerName: 'سارا',
                      customerPhone: '09121111111',
                      messageText: 'سلام',
                      requestedAt: DateTime.utc(2026, 9, 22),
                      status: 'QUEUED',
                      attempts: 0,
                      providerReady: true,
                      canCancel: true,
                      canMarkManualSent: true,
                    ),
                    AdminQueueItem(
                      id: 'q2',
                      salonId: 's1',
                      salonName: 'گل',
                      customerId: 'c2',
                      customerName: 'مینا',
                      customerPhone: '09121111112',
                      messageText: 'سلام',
                      requestedAt: DateTime.utc(2026, 9, 22),
                      status: 'SENT',
                      attempts: 1,
                      providerReady: true,
                    ),
                  ],
                  hasMore: false,
                ),
              ),
            ),
          ),
        ],
        child: const MaterialApp(home: AdminNormalSalonFolderScreen(salonId: 's1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('سارا'), findsOneWidget);
    expect(find.text('مینا'), findsOneWidget);
    expect(find.text(AppStrings.adminRemoveFromQueue), findsOneWidget);
    expect(find.text(AppStrings.sentOfTotal(1, 2)), findsOneWidget);
  });

  testWidgets('normal search shows a filtered empty state', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          adminMessageRepositoryProvider.overrideWithValue(
            _FakeFolders(const [
              AdminNormalSalonFolder(
                salonId: 's1', salonName: 'گل', totalMessageCount: 1,
                sentMessageCount: 0, pendingMessageCount: 1, failedMessageCount: 0,
              ),
            ]),
          ),
        ],
        child: const MaterialApp(home: AdminMessageQueueScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'وجود ندارد');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.adminNormalFoldersFilteredEmpty), findsOneWidget);
    expect(find.text(AppStrings.adminNormalFoldersEmpty), findsNothing);
  });

  testWidgets('a stale normal search cannot overwrite a newer query', (tester) async {
    final oldResponse = Completer<ItemPage<AdminNormalSalonFolder>>();
    final newResponse = Completer<ItemPage<AdminNormalSalonFolder>>();
    final repo = _FakeFolders(
      const [
        AdminNormalSalonFolder(
          salonId: 'initial', salonName: 'نتیجه اولیه', totalMessageCount: 1,
          sentMessageCount: 0, pendingMessageCount: 1, failedMessageCount: 0,
        ),
      ],
      queryResponses: {'قدیمی': oldResponse.future, 'جدید': newResponse.future},
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [adminMessageRepositoryProvider.overrideWithValue(repo)],
        child: const MaterialApp(home: AdminMessageQueueScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'قدیمی');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'جدید');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    newResponse.complete(const ItemPage(items: [
      AdminNormalSalonFolder(
        salonId: 'new', salonName: 'نتیجه جدید', totalMessageCount: 1,
        sentMessageCount: 0, pendingMessageCount: 1, failedMessageCount: 0,
      ),
    ], hasMore: false));
    await tester.pumpAndSettle();
    oldResponse.complete(const ItemPage(items: [
      AdminNormalSalonFolder(
        salonId: 'old', salonName: 'نتیجه قدیمی', totalMessageCount: 1,
        sentMessageCount: 0, pendingMessageCount: 1, failedMessageCount: 0,
      ),
    ], hasMore: false));
    await tester.pumpAndSettle();
    expect(find.text('نتیجه جدید'), findsOneWidget);
    expect(find.text('نتیجه قدیمی'), findsNothing);
  });

  testWidgets('unknown historical destination is labelled explicitly', (tester) async {
    final item = AdminQueueItem(
      id: 'q1', salonId: 's1', salonName: 'گل', customerId: '',
      customerName: 'مشتری تاریخی', customerPhone: '', messageText: 'سلام',
      requestedAt: DateTime.utc(2026, 9, 22), status: 'QUEUED', attempts: 0,
      providerReady: false, canCancel: true,
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          adminMessageRepositoryProvider.overrideWithValue(_FakeFolders(const [], item: item)),
        ],
        child: const MaterialApp(home: AdminMessageDetailSheet(itemId: 'q1')),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('شماره: ${AppStrings.adminUnknownDestination}'), findsOneWidget);
    expect(find.text(AppStrings.selectBale), findsNothing);
    expect(find.text(AppStrings.adminMarkRecipientSent), findsNothing);
    expect(find.text(AppStrings.adminRemoveFromQueue), findsOneWidget);
  });
}
