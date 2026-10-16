import 'package:dio/dio.dart';

import '../../core/networking/api_client.dart';
import '../../shared/models/models.dart';

class PaymentInstructions {
  const PaymentInstructions({
    required this.cardNumber,
    required this.cardNumberCopy,
    required this.cardholderName,
    required this.amountLabel,
    required this.amountCopy,
    required this.amountIrr,
    required this.notice,
  });

  final String cardNumber;
  final String cardNumberCopy;
  final String cardholderName;
  final String amountLabel;
  final String amountCopy;
  final String amountIrr;
  final String notice;

  factory PaymentInstructions.fromJson(Map<String, dynamic> json) {
    return PaymentInstructions(
      cardNumber: requiredJsonString(json['cardNumber'], 'cardNumber'),
      cardNumberCopy: requiredJsonString(json['cardNumberCopy'], 'cardNumberCopy'),
      cardholderName: requiredJsonString(json['cardholderName'], 'cardholderName'),
      amountLabel: requiredJsonString(json['amountLabel'], 'amountLabel'),
      amountCopy: requiredJsonString(json['amountCopy'], 'amountCopy'),
      amountIrr: requiredJsonString(json['amountIrr'], 'amountIrr'),
      notice: requiredJsonString(json['notice'], 'notice'),
    );
  }
}

class ActivationStatus {
  const ActivationStatus({
    required this.phase,
    required this.receiptReady,
    this.receiptId,
    this.rejectionReason,
    this.submittedAt,
    this.instructions,
  });

  final String phase;
  final bool receiptReady;
  final String? receiptId;
  final String? rejectionReason;
  final String? submittedAt;
  final PaymentInstructions? instructions;

  factory ActivationStatus.fromJson(Object? json) {
    final map = asJsonMap(json);
    final instructions = map['instructions'];
    return ActivationStatus(
      phase: requiredJsonString(map['phase'], 'phase'),
      receiptReady: map['receiptReady'] == true,
      receiptId: map['receiptId'] as String?,
      rejectionReason: map['rejectionReason'] as String?,
      submittedAt: map['submittedAt'] as String?,
      instructions: instructions == null
          ? null
          : PaymentInstructions.fromJson(asJsonMap(instructions)),
    );
  }
}

class StoredReceipt {
  const StoredReceipt({required this.receiptId, required this.phase});

  final String receiptId;
  final String phase;

  factory StoredReceipt.fromJson(Object? json) {
    final map = asJsonMap(json);
    return StoredReceipt(
      receiptId: requiredJsonString(map['receiptId'], 'receiptId'),
      phase: requiredJsonString(map['phase'], 'phase'),
    );
  }
}

class ActivationReceiptSummary {
  const ActivationReceiptSummary({
    required this.id,
    required this.phase,
    required this.submittedAt,
    required this.salonName,
    required this.ownerName,
  });

  final String id;
  final String phase;
  final String? submittedAt;
  final String salonName;
  final String ownerName;

  factory ActivationReceiptSummary.fromJson(Map<String, dynamic> json) {
    return ActivationReceiptSummary(
      id: requiredJsonString(json['id'], 'id'),
      phase: requiredJsonString(json['phase'], 'phase'),
      submittedAt: json['submittedAt'] as String?,
      salonName: requiredJsonString(json['salonName'], 'salonName'),
      ownerName: requiredJsonString(json['ownerName'], 'ownerName'),
    );
  }
}

class ActivationReceiptReview {
  const ActivationReceiptReview({
    required this.id,
    required this.phase,
    required this.submittedAt,
    required this.salonName,
    required this.ownerName,
    required this.agreementVersionKey,
    required this.amountLabel,
    required this.cardNumber,
    required this.cardholderName,
    required this.notice,
    required this.requiredBankAttestation,
    this.rejectionReason,
  });

  final String id;
  final String phase;
  final String? submittedAt;
  final String salonName;
  final String ownerName;
  final String agreementVersionKey;
  final String amountLabel;
  final String cardNumber;
  final String cardholderName;
  final String notice;
  final String requiredBankAttestation;
  final String? rejectionReason;

  factory ActivationReceiptReview.fromJson(Object? json) {
    final map = asJsonMap(json);
    final instructions = asJsonMap(map['instructions']);
    return ActivationReceiptReview(
      id: requiredJsonString(map['id'], 'id'),
      phase: requiredJsonString(map['phase'], 'phase'),
      submittedAt: map['submittedAt'] as String?,
      salonName: requiredJsonString(map['salonName'], 'salonName'),
      ownerName: requiredJsonString(map['ownerName'], 'ownerName'),
      agreementVersionKey: requiredJsonString(map['agreementVersionKey'], 'agreementVersionKey'),
      amountLabel: requiredJsonString(instructions['amountLabel'], 'amountLabel'),
      cardNumber: requiredJsonString(instructions['cardNumber'], 'cardNumber'),
      cardholderName: requiredJsonString(instructions['cardholderName'], 'cardholderName'),
      notice: requiredJsonString(map['notice'], 'notice'),
      requiredBankAttestation: map['requiredBankAttestation'] as String? ?? '',
      rejectionReason: map['rejectionReason'] as String?,
    );
  }
}

class ActivationRepository {
  ActivationRepository(this._api);

  final ApiClient _api;

  Future<ActivationStatus> status() async {
    return ActivationStatus.fromJson(await _api.get('/activation/status'));
  }

  Future<StoredReceipt> upload({
    required List<int> bytes,
    required String filename,
    required void Function(int sent, int total) onProgress,
  }) async {
    final data = await _api.postForm(
      '/activation/receipts',
      FormData.fromMap({
        'file': MultipartFile.fromBytes(bytes, filename: filename),
      }),
      onSendProgress: onProgress,
    );
    return StoredReceipt.fromJson(data);
  }

  Future<void> submit({
    required String receiptId,
    required String idempotencyKey,
  }) async {
    await _api.post(
      '/activation/receipts/$receiptId/submit',
      headers: {'Idempotency-Key': idempotencyKey},
    );
  }

  Future<List<ActivationReceiptSummary>> listPending() async {
    final data = asJsonMap(await _api.get('/admin/activation-receipts'));
    final items = data['items'];
    if (items is! List) {
      return const [];
    }
    return items
        .map((item) => ActivationReceiptSummary.fromJson(asJsonMap(item)))
        .toList();
  }

  Future<ActivationReceiptReview> review(String id) async {
    return ActivationReceiptReview.fromJson(await _api.get('/admin/activation-receipts/$id'));
  }

  Future<List<int>> image(String id) {
    return _api.getBytes('/admin/activation-receipts/$id/image');
  }

  Future<void> approve({
    required String id,
    required String idempotencyKey,
    required String bankAttestation,
  }) async {
    await _api.post(
      '/admin/activation-receipts/$id/approve',
      data: {'bankAttestation': bankAttestation},
      headers: {'Idempotency-Key': idempotencyKey},
    );
  }

  Future<void> reject({
    required String id,
    required String reason,
    required String idempotencyKey,
  }) async {
    await _api.post(
      '/admin/activation-receipts/$id/reject',
      data: {'reason': reason},
      headers: {'Idempotency-Key': idempotencyKey},
    );
  }
}
