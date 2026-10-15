import '../../core/networking/api_client.dart';
import '../../shared/models/models.dart';

const agreementAppHeaders = {
  'x-app-version': '1.0.0',
  'x-app-build': '1',
};

class AgreementSegment {
  const AgreementSegment.text(this.text) : field = null;
  const AgreementSegment.field(this.field) : text = null;

  final String? text;
  final String? field;

  factory AgreementSegment.fromJson(Map<String, dynamic> json) {
    if (json['type'] == 'field') {
      return AgreementSegment.field(json['field'] as String);
    }
    return AgreementSegment.text(json['text'] as String? ?? '');
  }
}

class AgreementContract {
  const AgreementContract({
    required this.versionKey,
    required this.templateDigest,
    required this.amountIrr,
    required this.amountLabel,
    required this.checkboxWording,
    required this.buttonWording,
    required this.verifiedPhone,
    required this.segments,
  });

  final String versionKey;
  final String templateDigest;
  final String amountIrr;
  final String amountLabel;
  final String checkboxWording;
  final String buttonWording;
  final String verifiedPhone;
  final List<AgreementSegment> segments;

  factory AgreementContract.fromJson(Object? json) {
    final map = asJsonMap(json);
    final segments = map['segments'];
    return AgreementContract(
      versionKey: requiredJsonString(map['versionKey'], 'versionKey'),
      templateDigest: requiredJsonString(map['templateDigest'], 'templateDigest'),
      amountIrr: requiredJsonString(map['amountIrr'], 'amountIrr'),
      amountLabel: requiredJsonString(map['amountLabel'], 'amountLabel'),
      checkboxWording: requiredJsonString(map['checkboxWording'], 'checkboxWording'),
      buttonWording: requiredJsonString(map['buttonWording'], 'buttonWording'),
      verifiedPhone: requiredJsonString(map['verifiedPhone'], 'verifiedPhone'),
      segments: segments is List
          ? segments.map((item) => AgreementSegment.fromJson(asJsonMap(item))).toList()
          : const [],
    );
  }
}

class AgreementPreview {
  const AgreementPreview({
    required this.presentationId,
    required this.versionKey,
    required this.renderedDigest,
    required this.amountLabel,
    required this.buttonWording,
    required this.canonicalDocument,
  });

  final String presentationId;
  final String versionKey;
  final String renderedDigest;
  final String amountLabel;
  final String buttonWording;
  final String canonicalDocument;

  factory AgreementPreview.fromJson(Object? json) {
    final map = asJsonMap(json);
    return AgreementPreview(
      presentationId: requiredJsonString(map['presentationId'], 'presentationId'),
      versionKey: requiredJsonString(map['versionKey'], 'versionKey'),
      renderedDigest: requiredJsonString(map['renderedDigest'], 'renderedDigest'),
      amountLabel: requiredJsonString(map['amountLabel'], 'amountLabel'),
      buttonWording: requiredJsonString(map['buttonWording'], 'buttonWording'),
      canonicalDocument: requiredJsonString(map['canonicalDocument'], 'canonicalDocument'),
    );
  }
}

class AgreementAcceptanceResult {
  const AgreementAcceptanceResult({
    required this.acceptanceId,
    required this.accessState,
    required this.statement,
  });

  final String acceptanceId;
  final String accessState;
  final String statement;

  factory AgreementAcceptanceResult.fromJson(Object? json) {
    final map = asJsonMap(json);
    return AgreementAcceptanceResult(
      acceptanceId: requiredJsonString(map['acceptanceId'], 'acceptanceId'),
      accessState: requiredJsonString(map['accessState'], 'accessState'),
      statement: requiredJsonString(map['statement'], 'statement'),
    );
  }
}

class AgreementReceipt {
  const AgreementReceipt({
    required this.versionKey,
    required this.acceptedAt,
    required this.renderedDigest,
    required this.statement,
  });

  final String versionKey;
  final String acceptedAt;
  final String renderedDigest;
  final String statement;

  factory AgreementReceipt.fromJson(Object? json) {
    final map = asJsonMap(json);
    return AgreementReceipt(
      versionKey: requiredJsonString(map['versionKey'], 'versionKey'),
      acceptedAt: requiredJsonString(map['acceptedAt'], 'acceptedAt'),
      renderedDigest: requiredJsonString(map['renderedDigest'], 'renderedDigest'),
      statement: requiredJsonString(map['statement'], 'statement'),
    );
  }
}

class AgreementRepository {
  AgreementRepository(this._api);

  final ApiClient _api;

  Future<AgreementContract> current() async {
    return AgreementContract.fromJson(
      await _api.get('/agreement/current', headers: agreementAppHeaders),
    );
  }

  Future<AgreementPreview> present({
    required String fullName,
    required String nationalId,
    required String salonName,
    required String phone,
  }) async {
    return AgreementPreview.fromJson(
      await _api.post(
        '/agreement/presentations',
        headers: agreementAppHeaders,
        data: {
          'fullName': fullName,
          'nationalId': nationalId,
          'salonName': salonName,
          'phone': phone,
        },
      ),
    );
  }

  Future<AgreementAcceptanceResult> accept({
    required String presentationId,
    required String idempotencyKey,
  }) async {
    return AgreementAcceptanceResult.fromJson(
      await _api.post(
        '/agreement/acceptance',
        headers: {
          ...agreementAppHeaders,
          'Idempotency-Key': idempotencyKey,
        },
        data: {'presentationId': presentationId, 'accepted': true},
      ),
    );
  }

  Future<AgreementReceipt> receipt() async {
    return AgreementReceipt.fromJson(
      await _api.get('/agreement/acceptance/receipt', headers: agreementAppHeaders),
    );
  }
}
