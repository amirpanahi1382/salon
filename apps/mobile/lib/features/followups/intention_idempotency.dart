import '../../core/networking/api_client.dart';

/// One idempotency key for an unchanged pending submission.
/// A material payload change replaces the key. Confirmed success clears it.
class StableIdempotencyKey {
  String? _key;
  String? _signature;

  String forPayload(String signature) {
    if (_key == null || _signature != signature) {
      _key = createRequestId();
      _signature = signature;
    }
    return _key!;
  }

  void succeed() {
    _key = null;
    _signature = null;
  }
}

String visitIntentionTimeSignature(Map<String, dynamic> time) {
  return '${time['precision']}|${time['agreedDate'] ?? ''}|${time['agreedInstant'] ?? ''}';
}
