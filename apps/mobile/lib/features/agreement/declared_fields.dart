/// Client-side mirrors of apps/api declared-field normalization.
/// Server remains the authority; these keep invalid values from preview/consent.
library;

const _zwnj = '\u200c';
const _fillMark = '[توسط سفارش';
const _persianDigits = '۰۱۲۳۴۵۶۷۸۹';
const _arabicDigits = '٠١٢٣٤٥٦٧٨٩';

/// Persian name letters only (plus آ). Excludes Urdu-specific and other
/// Arabic-script letters that a broad Script=Arabic check would admit.
const _persianNameLetters = 'ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهیآ';

const _arabicToPersianLetter = <String, String>{
  '\u064A': '\u06CC', // ي → ی
  '\u0643': '\u06A9', // ك → ک
  '\u0629': '\u0647', // ة → ه
};

enum DeclaredFieldKind { fullName, nationalId, salonName }

class DeclaredFieldValidation {
  const DeclaredFieldValidation._(this.error);

  const DeclaredFieldValidation.ok() : error = null;

  final String? error;

  bool get isValid => error == null;
}

DeclaredFieldValidation validateDeclaredFullName(String input) {
  final value = normalizeDeclaredFullName(input);
  if (value == null) {
    return const DeclaredFieldValidation._('نام را با حروف فارسی وارد کنید.');
  }
  return const DeclaredFieldValidation.ok();
}

DeclaredFieldValidation validateDeclaredNationalId(String input) {
  final parsed = parseIranianNationalId(input);
  return switch (parsed.status) {
    NationalIdStatus.ok => const DeclaredFieldValidation.ok(),
    NationalIdStatus.empty =>
      const DeclaredFieldValidation._('کد ملی ده رقمی را وارد کنید.'),
    NationalIdStatus.format =>
      const DeclaredFieldValidation._('کد ملی باید دقیقاً ۱۰ رقم باشد.'),
    NationalIdStatus.checksum =>
      const DeclaredFieldValidation._('کد ملی معتبر نیست.'),
  };
}

DeclaredFieldValidation validateDeclaredSalonName(String input) {
  final value = normalizeDeclaredSalonName(input);
  if (value == null) {
    return const DeclaredFieldValidation._('نام سالن را وارد کنید.');
  }
  return const DeclaredFieldValidation.ok();
}

String? normalizeDeclaredFullName(String input) {
  final compacted = _normalizeWhitespaceAndHalfSpace(input);
  if (compacted.isEmpty || compacted.length > 80 || compacted.contains(_fillMark)) {
    return null;
  }
  if (RegExp(r'[\u0000-\u001F\u007F]').hasMatch(compacted)) {
    return null;
  }
  final buffer = StringBuffer();
  for (final char in compacted.charactersOrUnits) {
    if (char == ' ' || char == _zwnj) {
      buffer.write(char);
      continue;
    }
    final mapped = _arabicToPersianLetter[char] ?? char;
    if (!_isPersianNameLetter(mapped)) {
      return null;
    }
    buffer.write(mapped);
  }
  final normalized = buffer.toString();
  if (!_hasPersianLetter(normalized) || !_separatorsOnlyBetweenLetters(normalized)) {
    return null;
  }
  return normalized;
}

String? normalizeDeclaredSalonName(String input) {
  final compacted = _normalizeWhitespaceAndHalfSpace(input);
  if (compacted.isEmpty || compacted.length > 120) {
    return null;
  }
  if (RegExp(r'[\u0000-\u001F\u007F]').hasMatch(compacted) ||
      compacted.contains(_fillMark)) {
    return null;
  }
  // Analyzer's valid_regexps lint does not accept Unicode property escapes;
  // runtime Dart RegExp with unicode:true does.
  // ignore: valid_regexps
  if (RegExp(r'\p{Extended_Pictographic}', unicode: true).hasMatch(compacted)) {
    return null;
  }
  final buffer = StringBuffer();
  for (final char in compacted.charactersOrUnits) {
    buffer.write(_arabicToPersianLetter[char] ?? char);
  }
  final normalized = buffer.toString();
  if (!RegExp(r'\p{L}', unicode: true).hasMatch(normalized)) {
    return null;
  }
  return normalized;
}

enum NationalIdStatus { ok, empty, format, checksum }

class NationalIdParse {
  const NationalIdParse.ok(this.value) : status = NationalIdStatus.ok;
  const NationalIdParse.empty()
      : status = NationalIdStatus.empty,
        value = null;
  const NationalIdParse.format()
      : status = NationalIdStatus.format,
        value = null;
  const NationalIdParse.checksum()
      : status = NationalIdStatus.checksum,
        value = null;

  final NationalIdStatus status;
  final String? value;
}

NationalIdParse parseIranianNationalId(String input) {
  final digits = toAsciiDigits(input).replaceAll(RegExp(r'\s'), '');
  if (digits.isEmpty) {
    return const NationalIdParse.empty();
  }
  if (!RegExp(r'^\d+$').hasMatch(digits)) {
    return const NationalIdParse.format();
  }
  if (digits.length != 10 || RegExp(r'^(\d)\1{9}$').hasMatch(digits)) {
    return const NationalIdParse.format();
  }
  var sum = 0;
  for (var index = 0; index < 9; index += 1) {
    sum += int.parse(digits[index]) * (10 - index);
  }
  final remainder = sum % 11;
  final check = remainder < 2 ? remainder : 11 - remainder;
  if (check != int.parse(digits[9])) {
    return const NationalIdParse.checksum();
  }
  return NationalIdParse.ok(digits);
}

String toAsciiDigits(String input) {
  return input.trim().replaceAllMapped(RegExp(r'[۰-۹٠-٩]'), (match) {
    final digit = match.group(0)!;
    final persian = _persianDigits.indexOf(digit);
    if (persian >= 0) {
      return '$persian';
    }
    return '${_arabicDigits.indexOf(digit)}';
  });
}

String _normalizeWhitespaceAndHalfSpace(String input) {
  return input
      .replaceAll('\u00a0', ' ')
      .replaceAll(RegExp(r'[ \t]+'), ' ')
      .replaceAll(RegExp('(?:$_zwnj){2,}'), _zwnj)
      .trim();
}

bool _isPersianNameLetter(String char) {
  return _persianNameLetters.contains(char);
}

bool _hasPersianLetter(String value) {
  for (final char in value.charactersOrUnits) {
    if (_isPersianNameLetter(char)) {
      return true;
    }
  }
  return false;
}

/// Spaces and half-spaces are allowed only between two Persian letters.
bool _separatorsOnlyBetweenLetters(String value) {
  final units = value.charactersOrUnits.toList();
  for (var index = 0; index < units.length; index += 1) {
    final char = units[index];
    if (char != ' ' && char != _zwnj) {
      continue;
    }
    if (index == 0 || index + 1 >= units.length) {
      return false;
    }
    if (!_isPersianNameLetter(units[index - 1]) ||
        !_isPersianNameLetter(units[index + 1])) {
      return false;
    }
  }
  return true;
}

extension on String {
  /// Iterate Unicode scalar values without depending on package:characters.
  Iterable<String> get charactersOrUnits sync* {
    var index = 0;
    while (index < length) {
      final unit = codeUnitAt(index);
      if (unit >= 0xD800 && unit <= 0xDBFF && index + 1 < length) {
        yield substring(index, index + 2);
        index += 2;
      } else {
        yield substring(index, index + 1);
        index += 1;
      }
    }
  }
}
