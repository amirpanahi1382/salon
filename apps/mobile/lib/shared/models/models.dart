class AuthUser {
  const AuthUser({
    required this.id,
    required this.tenantId,
    required this.role,
    this.name,
    this.email,
  });

  final String id;
  final String tenantId;
  final String role;
  final String? name;
  final String? email;

  factory AuthUser.fromLoginJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String,
      tenantId: json['tenantId'] as String,
      role: json['role'] as String,
      name: json['name'] as String?,
      email: json['email'] as String?,
    );
  }

  factory AuthUser.fromMeJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['userId'] as String,
      tenantId: json['tenantId'] as String,
      role: json['role'] as String,
    );
  }
}

class AuthSession {
  const AuthSession({required this.accessToken, required this.user});

  final String accessToken;
  final AuthUser user;

  factory AuthSession.fromAuthJson(Map<String, dynamic> json) {
    return AuthSession(
      accessToken: json['accessToken'] as String,
      user: AuthUser.fromLoginJson(json['user'] as Map<String, dynamic>),
    );
  }
}

class Customer {
  const Customer({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phoneNumber,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String firstName;
  final String lastName;
  final String phoneNumber;
  final DateTime createdAt;
  final DateTime updatedAt;

  String get fullName => '$firstName $lastName'.trim();

  factory Customer.fromJson(Map<String, dynamic> json) {
    return Customer(
      id: json['id'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      phoneNumber: json['phoneNumber'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }
}

class Visit {
  const Visit({
    required this.id,
    required this.customerId,
    required this.visitedAt,
    required this.createdAt,
    this.firstName,
    this.lastName,
  });

  final String id;
  final String customerId;
  final DateTime visitedAt;
  final DateTime createdAt;
  final String? firstName;
  final String? lastName;

  String get customerName {
    final name = '${firstName ?? ''} ${lastName ?? ''}'.trim();
    return name.isEmpty ? 'Customer' : name;
  }

  factory Visit.fromJson(Map<String, dynamic> json) {
    return Visit(
      id: json['id'] as String,
      customerId: json['customerId'] as String,
      visitedAt: DateTime.parse(json['visitedAt'] as String),
      createdAt: DateTime.parse(json['createdAt'] as String),
      firstName: json['firstName'] as String?,
      lastName: json['lastName'] as String?,
    );
  }
}

class SalonProfile {
  const SalonProfile({
    required this.id,
    required this.name,
    required this.status,
    this.phone,
    this.address,
  });

  final String id;
  final String name;
  final String status;
  final String? phone;
  final String? address;

  factory SalonProfile.fromJson(Map<String, dynamic> json) {
    return SalonProfile(
      id: json['id'] as String,
      name: json['name'] as String,
      status: json['status'] as String,
      phone: json['phone'] as String?,
      address: json['address'] as String?,
    );
  }
}

class BehaviorMetrics {
  const BehaviorMetrics({
    required this.visitCount,
    required this.expectedReturnIntervalDays,
    this.firstVisitAt,
    this.lastVisitAt,
    this.daysSinceLastVisit,
    this.averageReturnIntervalDays,
  });

  final int visitCount;
  final DateTime? firstVisitAt;
  final DateTime? lastVisitAt;
  final int? daysSinceLastVisit;
  final int? averageReturnIntervalDays;
  final int expectedReturnIntervalDays;

  factory BehaviorMetrics.fromJson(Map<String, dynamic> json) {
    return BehaviorMetrics(
      visitCount: json['visitCount'] as int,
      firstVisitAt: _parseDate(json['firstVisitAt']),
      lastVisitAt: _parseDate(json['lastVisitAt']),
      daysSinceLastVisit: json['daysSinceLastVisit'] as int?,
      averageReturnIntervalDays: json['averageReturnIntervalDays'] as int?,
      expectedReturnIntervalDays: json['expectedReturnIntervalDays'] as int,
    );
  }
}

class Opportunity {
  const Opportunity({
    required this.type,
    required this.customerId,
    required this.firstName,
    required this.lastName,
    required this.status,
    required this.reason,
    required this.recommendedAction,
  });

  final String type;
  final String customerId;
  final String firstName;
  final String lastName;
  final String status;
  final String reason;
  final String recommendedAction;

  String get fullName => '$firstName $lastName'.trim();

  factory Opportunity.fromJson(Map<String, dynamic> json) {
    return Opportunity(
      type: json['type'] as String,
      customerId: json['customerId'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      status: json['status'] as String,
      reason: json['reason'] as String,
      recommendedAction: json['recommendedAction'] as String,
    );
  }
}

class CustomerIntelligence {
  const CustomerIntelligence({
    required this.customerId,
    required this.firstName,
    required this.lastName,
    required this.status,
    required this.explanation,
    required this.behavior,
    required this.signals,
    required this.opportunities,
  });

  final String customerId;
  final String firstName;
  final String lastName;
  final String status;
  final String explanation;
  final BehaviorMetrics behavior;
  final List<String> signals;
  final List<Opportunity> opportunities;

  factory CustomerIntelligence.fromJson(Map<String, dynamic> json) {
    return CustomerIntelligence(
      customerId: json['customerId'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      status: json['status'] as String,
      explanation: json['explanation'] as String,
      behavior: BehaviorMetrics.fromJson(
        json['behavior'] as Map<String, dynamic>,
      ),
      signals: (json['signals'] as List<dynamic>? ?? [])
          .map((item) => item.toString())
          .toList(),
      opportunities: (json['opportunities'] as List<dynamic>? ?? [])
          .whereType<Map<String, dynamic>>()
          .map(Opportunity.fromJson)
          .toList(),
    );
  }
}

class IntelligenceSummary {
  const IntelligenceSummary({
    required this.customers,
    required this.newCustomers,
    required this.active,
    required this.returning,
    required this.atRisk,
    required this.inactive,
    required this.reactivationOpportunities,
    required this.customerReturnOpportunities,
    required this.frequent,
  });

  final int customers;
  final int newCustomers;
  final int active;
  final int returning;
  final int atRisk;
  final int inactive;
  final int reactivationOpportunities;
  final int customerReturnOpportunities;
  final int frequent;

  factory IntelligenceSummary.fromJson(Map<String, dynamic> json) {
    return IntelligenceSummary(
      customers: json['customers'] as int,
      newCustomers: json['new'] as int,
      active: json['active'] as int,
      returning: json['returning'] as int,
      atRisk: json['atRisk'] as int,
      inactive: json['inactive'] as int,
      reactivationOpportunities: json['reactivationOpportunities'] as int,
      customerReturnOpportunities: json['customerReturnOpportunities'] as int,
      frequent: json['frequent'] as int,
    );
  }
}

DateTime? _parseDate(Object? value) {
  if (value is! String || value.isEmpty) {
    return null;
  }
  return DateTime.tryParse(value);
}

List<T> parseItemList<T>(
  dynamic data,
  T Function(Map<String, dynamic> json) map,
) {
  return parseItemPage(data, map).items;
}

class ItemPage<T> {
  const ItemPage({required this.items, required this.hasMore, this.nextCursor});

  final List<T> items;
  final bool hasMore;
  final String? nextCursor;
}

ItemPage<T> parseItemPage<T>(
  dynamic data,
  T Function(Map<String, dynamic> json) map,
) {
  final raw = data is Map<String, dynamic> ? data['items'] : data;
  final items = raw is List
      ? raw.whereType<Map<String, dynamic>>().map(map).toList()
      : <T>[];
  final hasMore = data is Map<String, dynamic>
      ? data['hasMore'] == true
      : false;
  final cursor = data is Map<String, dynamic> ? data['nextCursor'] : null;
  return ItemPage(
    items: items,
    hasMore: hasMore,
    nextCursor: cursor is String && cursor.isNotEmpty ? cursor : null,
  );
}

class CustomerImportRowResult {
  const CustomerImportRowResult({
    required this.row,
    required this.status,
    this.errors = const [],
  });

  final int row;
  final String status;
  final List<String> errors;

  factory CustomerImportRowResult.fromJson(Map<String, dynamic> json) {
    return CustomerImportRowResult(
      row: json['row'] as int,
      status: json['status'] as String,
      errors: (json['errors'] as List<dynamic>? ?? [])
          .map((item) => item.toString())
          .toList(),
    );
  }

  bool get isImported => status == 'IMPORTED';
  bool get isSkipped =>
      status == 'ALREADY_EXISTS' || status == 'DUPLICATE_IN_FILE';
  bool get isFailed => status == 'INVALID';
}

class CustomerImportResult {
  const CustomerImportResult({
    required this.totalRows,
    required this.imported,
    required this.skipped,
    required this.failed,
    required this.results,
  });

  final int totalRows;
  final int imported;
  final int skipped;
  final int failed;
  final List<CustomerImportRowResult> results;

  factory CustomerImportResult.fromJson(Map<String, dynamic> json) {
    return CustomerImportResult(
      totalRows: json['totalRows'] as int,
      imported: json['imported'] as int,
      skipped: json['skipped'] as int,
      failed: json['failed'] as int,
      results: (json['results'] as List<dynamic>? ?? [])
          .whereType<Map<String, dynamic>>()
          .map(CustomerImportRowResult.fromJson)
          .toList(),
    );
  }

  List<CustomerImportRowResult> get skippedRows =>
      results.where((row) => row.isSkipped).toList();

  List<CustomerImportRowResult> get failedRows =>
      results.where((row) => row.isFailed).toList();
}
