import '../../core/networking/api_client.dart';
import '../../core/storage/session_store.dart';
import '../../shared/models/models.dart';

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
      data: {'email': email.trim(), 'password': password},
    ) as Map<String, dynamic>;
    final session = AuthSession.fromAuthJson(data);
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
        'email': email.trim(),
        'password': password,
      },
    ) as Map<String, dynamic>;
    final session = AuthSession.fromAuthJson(data);
    await _persist(session);
    return session;
  }

  Future<AuthUser> me() async {
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

  Future<List<Customer>> list({String? query}) async {
    final data = await _api.get(
      '/customers',
      query: query == null || query.trim().isEmpty ? null : {'q': query.trim()},
    ) as List<dynamic>;
    return data
        .whereType<Map<String, dynamic>>()
        .map(Customer.fromJson)
        .toList();
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
        'phoneNumber': phoneNumber.trim(),
      },
    ) as Map<String, dynamic>;
    return Customer.fromJson(data);
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
        if (phoneNumber != null) 'phoneNumber': phoneNumber.trim(),
      },
    ) as Map<String, dynamic>;
    return Customer.fromJson(data);
  }
}

class VisitRepository {
  VisitRepository(this._api);

  final ApiClient _api;

  Future<List<Visit>> listForCustomer(String customerId) async {
    final data =
        await _api.get('/customers/$customerId/visits') as List<dynamic>;
    return data.whereType<Map<String, dynamic>>().map(Visit.fromJson).toList();
  }

  Future<Visit> record({
    required String customerId,
    required DateTime visitedAt,
  }) async {
    final data = await _api.post(
      '/visits',
      data: {
        'customerId': customerId,
        'visitedAt': visitedAt.toUtc().toIso8601String(),
      },
    ) as Map<String, dynamic>;
    return Visit.fromJson(data);
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

  Future<List<Opportunity>> opportunities({String? type}) async {
    final data = await _api.get(
      '/intelligence/opportunities',
      query: type == null ? null : {'type': type},
    ) as List<dynamic>;
    return data
        .whereType<Map<String, dynamic>>()
        .map(Opportunity.fromJson)
        .toList();
  }

  Future<CustomerIntelligence> forCustomer(String customerId) async {
    final data = await _api.get(
      '/intelligence/customers/$customerId',
    ) as Map<String, dynamic>;
    return CustomerIntelligence.fromJson(data);
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
