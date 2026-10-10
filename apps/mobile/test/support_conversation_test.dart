import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/core/theme/app_theme.dart';
import 'package:salon_mobile/core/networking/api_client.dart';
import 'package:salon_mobile/core/networking/repositories.dart';
import 'package:salon_mobile/core/state/providers.dart';
import 'package:salon_mobile/core/storage/session_store.dart';
import 'package:salon_mobile/features/admin/admin_support_screen.dart';
import 'package:salon_mobile/features/profile/profile_screen.dart';
import 'package:salon_mobile/features/profile/support_conversation_screen.dart';
import 'package:salon_mobile/shared/labels.dart';
import 'package:salon_mobile/shared/models/models.dart';

ApiClient _client() {
  return ApiClient(baseUrl: 'http://example.test', sessionStore: MemorySessionStore());
}

SupportMessage _message({
  required String id,
  required String body,
  required DateTime createdAt,
  String authorKind = 'SALON_USER',
  String? authorName,
}) {
  return SupportMessage(
    id: id,
    body: body,
    createdAt: createdAt,
    authorKind: authorKind,
    authorName: authorName,
  );
}

class _FakeSupport extends SupportRepository {
  _FakeSupport() : super(_client());

  SupportThread thread = SupportThread(
    conversation: null,
    messages: const ItemPage(items: [], hasMore: false),
  );
  Future<SupportThread>? pendingLoad;
  Future<SupportMessage>? pendingSend;
  Object? loadError;
  Object? olderError;
  Object? sendError;
  int sendCalls = 0;
  String? lastKey;
  String? lastText;

  @override
  Future<SupportThread> loadSalon({String? cursor}) async {
    if (pendingLoad != null && cursor == null) {
      return pendingLoad!;
    }
    if (cursor != null) {
      if (olderError != null) {
        throw olderError!;
      }
      return SupportThread(
        conversation: thread.conversation,
        messages: ItemPage(
          items: [
            _message(
              id: 'older-1',
              body: 'پیام قدیمی',
              createdAt: DateTime.utc(2026, 1, 1),
            ),
          ],
          hasMore: false,
        ),
      );
    }
    if (loadError != null) {
      throw loadError!;
    }
    return thread;
  }

  @override
  Future<SupportMessage> sendSalon({
    required String text,
    required String idempotencyKey,
  }) async {
    sendCalls += 1;
    lastKey = idempotencyKey;
    lastText = text;
    if (pendingSend != null) {
      return pendingSend!;
    }
    if (sendError != null) {
      throw sendError!;
    }
    final message = _message(
      id: 'sent-1',
      body: text,
      createdAt: DateTime.utc(2026, 10, 10, 12),
    );
    thread = SupportThread(
      conversation: SupportConversationSummary(
        id: 'c1',
        userName: 'Neda',
        userEmail: 'neda@example.test',
        salonName: 'سالن',
        lastMessageAt: message.createdAt,
        awaitingSupportReply: true,
      ),
      messages: ItemPage(items: [message], hasMore: false),
    );
    return message;
  }
}

class _QuietSalon extends SalonRepository {
  _QuietSalon() : super(_client());

  @override
  Future<SalonProfile> current() async {
    return const SalonProfile(id: 's1', name: 'سالن', status: 'ACTIVE');
  }
}

class _StaffAuth extends AuthController {
  @override
  AuthState build() {
    return const AuthState(
      status: AuthStatus.signedIn,
      user: AuthUser(id: 'u2', tenantId: 't1', role: 'STAFF', name: 'Neda'),
    );
  }
}

