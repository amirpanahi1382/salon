/// Formats an absolute instant for API contracts that accept ISO-8601
/// timestamps with at most millisecond precision.
String toApiInstant(DateTime value) {
  final utc = value.toUtc();
  return DateTime.fromMillisecondsSinceEpoch(
    utc.millisecondsSinceEpoch,
    isUtc: true,
  ).toIso8601String();
}
