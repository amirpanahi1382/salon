class OutreachCustomerRef {
  const OutreachCustomerRef({
    required this.id,
    required this.fullName,
    this.messageRequestId,
    this.status,
    this.requestedAt,
  });

  final String id;
  final String fullName;
  final String? messageRequestId;
  final String? status;
  final DateTime? requestedAt;

  bool get submitted => messageRequestId != null;
}

class ManualOutreachState {
  const ManualOutreachState({
    this.selecting = false,
    this.customers = const [],
    this.requested = const [],
    this.focusOutreachTab = false,
    this.limitMessage,
  });

  static const maxSelection = 30;

  final bool selecting;
  final List<OutreachCustomerRef> customers;
  final List<OutreachCustomerRef> requested;
  final bool focusOutreachTab;
  final String? limitMessage;

  int get selectedCount => customers.length;

  bool isSelected(String customerId) =>
      customers.any((item) => item.id == customerId);

  List<OutreachCustomerRef> get inbox {
    final seen = <String>{};
    final items = <OutreachCustomerRef>[];
    final requestedById = {for (final item in requested) item.id: item};
    for (final selected in customers) {
      seen.add(selected.id);
      items.add(requestedById[selected.id] ?? selected);
    }
    for (final item in requested) {
      if (!seen.contains(item.id)) {
        items.add(item);
      }
    }
    return items;
  }

  ManualOutreachState copyWith({
    bool? selecting,
    List<OutreachCustomerRef>? customers,
    List<OutreachCustomerRef>? requested,
    bool? focusOutreachTab,
    String? limitMessage,
    bool clearLimitMessage = false,
  }) {
    return ManualOutreachState(
      selecting: selecting ?? this.selecting,
      customers: customers ?? this.customers,
      requested: requested ?? this.requested,
      focusOutreachTab: focusOutreachTab ?? this.focusOutreachTab,
      limitMessage: clearLimitMessage ? null : (limitMessage ?? this.limitMessage),
    );
  }
}