void main() {
  test('support messages sort by time then id', () {
    final later = _message(
      id: 'b',
      body: 'بعد',
      createdAt: DateTime.utc(2026, 10, 10, 12),
    );
    final earlierSame = _message(
      id: 'a',
      body: 'قبل',
      createdAt: DateTime.utc(2026, 10, 10, 12),
    );
    final older = _message(
      id: 'z',
      body: 'قدیم',
      createdAt: DateTime.utc(2026, 10, 9),
    );
    final sorted = [later, older, earlierSame]..sort(compareSupportMessages);
    expect(sorted.map((item) => item.id).toList(), ['z', 'a', 'b']);
  });

  testWidgets('staff sees support without service management', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authControllerProvider.overrideWith(_StaffAuth.new),
          salonRepositoryProvider.overrideWithValue(_QuietSalon()),
        ],
        child: const MaterialApp(home: ProfileScreen()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.manageServices), findsNothing);
    expect(find.text(AppStrings.contactSupport), findsOneWidget);
  });

  testWidgets('support thread shows empty, then a sent message', (tester) async {
    final support = _FakeSupport();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [supportRepositoryProvider.overrideWithValue(support)],
        child: MaterialApp(
          theme: AppTheme.app(),
          locale: AppTheme.locale,
          home: const SupportConversationScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.supportEmpty), findsOneWidget);
    expect(find.text(AppStrings.sendSupport), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'سلام پشتیبانی');
    await tester.pump();
    await tester.tap(find.text(AppStrings.sendSupport));
    await tester.pumpAndSettle();
    expect(find.text('سلام پشتیبانی'), findsOneWidget);
    expect(find.text(AppStrings.supportYou), findsOneWidget);
    expect(support.sendCalls, 1);
  });

  testWidgets('ambiguous send keeps the same idempotency key for retry', (tester) async {
    final support = _FakeSupport()..sendError = const NetworkException();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [supportRepositoryProvider.overrideWithValue(support)],
        child: MaterialApp(
          theme: AppTheme.app(),
          locale: AppTheme.locale,
          home: const SupportConversationScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'پیام نامشخص');
    await tester.pump();
    await tester.tap(find.text(AppStrings.sendSupport));
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.networkError), findsOneWidget);
    expect(find.text(AppStrings.retry), findsOneWidget);
    final firstKey = support.lastKey;
    support.sendError = null;
    await tester.tap(find.text(AppStrings.retry));
    await tester.pumpAndSettle();
    expect(support.lastKey, firstKey);
    expect(support.lastText, 'پیام نامشخص');
    expect(find.text('پیام نامشخص'), findsOneWidget);
  });

  testWidgets('older page failure can be retried without dropping loaded messages', (
    tester,
  ) async {
    final support = _FakeSupport()
      ..thread = SupportThread(
        conversation: SupportConversationSummary(
          id: 'c1',
          userName: 'Leila',
          userEmail: 'leila@example.test',
          salonName: 'سالن',
          lastMessageAt: DateTime.utc(2026, 10, 10),
          awaitingSupportReply: true,
        ),
        messages: ItemPage(
          items: [
            _message(
              id: 'new-1',
              body: 'پیام تازه',
              createdAt: DateTime.utc(2026, 10, 10),
              authorKind: 'PLATFORM_ADMIN',
            ),
          ],
          hasMore: true,
          nextCursor: 'cursor-1',
        ),
      )
      ..olderError = const NetworkException();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [supportRepositoryProvider.overrideWithValue(support)],
        child: MaterialApp(
          theme: AppTheme.app(),
          locale: AppTheme.locale,
          home: const SupportConversationScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('پیام تازه'), findsOneWidget);
    expect(find.text(AppStrings.supportTeam), findsOneWidget);
    await tester.tap(find.text(AppStrings.supportOlderMessages));
    await tester.pumpAndSettle();
    expect(find.text('پیام تازه'), findsOneWidget);
    expect(find.text(AppStrings.supportOlderFailed), findsOneWidget);
    support.olderError = null;
    await tester.tap(find.text(AppStrings.retry));
    await tester.pumpAndSettle();
    expect(find.text('پیام قدیمی'), findsOneWidget);
    expect(find.text('پیام تازه'), findsOneWidget);
  });

  testWidgets('admin list identifies the user and salon and opens the thread', (
    tester,
  ) async {
    final support = _AdminFake();
    final router = GoRouter(
      initialLocation: '/admin/support',
      routes: [
        GoRoute(
          path: '/admin/support',
          builder: (context, state) => const AdminSupportListScreen(),
        ),
        GoRoute(
          path: '/admin/support/:id',
          builder: (context, state) => AdminSupportThreadScreen(
            conversationId: state.pathParameters['id']!,
          ),
        ),
      ],
    );
    await tester.pumpWidget(
      ProviderScope(
        overrides: [supportRepositoryProvider.overrideWithValue(support)],
        child: MaterialApp.router(
          theme: AppTheme.app(),
          locale: AppTheme.locale,
          routerConfig: router,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text(AppStrings.adminUserSupport), findsWidgets);
    expect(find.text('لیلا'), findsOneWidget);
    expect(find.text('سالن گل'), findsOneWidget);
    expect(find.text(AppStrings.supportNeedsReply), findsOneWidget);
    await tester.tap(find.text('لیلا'));
    await tester.pumpAndSettle();
    expect(find.text('لطفاً بررسی کنید'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'پاسخ پشتیبانی');
    await tester.pump();
    await tester.tap(find.text(AppStrings.sendSupport));
    await tester.pumpAndSettle();
    expect(find.text('پاسخ پشتیبانی'), findsOneWidget);
    expect(find.text('اپراتور'), findsOneWidget);
    router.pop();
    await tester.pumpAndSettle();
    expect(find.text('لیلا'), findsOneWidget);
  });
}

class _AdminFake extends SupportRepository {
  _AdminFake() : super(_client());

  SupportMessage? reply;

  @override
  Future<ItemPage<SupportConversationSummary>> listAdmin({String? cursor}) async {
    return ItemPage(
      items: [
        SupportConversationSummary(
          id: 'conv-1',
          userName: 'لیلا',
          userEmail: 'leila@example.test',
          salonName: 'سالن گل',
          lastMessageAt: DateTime.utc(2026, 10, 10, 9),
          awaitingSupportReply: true,
        ),
      ],
      hasMore: false,
    );
  }

  @override
  Future<SupportThread> loadAdmin(String conversationId, {String? cursor}) async {
    return SupportThread(
      conversation: SupportConversationSummary(
        id: conversationId,
        userName: 'لیلا',
        userEmail: 'leila@example.test',
        salonName: 'سالن گل',
        lastMessageAt: DateTime.utc(2026, 10, 10, 9),
        awaitingSupportReply: true,
      ),
      messages: ItemPage(
        items: [
          _message(
            id: 'm1',
            body: 'لطفاً بررسی کنید',
            createdAt: DateTime.utc(2026, 10, 10, 9),
            authorName: 'لیلا',
          ),
          if (reply != null) reply!,
        ],
        hasMore: false,
      ),
    );
  }

  @override
  Future<SupportMessage> sendAdmin({
    required String conversationId,
    required String text,
    required String idempotencyKey,
  }) async {
    reply = _message(
      id: 'm2',
      body: text,
      createdAt: DateTime.utc(2026, 10, 10, 10),
      authorKind: 'PLATFORM_ADMIN',
      authorName: 'اپراتور',
    );
    return reply!;
  }
}
