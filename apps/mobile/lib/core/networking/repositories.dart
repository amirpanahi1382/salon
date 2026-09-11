import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../../core/errors/api_exception.dart';
import '../../core/networking/api_client.dart';
import '../../core/storage/session_store.dart';
import '../../shared/models/models.dart';

String sanitizeAuthEmail(String email) {
  return email
      .replaceAll(
        RegExp(
          r'[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]',
        ),
        '',
      )
      .trim();
}

class AuthRepository {
  AuthRepository({required this.api, required this.sessionStore});

  final ApiClient api;
  final SessionStore sessionStore;

  Future<AuthSession> login({
    required String email,
    required String password,
  }) async {
    final data = await api.post(
      '/auth/login',
      data: {'email': sanitizeAuthEmail(email), 'password': password},
    );
    final session = AuthSession.fromAuthJson(asJsonMap(data));
    await _persist(session);
    return session;
  }

  Future<AuthSession> register({
    required String salonName,
    required String ownerName,
    required String email,
    required String password,
  }) async {
    final data = await api.post(
      '/auth/register',
      data: {
        'salonName': salonName.trim(),
        'ownerName': ownerName.trim(),
        'email': sanitizeAuthEmail(email),
        'password': password,
      },
    );
    final session = AuthSession.fromAuthJson(asJsonMap(data));
    await _persist(session);
    return session;
  }

  Future<AuthSession> loginPlatformAdmin({
    required String email,
    required String password,
  }) async {
    final data = await api.post(
      '/admin/auth/login',
      data: {'email': sanitizeAuthEmail(email), 'password': password},
    );
    if (kDebugMode) {
      debugPrint(
        'admin login response type=${data.runtimeType} keys=${data is Map ? data.keys.toList() : null}',
      );
    }
    final session = AuthSession.fromAdminAuthJson(data);
    await _persist(session);
    return session;
  }

  Future<AuthUser> me() async {
    final stored = await sessionStore.read();
    if (stored?.role == 'PLATFORM_ADMIN') {
      final data = asJsonMap(await api.get('/admin/auth/me'));
      return AuthUser.fromAdminMeJson(data);
    }
    final data = await api.get('/auth/me') as Map<String, dynamic>;
    return AuthUser.fromMeJson(data);
  }

  Future<StoredSession?> restore() => sessionStore.read();

  Future<void> logout() => sessionStore.clear();

  Future<void> _persist(AuthSession session) {
    return sessionStore.write(
      StoredSession(
        accessToken: session.accessToken,
        userId: session.user.id,
        tenantId: session.user.tenantId,
        role: session.user.role,
        name: session.user.name,
        email: session.user.email,
      ),
    );
  }
}

class CustomerRepository {
  CustomerRepository(this._api);

  final ApiClient _api;

  Future<ItemPage<Customer>> list({String? query, String? cursor}) async {
    final data = await _api.get(
      '/customers',
      query: {
        if (query != null && query.trim().isNotEmpty) 'q': query.trim(),
        if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      },
    );
    return parseItemPage(data, Customer.fromJson);
  }

  Future<Customer> getById(String id) async {
    final data = await _api.get('/customers/$id') as Map<String, dynamic>;
    return Customer.fromJson(data);
  }

  Future<Customer> create({
    required String firstName,
    required String lastName,
    required String phoneNumber,
  }) async {
    final data = await _api.post(
      '/customers',
      data: {
        'firstName': firstName.trim(),
        'lastName': lastName.trim(),
        'phoneNumber': phoneNumber,
      },
    ) as Map<String, dynamic>;
    return Customer.fromJson(data);
  }

  Future<CustomerImportResult> importFromExcel({
    required List<int> bytes,
    required String filename,
  }) async {
    final data = await _api.postForm(
      '/customers/import',
      FormData.fromMap({
        'file': MultipartFile.fromBytes(bytes, filename: filename),
      }),
    ) as Map<String, dynamic>;
    return CustomerImportResult.fromJson(data);
  }

