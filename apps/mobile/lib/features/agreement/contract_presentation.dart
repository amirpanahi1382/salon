// Display-only helpers for the agreement screen.
// These never alter the server canonical document or its digest.

const contractV1VersionKey = 'CONTRACT_V1';
const contractV1Title = 'قرارداد ارائهٔ خدمات تبلیغاتی اپلیکیشن «جذب مشتری»';
const contractV1AppUiBlockHeading = '## متن گزینهٔ تأیید در اپلیکیشن';

class ContractPresentationText {
  const ContractPresentationText({
    required this.title,
    required this.body,
  });

  final String title;
  final String body;
}

int? _indexOfContractV1AppUiHeading(String normalized) {
  final heading = contractV1AppUiBlockHeading;
  if (normalized == heading || normalized.startsWith('$heading\n')) {
    return 0;
  }
  final marked = '\n$heading\n';
  final index = normalized.indexOf(marked);
  if (index >= 0) {
    return index + 1;
  }
  final atEnd = '\n$heading';
  if (normalized.endsWith(atEnd)) {
    return normalized.length - heading.length;
  }
  return null;
}

/// Removes the known CONTRACT_V1 app UI-description block when it matches exactly.
/// Returns [source] unchanged when the heading is absent.
/// Returns null when the heading is present but the following lines are not the
/// expected checkbox and button wording for this version.
String? stripContractV1AppUiDescriptionBlock(
  String source, {
  required String checkboxWording,
  required String buttonWording,
}) {
  final normalized = source.replaceAll('\r\n', '\n');
  final start = _indexOfContractV1AppUiHeading(normalized);
  if (start == null) {
    return normalized;
  }

  final before = normalized.substring(0, start);
  final block = normalized.substring(start);
  final expected = StringBuffer()
    ..writeln(contractV1AppUiBlockHeading)
    ..writeln()
    ..writeln('☐ $checkboxWording')
    ..writeln()
    ..write('**[$buttonWording]**');
  final expectedText = expected.toString();
  if (block == expectedText || block == '$expectedText\n') {
    return before.replaceFirst(RegExp(r'\n+$'), '');
  }
  return null;
}

({String? title, String body}) splitLeadingMarkdownTitle(String source) {
  final normalized = source.replaceAll('\r\n', '\n');
  if (!normalized.startsWith('# ')) {
    return (title: null, body: normalized);
  }
  final endOfLine = normalized.indexOf('\n');
  if (endOfLine < 0) {
    return (title: normalized.substring(2).trim(), body: '');
  }
  final title = normalized.substring(2, endOfLine).trim();
  var body = normalized.substring(endOfLine + 1);
  if (body.startsWith('\n')) {
    body = body.substring(1);
  }
  return (title: title.isEmpty ? null : title, body: body);
}

/// Removes a leading or embedded display copy of the known V1 title heading.
String omitContractV1TitleHeading(String source) {
  final normalized = source.replaceAll('\r\n', '\n');
  final heading = '# $contractV1Title';
  if (normalized == heading) {
    return '';
  }
  if (normalized.startsWith('$heading\n\n')) {
    return normalized.substring(heading.length + 2);
  }
  if (normalized.startsWith('$heading\n')) {
    return normalized.substring(heading.length + 1);
  }
  return normalized.replaceFirst('\n$heading\n\n', '\n').replaceFirst('\n$heading\n', '\n');
}

/// Prepares editable-segment or preview text for on-screen rendering only.
ContractPresentationText? prepareContractPresentation({
  required String versionKey,
  required String source,
  required String checkboxWording,
  required String buttonWording,
  String? stripTrailingFieldLabelFor,
}) {
  var working = source.replaceAll('\r\n', '\n');
  if (versionKey == contractV1VersionKey) {
    final stripped = stripContractV1AppUiDescriptionBlock(
      working,
      checkboxWording: checkboxWording,
      buttonWording: buttonWording,
    );
    if (stripped == null) {
      return null;
    }
    working = stripped;
  }

  final split = splitLeadingMarkdownTitle(working);
  var body = split.title != null ? split.body : working;
  if (versionKey == contractV1VersionKey) {
    body = omitContractV1TitleHeading(body);
  }
  if (stripTrailingFieldLabelFor != null) {
    body = stripTrailingArticle1FieldLabel(body, stripTrailingFieldLabelFor);
  }
  return ContractPresentationText(
    title: versionKey == contractV1VersionKey
        ? contractV1Title
        : (split.title ?? ''),
    body: body,
  );
}

/// Display-only: remove the contract-text label that sits immediately above an
/// Article 1 input. The server canonical document still contains these labels.
String stripTrailingArticle1FieldLabel(String source, String field) {
  final labels = switch (field) {
    'fullName' => const ['نام و نام خانوادگی: ', 'نام و نام خانوادگی:'],
    'nationalId' => const ['کد ملی: ', 'کد ملی:'],
    'salonName' => const ['نام سالن آرایشگاهی: ', 'نام سالن آرایشگاهی:'],
    'phone' => const ['شمارهٔ تماس: ', 'شمارهٔ تماس:', 'شماره تماس: ', 'شماره تماس:'],
    _ => const <String>[],
  };
  var body = source;
  for (final label in labels) {
    if (body.endsWith(label)) {
      body = body.substring(0, body.length - label.length);
      break;
    }
  }
  return body.replaceFirst(RegExp(r'\n+$'), '');
}
