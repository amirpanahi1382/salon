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
    this.serviceName,
    this.amountReceived,
  });

  final String id;
  final String customerId;
  final DateTime visitedAt;
  final DateTime createdAt;
  final String? firstName;
  final String? lastName;
  final String? serviceName;
  final String? amountReceived;

  String get customerName {
    final name = '${firstName ?? ''} ${lastName ?? ''}'.trim();
    return name.isEmpty ? 'مشتری' : name;
  }

  String get serviceLabel {
    final name = serviceName?.trim() ?? '';
    return name.isEmpty ? '—' : name;
  }

  String get amountLabel {
    final amount = amountReceived?.trim() ?? '';
    if (amount.isEmpty) {
      return '—';
    }
    return '$amount ریال';
  }

  factory Visit.fromJson(Map<String, dynamic> json) {
    return Visit(
      id: json['id'] as String,
      customerId: json['customerId'] as String,
      visitedAt: DateTime.parse(json['visitedAt'] as String),
      createdAt: DateTime.parse(json['createdAt'] as String),
      firstName: json['firstName'] as String?,
      lastName: json['lastName'] as String?,
      serviceName: json['serviceName'] as String?,
      amountReceived: json['amountReceived'] as String?,
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

class OpportunityAction {
  const OpportunityAction({
    required this.id,
    required this.customerId,
    required this.firstName,
    required this.lastName,
    required this.opportunityType,
    required this.status,
    required this.createdBy,
    required this.createdAt,
    required this.updatedAt,
    this.completedAt,
    this.dismissedAt,
  });

  final String id;
  final String customerId;
  final String firstName;
  final String lastName;
  final String opportunityType;
  final String status;
  final String createdBy;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? completedAt;
  final DateTime? dismissedAt;

  String get fullName => '$firstName $lastName'.trim();

  factory OpportunityAction.fromJson(Map<String, dynamic> json) {
    return OpportunityAction(
      id: json['id'] as String,
      customerId: json['customerId'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      opportunityType: json['opportunityType'] as String,
      status: json['status'] as String,
      createdBy: json['createdBy'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      completedAt: _parseDate(json['completedAt']),
      dismissedAt: _parseDate(json['dismissedAt']),
    );
  }
}

class CustomerRevenue {
  const CustomerRevenue({
    required this.totalRevenue,
    required this.transactionCount,
    required this.currency,
    this.averageSpendPerVisit,
    this.averageRevenuePerTransaction,
    this.lastRevenueAt,
    this.revenueTrend,
  });

  final String totalRevenue;
  final int transactionCount;
  final String currency;
  final String? averageSpendPerVisit;
  final String? averageRevenuePerTransaction;
  final DateTime? lastRevenueAt;
  final String? revenueTrend;

  factory CustomerRevenue.fromJson(Map<String, dynamic> json) {
    return CustomerRevenue(
      totalRevenue: json['totalRevenue'] as String,
      transactionCount: json['transactionCount'] as int,
      currency: json['currency'] as String? ?? 'IRR',
      averageSpendPerVisit: json['averageSpendPerVisit'] as String?,
      averageRevenuePerTransaction: json['averageRevenuePerTransaction'] as String?,
      lastRevenueAt: _parseDate(json['lastRevenueAt']),
      revenueTrend: json['revenueTrend'] as String?,
    );
  }
}

class SalonService {
  const SalonService({
    required this.id,
    required this.name,
    required this.status,
  });

  final String id;
  final String name;
  final String status;

  factory SalonService.fromJson(Map<String, dynamic> json) {
    return SalonService(
      id: json['id'] as String,
      name: json['name'] as String,
      status: json['status'] as String,
    );
  }
}

class LedgerTransaction {
  const LedgerTransaction({
    required this.id,
    required this.amount,
    required this.currency,
    required this.status,
    required this.occurredAt,
  });

  final String id;
  final String amount;
  final String currency;
  final String status;
  final DateTime occurredAt;

  factory LedgerTransaction.fromJson(Map<String, dynamic> json) {
    return LedgerTransaction(
      id: json['id'] as String,
      amount: json['amount'] as String,
      currency: json['currency'] as String,
      status: json['status'] as String,
      occurredAt: DateTime.parse(json['occurredAt'] as String),
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
    required     this.opportunities,
    this.revenue,
  });

  final String customerId;
  final String firstName;
  final String lastName;
  final String status;
  final String explanation;
  final BehaviorMetrics behavior;
  final List<String> signals;
  final List<Opportunity> opportunities;
  final CustomerRevenue? revenue;

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
      revenue: json['revenue'] is Map<String, dynamic>
          ? CustomerRevenue.fromJson(json['revenue'] as Map<String, dynamic>)
          : null,
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
    this.totalRevenue = '0.00',
    this.revenueThisUtcMonth = '0.00',
    this.reportingTime = 'UTC',
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
  final String totalRevenue;
  final String revenueThisUtcMonth;
  final String reportingTime;

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
      totalRevenue: json['totalRevenue'] as String? ?? '0.00',
      revenueThisUtcMonth: json['revenueThisUtcMonth'] as String? ?? '0.00',
      reportingTime: json['reportingTime'] as String? ?? 'UTC',
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

Map<String, dynamic>? jsonObject(dynamic value) {
  if (value is Map<String, dynamic>) {
    return value;
  }
  if (value is Map) {
    return {
      for (final entry in value.entries) entry.key.toString(): entry.value,
    };
  }
  return null;
}

ItemPage<T> parseItemPage<T>(
  dynamic data,
  T Function(Map<String, dynamic> json) map,
) {
  final page = jsonObject(data);
  final raw = page != null ? page['items'] : data;
  final items = <T>[];
  if (raw is List) {
    for (final item in raw) {
      final json = jsonObject(item);
      if (json != null) {
        items.add(map(json));
      }
    }
  }
  final hasMore = page?['hasMore'] == true;
  final cursor = page?['nextCursor'];
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

class MessageDelivery {
  const MessageDelivery({
    required this.id,
    required this.customerId,
    required this.actionId,
    required this.opportunityType,
    required this.provider,
    required this.channel,
    required this.status,
    required this.body,
    required this.destinationHint,
    required this.createdBy,
    required this.createdAt,
    required this.updatedAt,
    this.failureCode,
    this.submittedAt,
    this.failedAt,
  });

  final String id;
  final String customerId;
  final String actionId;
  final String opportunityType;
  final String provider;
  final String channel;
  final String status;
  final String body;
  final String destinationHint;
  final String? failureCode;
  final String createdBy;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? submittedAt;
  final DateTime? failedAt;

  factory MessageDelivery.fromJson(Map<String, dynamic> json) {
    return MessageDelivery(
      id: json['id'] as String,
      customerId: json['customerId'] as String,
      actionId: json['actionId'] as String,
      opportunityType: json['opportunityType'] as String,
      provider: json['provider'] as String,
      channel: json['channel'] as String,
      status: json['status'] as String,
      body: json['body'] as String,
      destinationHint: json['destinationHint'] as String,
      failureCode: json['failureCode'] as String?,
      createdBy: json['createdBy'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      submittedAt: _parseDate(json['submittedAt']),
      failedAt: _parseDate(json['failedAt']),
    );
  }
}
