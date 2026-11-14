enum FollowUpsTab {
  customers,
  vip;

  static const path = '/follow-ups';
  static const queryName = 'tab';
  static const customersQuery = 'customers';
  static const vipQuery = 'vip';

  String get queryValue =>
      this == FollowUpsTab.vip ? vipQuery : customersQuery;

  /// Default entry has no query and opens [customers].
  static const defaultRoute = path;

  /// Explicit tab for dashboard rows that must land on a specific list.
  String get route => '$path?$queryName=$queryValue';

  static FollowUpsTab parse(String? value) {
    if (value == vipQuery) {
      return FollowUpsTab.vip;
    }
    return FollowUpsTab.customers;
  }
}
