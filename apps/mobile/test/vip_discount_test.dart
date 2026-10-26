import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/features/vip/vip_discount.dart';
import 'package:salon_mobile/shared/labels.dart';

const _copy = VipDiscountCopy(
  percentRange: AppStrings.vipDiscountPercentRange,
  amountRequired: AppStrings.vipDiscountAmountRequired,
  rialRequired: AppStrings.vipDiscountRialRequired,
);

void main() {
  test('none is valid and does not block create', () {
    final parsed = parseVipDiscount(VipDiscountKind.none, '20', copy: _copy);
    expect(parsed.valid, isTrue);
    expect(parsed.isNonzero, isFalse);
    expect(parsed.blocksCreate, isFalse);
    expect(parsed.asciiAmount, isNull);
  });

  test('percent accepts Persian digits in 1-100', () {
    final parsed = parseVipDiscount(VipDiscountKind.percent, '۲۰', copy: _copy);
    expect(parsed.valid, isTrue);
    expect(parsed.isNonzero, isTrue);
    expect(parsed.blocksCreate, isTrue);
    expect(parsed.asciiAmount, '20');
  });

  test('percent rejects 0 and 101', () {
    expect(
      parseVipDiscount(VipDiscountKind.percent, '0', copy: _copy).valid,
      isFalse,
    );
    expect(
      parseVipDiscount(VipDiscountKind.percent, '101', copy: _copy).error,
      AppStrings.vipDiscountPercentRange,
    );
  });

  test('rial accepts a positive integer string and rejects zero', () {
    final parsed = parseVipDiscount(VipDiscountKind.irr, '۵۰۰۰۰', copy: _copy);
    expect(parsed.valid, isTrue);
    expect(parsed.asciiAmount, '50000');
    expect(parsed.blocksCreate, isTrue);
    expect(
      parseVipDiscount(VipDiscountKind.irr, '0', copy: _copy).valid,
      isFalse,
    );
  });
}
