class OutreachCustomerRef {
  const OutreachCustomerRef({required this.id, required this.fullName});

  final String id;
  final String fullName;
}

class ManualOutreachState {
  const ManualOutreachState({
    this.selecting = false,
    this.customers = const [],
    this.focusOutreachTab = false,
    this.limitMessage,
  });

  static const maxSelection = 30;

  final bool selecting;
  final List<OutreachCustomerRef> customers;
  final bool focusOutreachTab;
  final String? limitMessage;

  int get selectedCount => customers.length;

  bool isSelected(String customerId) =>
      customers.any((item) => item.id == customerId);

  ManualOutreachState copyWith({
    bool? selecting,
    List<OutreachCustomerRef>? customers,
    bool? focusOutreachTab,
    String? limitMessage,
    bool clearLimitMessage = false,
  }) {
    return ManualOutreachState(
      selecting: selecting ?? this.selecting,
      customers: customers ?? this.customers,
      focusOutreachTab: focusOutreachTab ?? this.focusOutreachTab,
      limitMessage: clearLimitMessage ? null : (limitMessage ?? this.limitMessage),
    );
  }
}