  Future<List<int>> downloadImportTemplate() {
    return _api.getBytes('/customers/import/template');
  }

  Future<Customer> update({
    required String id,
    String? firstName,
    String? lastName,
    String? phoneNumber,
  }) async {
    final data = await _api.patch(
      '/customers/$id',
      data: {
        if (firstName != null) 'firstName': firstName.trim(),
        if (lastName != null) 'lastName': lastName.trim(),
        'phoneNumber': ?phoneNumber,
      },
    ) as Map<String, dynamic>;
    return Customer.fromJson(data);
  }

  Future<void> delete(String id) {
    return _api.delete('/customers/$id');
  }
}

class VisitRepository {
  VisitRepository(this._api);

  final ApiClient _api;

  Future<ItemPage<Visit>> listForCustomer(
    String customerId, {
    String? cursor,
  }) async {
    final data = await _api.get(
      '/customers/$customerId/visits',
      query: cursor == null ? null : {'cursor': cursor},
    );
    return parseItemPage(data, Visit.fromJson);
  }

  Future<ItemPage<Visit>> list({String? customerId, DateTime? day, String? cursor}) async {
    final query = <String, dynamic>{
      'customerId': ?customerId,
      if (day != null) ..._localDayWindow(day),
      if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
    };
    final data = await _api.get('/visits', query: query.isEmpty ? null : query);
    return parseItemPage(data, Visit.fromJson);
  }

  Future<Visit> record({
    required String customerId,
    required DateTime visitedAt,
    required String idempotencyKey,
  }) async {
    Future<Visit> send() async {
      final data = await _api.post(
        '/visits',
        data: {
          'customerId': customerId,
          'visitedAt': visitedAt.toUtc().toIso8601String(),
        },
        headers: {'Idempotency-Key': idempotencyKey},
      ) as Map<String, dynamic>;
      return Visit.fromJson(data);
    }

    try {
      return await send();
    } on NetworkException {
      return send();
    }
  }

  Future<Visit> recordCompletedWithSale({
    required String customerId,
    required DateTime visitedAt,
    required String serviceId,
    required String amount,
    required String idempotencyKey,
  }) async {
    Future<Visit> send() async {
      final data = await _api.post(
        '/visits/complete-with-sale',
        data: {
          'customerId': customerId,
          'visitedAt': visitedAt.toUtc().toIso8601String(),
          'serviceId': serviceId,
          'amount': amount,
          'currency': 'IRR',
        },
        headers: {'Idempotency-Key': idempotencyKey},
      ) as Map<String, dynamic>;
      return Visit.fromJson(data['visit'] as Map<String, dynamic>);
    }

    try {
      return await send();
    } on NetworkException {
      return send();
    }
  }

  Future<void> delete(String id) {
    return _api.delete('/visits/$id');
  }

  Future<List<int>> exportExcel({String? customerId, DateTime? day}) {
    final query = <String, dynamic>{
      'customerId': ?customerId,
      if (day != null) ..._localDayWindow(day),
    };
    return _api.getBytes('/visits/export', query: query.isEmpty ? null : query);
  }

  Map<String, String> _localDayWindow(DateTime day) {
    final start = DateTime(day.year, day.month, day.day);
    final end = start.add(const Duration(days: 1));
    return {
      'from': start.toUtc().toIso8601String(),
      'to': end.toUtc().toIso8601String(),
    };
  }
}

class IntelligenceRepository {
  IntelligenceRepository(this._api);

  final ApiClient _api;

  Future<IntelligenceSummary> summary() async {
    final data =
        await _api.get('/intelligence/summary') as Map<String, dynamic>;
    return IntelligenceSummary.fromJson(data);
  }

  Future<ItemPage<Opportunity>> opportunities({
    String? type,
    String? cursor,
  }) async {
    final data = await _api.get(
      '/intelligence/opportunities',
      query: {
        'type': ?type,
        if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      },
    );
    return parseItemPage(data, Opportunity.fromJson);
  }

