import '../../shared/jalali.dart';

/// Local UI-only discount draft. Not part of VipRequest or the create payload.
enum VipDiscountKind { none, percent, irr }

class VipDiscountParse {
  const VipDiscountParse({
    required this.kind,
    required this.valid,
    required this.isNonzero,
    this.asciiAmount,
    this.error,
  });

  final VipDiscountKind kind;
  final bool valid;
  final bool isNonzero;
  final String? asciiAmount;
  final String? error;

  bool get blocksCreate => kind != VipDiscountKind.none;
}

class VipDiscountCopy {
  const VipDiscountCopy({
    required this.percentRange,
    required this.amountRequired,
    required this.rialRequired,
  });

  final String percentRange;
  final String amountRequired;
  final String rialRequired;
}

VipDiscountParse parseVipDiscount(
  VipDiscountKind kind,
  String raw, {
  required VipDiscountCopy copy,
}) {
  if (kind == VipDiscountKind.none) {
    return const VipDiscountParse(
      kind: VipDiscountKind.none,
      valid: true,
      isNonzero: false,
    );
  }
  final digits = fromPersianDigits(raw).replaceAll(RegExp(r'[\s,]'), '');
  if (digits.isEmpty) {
    return VipDiscountParse(
      kind: kind,
      valid: false,
      isNonzero: false,
      error: kind == VipDiscountKind.percent ? copy.amountRequired : copy.rialRequired,
    );
  }
  if (!RegExp(r'^\d+$').hasMatch(digits)) {
    return VipDiscountParse(
      kind: kind,
      valid: false,
      isNonzero: false,
      error: kind == VipDiscountKind.percent ? copy.amountRequired : copy.rialRequired,
    );
  }
  if (kind == VipDiscountKind.percent) {
    final value = int.parse(digits);
    if (value < 1 || value > 100) {
      return VipDiscountParse(
        kind: kind,
        valid: false,
        isNonzero: false,
        asciiAmount: digits,
        error: copy.percentRange,
      );
    }
    return VipDiscountParse(
      kind: kind,
      valid: true,
      isNonzero: true,
      asciiAmount: value.toString(),
    );
  }
  if (digits.length > 12 || RegExp(r'^0+$').hasMatch(digits)) {
    return VipDiscountParse(
      kind: kind,
      valid: false,
      isNonzero: false,
      asciiAmount: digits,
      error: copy.rialRequired,
    );
  }
  return VipDiscountParse(
    kind: kind,
    valid: true,
    isNonzero: true,
    asciiAmount: digits.replaceFirst(RegExp(r'^0+'), ''),
  );
}
