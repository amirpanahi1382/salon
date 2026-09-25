Map<String, dynamic> asJsonMap(Object? value) {
  if (value is Map<String, dynamic>) {
    return value;
  }
  if (value is Map) {
    return {
      for (final entry in value.entries) entry.key.toString(): entry.value,
    };
  }
  throw FormatException('Expected a JSON object, got ${value.runtimeType}');
}

String requiredJsonString(Object? value, String field) {
  if (value is String && value.isNotEmpty) {
    return value;
  }
  throw FormatException('Expected non-empty string for $field');
}

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

  bool get isPlatformAdmin => role == 'PLATFORM_ADMIN';

  factory AuthUser.fromLoginJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['id'] as String,
      tenantId: json['tenantId'] as String,
      role: json['role'] as String,
      name: json['name'] as String?,
      email: json['email'] as String?,
    );
  }

  factory AuthUser.fromAdminLoginJson(Map<String, dynamic> json) {
    return AuthUser(
      id: requiredJsonString(json['id'], 'admin.id'),
      tenantId: '',
      role: 'PLATFORM_ADMIN',
      name: json['name'] as String?,
      email: json['email'] as String?,
    );
  }

  factory AuthUser.fromAdminMeJson(Map<String, dynamic> json) {
    return AuthUser(
      id: json['adminId'] as String,
      tenantId: '',
      role: 'PLATFORM_ADMIN',
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

  factory AuthSession.fromAdminAuthJson(Object? json) {
    final map = asJsonMap(json);
    return AuthSession(
      accessToken: requiredJsonString(map['accessToken'], 'accessToken'),
      user: AuthUser.fromAdminLoginJson(asJsonMap(map['admin'])),
    );
  }

  factory AuthSession.fromAuthJson(Object? json) {
    final map = asJsonMap(json);
    return AuthSession(
      accessToken: requiredJsonString(map['accessToken'], 'accessToken'),
      user: AuthUser.fromLoginJson(asJsonMap(map['user'])),
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

class CustomerActivityItem {
  const CustomerActivityItem({
    required this.id,
    required this.type,
    required this.occurredAt,
    required this.createdAt,
    this.status,
    this.opportunityType,
  });

  final String id;
  final String type;
  final DateTime occurredAt;
  final DateTime createdAt;
  final String? status;
  final String? opportunityType;

  factory CustomerActivityItem.fromJson(Map<String, dynamic> json) {
    return CustomerActivityItem(
      id: json['id'] as String,
      type: json['type'] as String,
      occurredAt: DateTime.parse(json['occurredAt'] as String),
      createdAt: DateTime.parse(json['createdAt'] as String),
      status: json['status'] as String?,
      opportunityType: json['opportunityType'] as String?,
    );
  }
}

class ManualOutreachRequest {
  const ManualOutreachRequest({
    required this.customerId,
    required this.customerName,
    required this.messageRequestId,
    required this.status,
    required this.requestedAt,
    required this.updatedAt,
  });

  final String customerId;
  final String customerName;
  final String messageRequestId;
  final String status;
  final DateTime requestedAt;
  final DateTime updatedAt;

  factory ManualOutreachRequest.fromJson(Map<String, dynamic> json) {
    return ManualOutreachRequest(
      customerId: json['customerId'] as String,
      customerName: json['customerName'] as String,
      messageRequestId: json['messageRequestId'] as String,
      status: json['status'] as String,
      requestedAt: DateTime.parse(json['requestedAt'] as String),
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

class SalonOverallPerformance {
  const SalonOverallPerformance({
    required this.customerCount,
    required this.salonCustomerSentMessageCount,
    required this.vipSentMessageCount,
    required this.agreedReturnCount,
    required this.messageAssociatedReturnedCustomerCount,
    required this.returningSalonCustomerCount,
  });

  final int customerCount;
  final int salonCustomerSentMessageCount;
  final int vipSentMessageCount;
  final int agreedReturnCount;
  final int messageAssociatedReturnedCustomerCount;
  final int returningSalonCustomerCount;

  factory SalonOverallPerformance.fromJson(Map<String, dynamic> json) {
    return SalonOverallPerformance(
      customerCount: json['customerCount'] as int,
      salonCustomerSentMessageCount: json['salonCustomerSentMessageCount'] as int,
      vipSentMessageCount: json['vipSentMessageCount'] as int,
      agreedReturnCount: json['agreedReturnCount'] as int,
      messageAssociatedReturnedCustomerCount:
          json['messageAssociatedReturnedCustomerCount'] as int,
      returningSalonCustomerCount: json['returningSalonCustomerCount'] as int,
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
    this.actionId,
    this.opportunityType,
    required this.channel,
    required this.status,
    required this.body,
    required this.destinationHint,
    required this.createdBy,
    required this.createdAt,
    required this.updatedAt,
    this.provider,
    this.mode,
    this.failureCode,
    this.submittedAt,
    this.failedAt,
    this.returnCommitment,
  });

  final String id;
  final String customerId;
  final String? actionId;
  final String? opportunityType;
  final String? provider;
  final String? mode;
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
  final ReturnCommitmentSummary? returnCommitment;

  factory MessageDelivery.fromJson(Map<String, dynamic> json) {
    return MessageDelivery(
      id: json['id'] as String,
      customerId: json['customerId'] as String? ?? '',
      actionId: json['actionId'] as String?,
      opportunityType: json['opportunityType'] as String?,
      provider: json['provider'] as String?,
      mode: json['mode'] as String?,
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
      returnCommitment: json['returnCommitment'] is Map
          ? ReturnCommitmentSummary.fromJson(asJsonMap(json['returnCommitment']))
          : null,
    );
  }
}

class AdminQueueItem {
  const AdminQueueItem({
    required this.id,
    required this.salonId,
    required this.salonName,
    required this.customerId,
    required this.customerName,
    required this.customerPhone,
    required this.messageText,
    this.opportunityType,
    required this.requestedAt,
    this.messageBusinessDate,
    required this.status,
    required this.attempts,
    required this.providerReady,
    this.vipRequestId,
    this.mode,
    this.deliveryStatus,
    this.failureCode,
    this.submittedAt,
    this.failedAt,
    this.returnCommitment,
    this.executionState,
    this.canCancel = false,
    this.canMarkManualSent = false,
  });

  final String id;
  final String salonId;
  final String salonName;
  final String customerId;
  final String customerName;
  final String customerPhone;
  final String messageText;
  final String? opportunityType;
  final DateTime requestedAt;
  final String? messageBusinessDate;
  final String status;
  final String? mode;
  final String? deliveryStatus;
  final String? failureCode;
  final int attempts;
  final DateTime? submittedAt;
  final DateTime? failedAt;
  final bool providerReady;
  final String? vipRequestId;
  final ReturnCommitmentSummary? returnCommitment;
  final String? executionState;
  final bool canCancel;
  final bool canMarkManualSent;

  factory AdminQueueItem.fromJson(Map<String, dynamic> json) {
    return AdminQueueItem(
      id: json['id'] as String,
      salonId: json['salonId'] as String,
      salonName: json['salonName'] as String,
      customerId: json['customerId'] as String? ?? '',
      customerName: json['customerName'] as String,
      customerPhone: json['customerPhone'] as String,
      messageText: json['messageText'] as String,
      opportunityType: json['opportunityType'] as String?,
      requestedAt: DateTime.parse(json['requestedAt'] as String),
      messageBusinessDate: json['messageBusinessDate'] as String?,
      status: json['status'] as String,
      mode: json['mode'] as String?,
      deliveryStatus: json['deliveryStatus'] as String?,
      failureCode: json['failureCode'] as String?,
      attempts: json['attempts'] as int? ?? 0,
      submittedAt: _parseDate(json['submittedAt']),
      failedAt: _parseDate(json['failedAt']),
      providerReady: json['providerReady'] as bool? ?? false,
      vipRequestId: json['vipRequestId'] as String?,
      executionState: json['executionState'] as String?,
      canCancel: json['canCancel'] as bool? ?? false,
      canMarkManualSent: json['canMarkManualSent'] as bool? ?? false,
      returnCommitment: json['returnCommitment'] is Map
          ? ReturnCommitmentSummary.fromJson(asJsonMap(json['returnCommitment']))
          : null,
    );
  }
}

class AdminNormalSalonFolder {
  const AdminNormalSalonFolder({
    required this.salonId,
    required this.salonName,
    required this.totalMessageCount,
    required this.sentMessageCount,
    required this.pendingMessageCount,
    required this.failedMessageCount,
    this.cancelledMessageCount = 0,
    this.latestActivityAt,
  });

  final String salonId;
  final String salonName;
  final int totalMessageCount;
  final int sentMessageCount;
  final int pendingMessageCount;
  final int failedMessageCount;
  final int cancelledMessageCount;
  final DateTime? latestActivityAt;

  factory AdminNormalSalonFolder.fromJson(Map<String, dynamic> json) {
    return AdminNormalSalonFolder(
      salonId: json['salonId'] as String,
      salonName: json['salonName'] as String,
      totalMessageCount: json['totalMessageCount'] as int? ?? 0,
      sentMessageCount: json['sentMessageCount'] as int? ?? 0,
      pendingMessageCount: json['pendingMessageCount'] as int? ?? 0,
      failedMessageCount: json['failedMessageCount'] as int? ?? 0,
      cancelledMessageCount: json['cancelledMessageCount'] as int? ?? 0,
      latestActivityAt: _parseDate(json['latestActivityAt']),
    );
  }
}

class AdminNormalSalonFolderDetail {
  const AdminNormalSalonFolderDetail({
    required this.salonId,
    required this.salonName,
    required this.totalMessageCount,
    required this.sentMessageCount,
    required this.pendingMessageCount,
    required this.failedMessageCount,
    required this.cancelledMessageCount,
    required this.page,
  });

  final String salonId;
  final String salonName;
  final int totalMessageCount;
  final int sentMessageCount;
  final int pendingMessageCount;
  final int failedMessageCount;
  final int cancelledMessageCount;
  final ItemPage<AdminQueueItem> page;

  factory AdminNormalSalonFolderDetail.fromJson(Object? json) {
    final map = json is Map ? asJsonMap(json) : <String, dynamic>{};
    return AdminNormalSalonFolderDetail(
      salonId: map['salonId'] as String? ?? '',
      salonName: map['salonName'] as String? ?? '',
      totalMessageCount: map['totalMessageCount'] as int? ?? 0,
      sentMessageCount: map['sentMessageCount'] as int? ?? 0,
      pendingMessageCount: map['pendingMessageCount'] as int? ?? 0,
      failedMessageCount: map['failedMessageCount'] as int? ?? 0,
      cancelledMessageCount: map['cancelledMessageCount'] as int? ?? 0,
      page: parseItemPage(json, AdminQueueItem.fromJson),
    );
  }
}

class VipTargetList {
  const VipTargetList({
    required this.id,
    required this.name,
    required this.status,
    required this.contactCount,
    this.regionCode,
    this.regionName,
    this.createdAt,
    this.attentionRequestId,
    this.reservedBySalonName,
    this.request,
    this.contacts = const [],
  });

  final String id;
  final String name;
  final String status;
  final int contactCount;
  final String? regionCode;
  final String? regionName;
  final DateTime? createdAt;
  final String? attentionRequestId;
  final String? reservedBySalonName;
  final VipRequest? request;
  final List<VipContact> contacts;

  bool get needsAttention => attentionRequestId != null;

  factory VipTargetList.fromJson(Map<String, dynamic> json) {
    return VipTargetList(
      id: json['id'] as String,
      name: json['name'] as String,
      status: json['status'] as String,
      contactCount: json['contactCount'] as int? ?? 0,
      regionCode: json['regionCode'] as String?,
      regionName: json['regionName'] as String?,
      createdAt: json['createdAt'] is String
          ? DateTime.tryParse(json['createdAt'] as String)
          : null,
      attentionRequestId: json['attentionRequestId'] as String?,
      reservedBySalonName: json['reservedBySalonName'] as String?,
      request: json['request'] is Map
          ? VipRequest.fromJson(asJsonMap(json['request']))
          : null,
      contacts: json['contacts'] is List
          ? (json['contacts'] as List)
              .whereType<Map>()
              .map((row) => VipContact.fromJson(asJsonMap(row)))
              .toList()
          : const [],
    );
  }
}

class VipRegion {
  const VipRegion({
    required this.regionCode,
    required this.regionName,
    required this.availableListCount,
    required this.availableContactCount,
  });

  final String regionCode;
  final String regionName;
  final int availableListCount;
  final int availableContactCount;

  factory VipRegion.fromJson(Map<String, dynamic> json) {
    return VipRegion(
      regionCode: json['regionCode'] as String,
      regionName: json['regionName'] as String,
      availableListCount: json['availableListCount'] as int? ?? 0,
      availableContactCount: json['availableContactCount'] as int? ?? 0,
    );
  }
}

class VipContact {
  const VipContact({
    this.displayName,
    required this.phoneNumber,
    required this.sortOrder,
  });

  final String? displayName;
  final String phoneNumber;
  final int sortOrder;

  factory VipContact.fromJson(Map<String, dynamic> json) {
    final rawName = json['displayName'];
    final name = rawName is String ? rawName.trim() : null;
    return VipContact(
      displayName: name == null || name.isEmpty ? null : name,
      phoneNumber: json['phoneNumber'] as String,
      sortOrder: json['sortOrder'] as int? ?? 0,
    );
  }
}

class VipRequest {
  const VipRequest({
    required this.id,
    required this.salonId,
    required this.salonName,
    required this.listId,
    required this.listName,
    required this.requestedCount,
    required this.geographicRange,
    required this.status,
    this.sampleWorks = const [],
  });

  final String id;
  final String salonId;
  final String salonName;
  final String listId;
  final String listName;
  final int requestedCount;
  final String geographicRange;
  final String status;
  final List<VipSampleWork> sampleWorks;

  factory VipRequest.fromJson(Map<String, dynamic> json) {
    return VipRequest(
      id: json['id'] as String,
      salonId: json['salonId'] as String,
      salonName: json['salonName'] as String? ?? '',
      listId: json['listId'] as String,
      listName: json['listName'] as String? ?? '',
      requestedCount: json['requestedCount'] as int? ?? 0,
      geographicRange: json['geographicRange'] as String? ?? '',
      status: json['status'] as String,
      sampleWorks: json['sampleWorks'] is List
          ? (json['sampleWorks'] as List)
              .whereType<Map>()
              .map((row) => VipSampleWork.fromJson(asJsonMap(row)))
              .toList()
          : const [],
    );
  }
}

class VipSampleWork {
  const VipSampleWork({
    required this.id,
    required this.position,
    required this.contentType,
    required this.byteSize,
  });

  final String id;
  final int position;
  final String contentType;
  final int byteSize;

  factory VipSampleWork.fromJson(Map<String, dynamic> json) {
    return VipSampleWork(
      id: json['id'] as String,
      position: json['position'] as int? ?? 0,
      contentType: json['contentType'] as String? ?? '',
      byteSize: json['byteSize'] as int? ?? 0,
    );
  }
}

class VipCapability {
  const VipCapability({
    required this.entitled,
    required this.remainingQuota,
    required this.usedQuota,
    this.quotaMax = 0,
    this.quotaWindowDays = 0,
    this.currentRequest,
  });

  final bool entitled;
  final int remainingQuota;
  final int usedQuota;
  final int quotaMax;
  final int quotaWindowDays;
  final VipRequest? currentRequest;

  factory VipCapability.fromJson(Map<String, dynamic> json) {
    return VipCapability(
      entitled: json['entitled'] as bool? ?? false,
      remainingQuota: json['remainingQuota'] as int? ?? 0,
      usedQuota: json['usedQuota'] as int? ?? 0,
      quotaMax: json['quotaMax'] as int? ?? 0,
      quotaWindowDays: json['quotaWindowDays'] as int? ?? 0,
      currentRequest: json['currentRequest'] is Map
          ? VipRequest.fromJson(asJsonMap(json['currentRequest']))
          : null,
    );
  }
}

class ReturnCommitmentSummary {
  const ReturnCommitmentSummary({
    required this.id,
    required this.expectedAt,
    this.actualVisitId,
    this.recordedBySupport = false,
    this.updatedAt,
  });

  final String id;
  final DateTime expectedAt;
  final String? actualVisitId;
  final bool recordedBySupport;
  final DateTime? updatedAt;

  bool get isFulfilled => actualVisitId != null;

  factory ReturnCommitmentSummary.fromJson(Map<String, dynamic> json) {
    return ReturnCommitmentSummary(
      id: json['id'] as String,
      expectedAt: DateTime.parse(json['expectedAt'] as String),
      actualVisitId: json['actualVisitId'] as String?,
      recordedBySupport: json['recordedBySupport'] as bool? ?? false,
      updatedAt: json['updatedAt'] is String
          ? DateTime.parse(json['updatedAt'] as String)
          : null,
    );
  }
}

class AssociatedRevenue {
  const AssociatedRevenue({
    required this.recorded,
    required this.currency,
    this.amount,
  });

  final bool recorded;
  final String currency;
  final String? amount;

  factory AssociatedRevenue.fromJson(Map<String, dynamic> json) {
    return AssociatedRevenue(
      recorded: json['recorded'] as bool? ?? false,
      currency: json['currency'] as String? ?? 'IRR',
      amount: json['amount'] as String?,
    );
  }
}

class CommitmentBackedReturn {
  const CommitmentBackedReturn({
    required this.associationKind,
    required this.actualVisitId,
    required this.visitedAt,
    required this.associatedRevenue,
  });

  final String associationKind;
  final String actualVisitId;
  final DateTime visitedAt;
  final AssociatedRevenue associatedRevenue;

  factory CommitmentBackedReturn.fromJson(Map<String, dynamic> json) {
    final visit = asJsonMap(json['actualVisit']);
    return CommitmentBackedReturn(
      associationKind: json['associationKind'] as String? ?? 'COMMITMENT_BACKED',
      actualVisitId: visit['visitId'] as String,
      visitedAt: DateTime.parse(visit['visitedAt'] as String),
      associatedRevenue: AssociatedRevenue.fromJson(
        asJsonMap(json['associatedRevenue']),
      ),
    );
  }
}

class ReturnCommitment {
  ReturnCommitment({
    required this.id,
    required this.customerId,
    required this.sourceRequestId,
    required this.sourceDeliveryId,
    required this.expectedAt,
    required this.createdAt,
    required this.updatedAt,
    this.actualVisitId,
    this.commitmentBackedReturn,
    this.recordedBySupport = false,
    bool? operationallyOpen,
  }) : operationallyOpen = operationallyOpen ?? (actualVisitId == null);

  final String id;
  final String customerId;
  final String sourceRequestId;
  final String sourceDeliveryId;
  final DateTime expectedAt;
  final String? actualVisitId;
  final DateTime createdAt;
  final DateTime updatedAt;
  final CommitmentBackedReturn? commitmentBackedReturn;
  final bool recordedBySupport;
  final bool operationallyOpen;

  bool get isFulfilled => actualVisitId != null;

  factory ReturnCommitment.fromJson(Map<String, dynamic> json) {
    final source = json['sourceMessage'] is Map
        ? asJsonMap(json['sourceMessage'])
        : const <String, dynamic>{};
    return ReturnCommitment(
      id: json['id'] as String,
      customerId: json['customerId'] as String,
      sourceRequestId: source['requestId'] as String? ?? '',
      sourceDeliveryId: source['deliveryId'] as String? ?? '',
      expectedAt: DateTime.parse(json['expectedAt'] as String),
      actualVisitId: json['actualVisitId'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      commitmentBackedReturn: json['commitmentBackedReturn'] is Map
          ? CommitmentBackedReturn.fromJson(
              asJsonMap(json['commitmentBackedReturn']),
            )
          : null,
      recordedBySupport: json['recordedBySupport'] as bool? ?? false,
      operationallyOpen: json['operationallyOpen'] as bool? ??
          json['actualVisitId'] == null,
    );
  }
}

class UpcomingReturnCommitment {
  const UpcomingReturnCommitment({
    required this.id,
    required this.customerId,
    required this.customerName,
    required this.expectedAt,
  });

  final String id;
  final String customerId;
  final String customerName;
  final DateTime expectedAt;

  factory UpcomingReturnCommitment.fromJson(Map<String, dynamic> json) {
    return UpcomingReturnCommitment(
      id: json['id'] as String,
      customerId: json['customerId'] as String,
      customerName: json['customerName'] as String,
      expectedAt: DateTime.parse(json['expectedAt'] as String),
    );
  }
}

class OpenAgreedReturn {
  const OpenAgreedReturn({
    required this.id,
    required this.customerId,
    required this.customerName,
    required this.customerPhone,
    required this.expectedAt,
    required this.overdue,
    this.recordedBySupport = false,
  });

  final String id;
  final String customerId;
  final String customerName;
  final String customerPhone;
  final DateTime expectedAt;
  final bool overdue;
  final bool recordedBySupport;

  factory OpenAgreedReturn.fromJson(Map<String, dynamic> json) {
    return OpenAgreedReturn(
      id: json['id'] as String,
      customerId: json['customerId'] as String,
      customerName: json['customerName'] as String,
      customerPhone: json['customerPhone'] as String,
      expectedAt: DateTime.parse(json['expectedAt'] as String),
      overdue: json['overdue'] as bool? ?? false,
      recordedBySupport: json['recordedBySupport'] as bool? ?? false,
    );
  }
}

class UpcomingReturnCommitmentPage {
  const UpcomingReturnCommitmentPage({
    required this.items,
    required this.hasMore,
    this.nextCursor,
    this.from,
    this.to,
  });

  final List<UpcomingReturnCommitment> items;
  final bool hasMore;
  final String? nextCursor;
  final DateTime? from;
  final DateTime? to;

  factory UpcomingReturnCommitmentPage.fromJson(Object? json) {
    final page = parseItemPage(json, UpcomingReturnCommitment.fromJson);
    final map = json is Map ? asJsonMap(json) : <String, dynamic>{};
    return UpcomingReturnCommitmentPage(
      items: page.items,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      from: _parseDate(map['from']),
      to: _parseDate(map['to']),
    );
  }
}

class ObservedReturn {
  const ObservedReturn({
    required this.associationKind,
    required this.requestId,
    required this.visitId,
    required this.visitedAt,
    required this.associatedRevenue,
  });

  final String associationKind;
  final String requestId;
  final String visitId;
  final DateTime visitedAt;
  final AssociatedRevenue associatedRevenue;

  factory ObservedReturn.fromJson(Map<String, dynamic> json) {
    final intervention = json['intervention'] is Map
        ? asJsonMap(json['intervention'])
        : const <String, dynamic>{};
    final message = intervention['message'] is Map
        ? asJsonMap(intervention['message'])
        : const <String, dynamic>{};
    final observed = json['observedReturn'] is Map
        ? asJsonMap(json['observedReturn'])
        : const <String, dynamic>{};
    return ObservedReturn(
      associationKind: json['associationKind'] as String? ?? 'OBSERVED',
      requestId: message['requestId'] as String? ?? '',
      visitId: observed['visitId'] as String,
      visitedAt: DateTime.parse(observed['occurredAt'] as String),
      associatedRevenue: AssociatedRevenue.fromJson(
        asJsonMap(json['associatedRevenue']),
      ),
    );
  }
}

class AdminSalonSummary {
  const AdminSalonSummary({
    required this.id,
    required this.name,
    required this.entitled,
  });

  final String id;
  final String name;
  final bool entitled;

  factory AdminSalonSummary.fromJson(Map<String, dynamic> json) {
    return AdminSalonSummary(
      id: json['id'] as String,
      name: json['name'] as String,
      entitled: json['entitled'] as bool? ?? false,
    );
  }
}

class AdminVipOutreachFolder {
  const AdminVipOutreachFolder({
    required this.salonId,
    required this.salonName,
    required this.requestCount,
    required this.recipientCount,
    required this.pendingMessageCount,
    required this.sentMessageCount,
    required this.failedMessageCount,
    this.cancelledMessageCount = 0,
    this.latestActivityAt,
  });

  final String salonId;
  final String salonName;
  final int requestCount;
  final int recipientCount;
  final int pendingMessageCount;
  final int sentMessageCount;
  final int failedMessageCount;
  final int cancelledMessageCount;
  final DateTime? latestActivityAt;

  factory AdminVipOutreachFolder.fromJson(Map<String, dynamic> json) {
    return AdminVipOutreachFolder(
      salonId: json['salonId'] as String,
      salonName: json['salonName'] as String,
      requestCount: json['requestCount'] as int? ?? 0,
      recipientCount: json['recipientCount'] as int? ?? 0,
      pendingMessageCount: json['pendingMessageCount'] as int? ?? 0,
      sentMessageCount: json['sentMessageCount'] as int? ?? 0,
      failedMessageCount: json['failedMessageCount'] as int? ?? 0,
      cancelledMessageCount: json['cancelledMessageCount'] as int? ?? 0,
      latestActivityAt: _parseDate(json['latestActivityAt']),
    );
  }
}

class AdminVipOutreachRequest {
  const AdminVipOutreachRequest({
    required this.id,
    required this.salonId,
    required this.salonName,
    required this.listId,
    required this.listName,
    required this.requestedCount,
    required this.geographicRange,
    required this.status,
    required this.recipientCount,
    required this.notYetQueuedCount,
    required this.queuedCount,
    required this.inPipelineCount,
    required this.sentCount,
    required this.failedCount,
    required this.sampleWorkCount,
    required this.canDispatchManual,
    this.regionCode,
    this.regionName,
    this.displayTitle,
    this.requestOrdinal = 0,
    this.cancelledCount = 0,
    this.createdAt,
    this.submittedAt,
  });

  final String id;
  final String salonId;
  final String salonName;
  final String listId;
  final String listName;
  final String? regionCode;
  final String? regionName;
  final int requestedCount;
  final String geographicRange;
  final String status;
  final int recipientCount;
  final int notYetQueuedCount;
  final int queuedCount;
  final int inPipelineCount;
  final int sentCount;
  final int failedCount;
  final int cancelledCount;
  final int sampleWorkCount;
  final bool canDispatchManual;
  final String? displayTitle;
  final int requestOrdinal;
  final DateTime? createdAt;
  final DateTime? submittedAt;

  factory AdminVipOutreachRequest.fromJson(Map<String, dynamic> json) {
    return AdminVipOutreachRequest(
      id: json['id'] as String,
      salonId: json['salonId'] as String,
      salonName: json['salonName'] as String? ?? '',
      listId: json['listId'] as String,
      listName: json['listName'] as String? ?? '',
      regionCode: json['regionCode'] as String?,
      regionName: json['regionName'] as String?,
      requestedCount: json['requestedCount'] as int? ?? 0,
      geographicRange: json['geographicRange'] as String? ?? '',
      status: json['status'] as String,
      recipientCount: json['recipientCount'] as int? ?? 0,
      notYetQueuedCount: json['notYetQueuedCount'] as int? ?? 0,
      queuedCount: json['queuedCount'] as int? ?? 0,
      inPipelineCount: json['inPipelineCount'] as int? ?? 0,
      sentCount: json['sentCount'] as int? ?? 0,
      failedCount: json['failedCount'] as int? ?? 0,
      cancelledCount: json['cancelledCount'] as int? ?? 0,
      sampleWorkCount: json['sampleWorkCount'] as int? ?? 0,
      canDispatchManual: json['canDispatchManual'] as bool? ?? false,
      displayTitle: json['displayTitle'] as String?,
      requestOrdinal: json['requestOrdinal'] as int? ?? 0,
      createdAt: _parseDate(json['createdAt']),
      submittedAt: _parseDate(json['submittedAt']),
    );
  }
}

class AdminVipOutreachRecipient {
  const AdminVipOutreachRecipient({
    required this.id,
    required this.sortOrder,
    required this.phoneNumber,
    required this.executionState,
    this.displayName,
    this.messageRequestId,
    this.messageRequestStatus,
    this.deliveryStatus,
    this.submittedAt,
    this.canCancel = false,
    this.canMarkManualSent = false,
  });

  final String id;
  final int sortOrder;
  final String? displayName;
  final String phoneNumber;
  final String? messageRequestId;
  final String? messageRequestStatus;
  final String? deliveryStatus;
  final DateTime? submittedAt;
  final String executionState;
  final bool canCancel;
  final bool canMarkManualSent;

  factory AdminVipOutreachRecipient.fromJson(Map<String, dynamic> json) {
    return AdminVipOutreachRecipient(
      id: json['id'] as String,
      sortOrder: json['sortOrder'] as int? ?? 0,
      displayName: json['displayName'] as String?,
      phoneNumber: json['phoneNumber'] as String? ?? '',
      messageRequestId: json['messageRequestId'] as String?,
      messageRequestStatus: json['messageRequestStatus'] as String?,
      deliveryStatus: json['deliveryStatus'] as String?,
      submittedAt: _parseDate(json['submittedAt']),
      executionState: json['executionState'] as String? ?? 'NOT_YET_QUEUED',
      canCancel: json['canCancel'] as bool? ?? false,
      canMarkManualSent: json['canMarkManualSent'] as bool? ?? false,
    );
  }
}

class AdminVipOutreachSalonPage {
  const AdminVipOutreachSalonPage({
    required this.salonId,
    required this.salonName,
    required this.page,
  });

  final String salonId;
  final String salonName;
  final ItemPage<AdminVipOutreachRequest> page;

  factory AdminVipOutreachSalonPage.fromJson(Object? json) {
    final map = json is Map ? asJsonMap(json) : <String, dynamic>{};
    return AdminVipOutreachSalonPage(
      salonId: map['salonId'] as String? ?? '',
      salonName: map['salonName'] as String? ?? '',
      page: parseItemPage(json, AdminVipOutreachRequest.fromJson),
    );
  }
}

class AdminVipOutreachRequestPage {
  const AdminVipOutreachRequestPage({
    required this.request,
    required this.page,
  });

  final AdminVipOutreachRequest request;
  final ItemPage<AdminVipOutreachRecipient> page;

  factory AdminVipOutreachRequestPage.fromJson(Object? json) {
    final map = json is Map ? asJsonMap(json) : <String, dynamic>{};
    return AdminVipOutreachRequestPage(
      request: AdminVipOutreachRequest.fromJson(asJsonMap(map['request'])),
      page: parseItemPage(json, AdminVipOutreachRecipient.fromJson),
    );
  }
}

class RecoveryOutcomesPeriod {
  const RecoveryOutcomesPeriod({
    required this.timezone,
    required this.start,
    required this.end,
    required this.previousWeekStart,
    required this.nextWeekStart,
    required this.current,
  });

  final String timezone;
  final DateTime start;
  final DateTime end;
  final DateTime previousWeekStart;
  final DateTime nextWeekStart;
  final bool current;

  factory RecoveryOutcomesPeriod.fromJson(Map<String, dynamic> json) {
    return RecoveryOutcomesPeriod(
      timezone: json['timezone'] as String? ?? 'Asia/Tehran',
      start: DateTime.parse(json['start'] as String).toUtc(),
      end: DateTime.parse(json['end'] as String).toUtc(),
      previousWeekStart: DateTime.parse(json['previousWeekStart'] as String).toUtc(),
      nextWeekStart: DateTime.parse(json['nextWeekStart'] as String).toUtc(),
      current: json['current'] as bool? ?? false,
    );
  }
}

class RecoveryOutcomesSummary {
  const RecoveryOutcomesSummary({
    required this.period,
    required this.sentFollowUps,
    required this.returnCommitmentsRecorded,
    required this.commitmentBackedReturns,
    required this.commitmentBackedRecordedRevenue,
    required this.observedReturns,
  });

  final RecoveryOutcomesPeriod period;
  final int sentFollowUps;
  final int returnCommitmentsRecorded;
  final int commitmentBackedReturns;
  final AssociatedRevenue commitmentBackedRecordedRevenue;
  final int observedReturns;

  factory RecoveryOutcomesSummary.fromJson(Map<String, dynamic> json) {
    return RecoveryOutcomesSummary(
      period: RecoveryOutcomesPeriod.fromJson(asJsonMap(json['period'])),
      sentFollowUps: json['sentFollowUps'] as int? ?? 0,
      returnCommitmentsRecorded: json['returnCommitmentsRecorded'] as int? ?? 0,
      commitmentBackedReturns: json['commitmentBackedReturns'] as int? ?? 0,
      commitmentBackedRecordedRevenue: AssociatedRevenue.fromJson(
        asJsonMap(json['commitmentBackedRecordedRevenue']),
      ),
      observedReturns: json['observedReturns'] as int? ?? 0,
    );
  }
}

class RecoveryOutcomeReturnItem {
  const RecoveryOutcomeReturnItem({
    required this.associationKind,
    required this.customerId,
    required this.customerName,
    required this.visitId,
    required this.visitedAt,
    required this.associatedRevenue,
    this.expectedAt,
  });

  final String associationKind;
  final String customerId;
  final String customerName;
  final String visitId;
  final DateTime visitedAt;
  final DateTime? expectedAt;
  final AssociatedRevenue associatedRevenue;

  factory RecoveryOutcomeReturnItem.fromJson(Map<String, dynamic> json) {
    final customer = json['customer'] is Map
        ? asJsonMap(json['customer'])
        : const <String, dynamic>{};
    return RecoveryOutcomeReturnItem(
      associationKind: json['associationKind'] as String? ?? '',
      customerId: customer['id'] as String? ?? '',
      customerName: customer['name'] as String? ?? '',
      visitId: json['visitId'] as String,
      visitedAt: DateTime.parse(json['visitedAt'] as String),
      expectedAt: _parseDate(json['expectedAt']),
      associatedRevenue: AssociatedRevenue.fromJson(
        asJsonMap(json['associatedRevenue']),
      ),
    );
  }
}

class OpportunityWorkspaceRow {
  const OpportunityWorkspaceRow({
    required this.rowKind,
    required this.stableId,
    required this.displayName,
    this.customerId,
    this.phoneNumber,
    this.messageState,
    this.messageRequestId,
    this.requestedAt,
    this.submittedAt,
    this.commitmentExpectedAt,
    this.returnEvidenceKind,
    this.previousVisitAt,
  });

  final String rowKind;
  final String stableId;
  final String displayName;
  final String? customerId;
  final String? phoneNumber;
  final String? messageState;
  final String? messageRequestId;
  final DateTime? requestedAt;
  final DateTime? submittedAt;
  final DateTime? commitmentExpectedAt;
  final String? returnEvidenceKind;
  final DateTime? previousVisitAt;

  bool get isVip => rowKind == 'VIP_RECIPIENT';

  factory OpportunityWorkspaceRow.fromJson(Map<String, dynamic> json) {
    return OpportunityWorkspaceRow(
      rowKind: json['rowKind'] as String,
      stableId: json['stableId'] as String,
      displayName: json['displayName'] as String? ?? '',
      customerId: json['customerId'] as String?,
      phoneNumber: json['phoneNumber'] as String?,
      messageState: json['messageState'] as String?,
      messageRequestId: json['messageRequestId'] as String?,
      requestedAt: _parseDate(json['requestedAt']),
      submittedAt: _parseDate(json['submittedAt']),
      commitmentExpectedAt: _parseDate(json['commitmentExpectedAt']),
      returnEvidenceKind: json['returnEvidenceKind'] as String?,
      previousVisitAt: _parseDate(json['previousVisitAt']),
    );
  }
}