  Future<CustomerIntelligence> forCustomer(String customerId) async {
    final data = await _api.get(
      '/intelligence/customers/$customerId',
    ) as Map<String, dynamic>;
    return CustomerIntelligence.fromJson(data);
  }
}

class ActionRepository {
  ActionRepository(this._api);

  final ApiClient _api;

  Future<ItemPage<OpportunityAction>> list({
    String? status,
    String? customerId,
    String? cursor,
  }) async {
    final data = await _api.get(
      '/actions',
      query: {
        'status': ?status,
        'customerId': ?customerId,
        if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      },
    );
    return parseItemPage(data, OpportunityAction.fromJson);
  }

  Future<ItemPage<OpportunityAction>> listForCustomer(
    String customerId, {
    String? status,
    String? cursor,
  }) async {
    final data = await _api.get(
      '/customers/$customerId/actions',
      query: {
        'status': ?status,
        if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      },
    );
    return parseItemPage(data, OpportunityAction.fromJson);
  }

  Future<OpportunityAction> create({
    required String customerId,
    required String opportunityType,
    required String idempotencyKey,
  }) async {
    Future<OpportunityAction> send() async {
      final data = await _api.post(
        '/intelligence/opportunities/$opportunityType/customers/$customerId/actions',
        headers: {'Idempotency-Key': idempotencyKey},
      ) as Map<String, dynamic>;
      return OpportunityAction.fromJson(data);
    }

    try {
      return await send();
    } on NetworkException {
      return send();
    }
  }

  Future<OpportunityAction> complete(String id) async {
    Future<OpportunityAction> send() async {
      final data =
          await _api.post('/actions/$id/complete') as Map<String, dynamic>;
      return OpportunityAction.fromJson(data);
    }

    try {
      return await send();
    } on NetworkException {
      return send();
    }
  }

  Future<OpportunityAction> dismiss(String id) async {
    Future<OpportunityAction> send() async {
      final data =
          await _api.post('/actions/$id/dismiss') as Map<String, dynamic>;
      return OpportunityAction.fromJson(data);
    }

    try {
      return await send();
    } on NetworkException {
      return send();
    }
  }
}

class MessageRepository {
  MessageRepository(this._api);

  final ApiClient _api;

  Future<MessageDelivery> send({
    required String customerId,
    required String opportunityType,
    required String text,
    required String idempotencyKey,
  }) async {
    Future<MessageDelivery> request() async {
      final data = await _api.post(
        '/intelligence/opportunities/$opportunityType/customers/$customerId/messages',
        data: {'text': text},
        headers: {'Idempotency-Key': idempotencyKey},
      ) as Map<String, dynamic>;
      return MessageDelivery.fromJson(data);
    }

    try {
      return await request();
    } on NetworkException {
      return request();
    }
  }

  Future<MessageDelivery> sendManualOutreach({
    required String customerId,
    required String text,
    required String idempotencyKey,
  }) async {
    Future<MessageDelivery> request() async {
      final data = await _api.post(
        '/customers/$customerId/messages',
        data: {'text': text},
        headers: {'Idempotency-Key': idempotencyKey},
      ) as Map<String, dynamic>;
      return MessageDelivery.fromJson(data);
    }

    try {
      return await request();
    } on NetworkException {
      return request();
    }
  }

  Future<MessageDelivery> getById(String id) async {
    final data = await _api.get('/messages/$id') as Map<String, dynamic>;
    return MessageDelivery.fromJson(data);
  }

  Future<ItemPage<MessageDelivery>> listForCustomer(
    String customerId, {
    String? cursor,
  }) async {
    final data = await _api.get(
      '/customers/$customerId/messages',
      query: cursor == null ? null : {'cursor': cursor},
    );
    return parseItemPage(data, MessageDelivery.fromJson);
  }
}

class AdminMessageRepository {
  AdminMessageRepository(this._api);

  final ApiClient _api;

  Future<ItemPage<AdminQueueItem>> list({String? cursor}) async {
    final data = await _api.get(
      '/admin/message-queue',
      query: cursor == null ? null : {'cursor': cursor},
    );
    return parseItemPage(data, AdminQueueItem.fromJson);
  }

  Future<AdminQueueItem> getById(String id) async {
    final data = await _api.get('/admin/message-queue/$id') as Map<String, dynamic>;
    return AdminQueueItem.fromJson(data);
  }

  Future<AdminQueueItem> selectBale(String id) async {
    final data =
        await _api.post('/admin/message-queue/$id/select-bale') as Map<String, dynamic>;
    return AdminQueueItem.fromJson(data);
  }

  Future<AdminQueueItem> selectManual(String id) async {
    final data =
        await _api.post('/admin/message-queue/$id/select-manual') as Map<String, dynamic>;
    return AdminQueueItem.fromJson(data);
  }

  Future<AdminQueueItem> markManualSent(String id) async {
    final data = await _api.post('/admin/message-queue/$id/mark-manual-sent')
        as Map<String, dynamic>;
    return AdminQueueItem.fromJson(data);
  }

  Future<AdminQueueItem> retry(String id) async {
    final data =
        await _api.post('/admin/message-queue/$id/retry') as Map<String, dynamic>;
    return AdminQueueItem.fromJson(data);
  }
}

class SalonRepository {
  SalonRepository(this._api);

  final ApiClient _api;

  Future<SalonProfile> current() async {
    final data = await _api.get('/salon') as Map<String, dynamic>;
    return SalonProfile.fromJson(data);
  }
}

class ServiceRepository {
  ServiceRepository(this._api);

  final ApiClient _api;

  Future<ItemPage<SalonService>> list({
    bool includeInactive = false,
    String? cursor,
  }) async {
    final data = await _api.get(
      '/services',
      query: {
        if (includeInactive) 'includeInactive': 'true',
        if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      },
    );
    return parseItemPage(data, SalonService.fromJson);
  }

  Future<SalonService> create(String name) async {
    final data = await _api.post('/services', data: {'name': name.trim()})
        as Map<String, dynamic>;
    return SalonService.fromJson(data);
  }

  Future<SalonService> update({
    required String id,
    String? name,
    String? status,
  }) async {
    final data = await _api.patch(
      '/services/$id',
      data: {
        'name': ?name?.trim(),
        'status': ?status,
      },
    ) as Map<String, dynamic>;
    return SalonService.fromJson(data);
  }
}

class TransactionRepository {
  TransactionRepository(this._api);

  final ApiClient _api;

  Future<ItemPage<LedgerTransaction>> listForCustomer(
    String customerId, {
    String? cursor,
  }) async {
    final data = await _api.get(
      '/customers/$customerId/transactions',
      query: cursor == null ? null : {'cursor': cursor},
    );
    return parseItemPage(data, LedgerTransaction.fromJson);
  }

  Future<LedgerTransaction> create({
    required String customerId,
    required String amount,
    required String serviceId,
    required String unitPrice,
    required int quantity,
    required String idempotencyKey,
    String? visitId,
  }) async {
    final data = await _api.post(
      '/transactions',
      data: {
        'customerId': customerId,
        'occurredAt': DateTime.now().toUtc().toIso8601String(),
        'amount': amount,
        'currency': 'IRR',
        'visitId': ?visitId,
        'items': [
          {
            'serviceId': serviceId,
            'quantity': quantity,
            'unitPrice': unitPrice,
          },
        ],
      },
      headers: {'Idempotency-Key': idempotencyKey},
    ) as Map<String, dynamic>;
    return LedgerTransaction.fromJson(data);
  }

  Future<LedgerTransaction> voidTransaction(String id) async {
    final data =
        await _api.post('/transactions/$id/void') as Map<String, dynamic>;
    return LedgerTransaction.fromJson(data);
  }
}
