class VipCanonicalRegion {
  const VipCanonicalRegion(this.code, this.name);

  final String code;
  final String name;
}

const kVipCanonicalRegions = [
  VipCanonicalRegion('01', 'مرکز؛ حسن‌آباد، بازار و انقلاب'),
  VipCanonicalRegion('02', 'شمال؛ ونک، تجریش و پاسداران'),
  VipCanonicalRegion('03', 'شمال‌غرب؛ سعادت‌آباد، پونک و جنت‌آباد'),
  VipCanonicalRegion('04', 'غرب؛ صادقیه، آزادی و چیتگر'),
  VipCanonicalRegion('05', 'جنوب‌غرب؛ شادآباد، یافت‌آباد و نواب'),
  VipCanonicalRegion('06', 'جنوب؛ نازی‌آباد، شهرری و کهریزک'),
  VipCanonicalRegion('07', 'شرق؛ نارمک، تهرانپارس و شمیران‌نو'),
  VipCanonicalRegion('08', 'جنوب‌شرق؛ پیروزی، افسریه و خاوران'),
  VipCanonicalRegion('09', 'حومه غرب؛ شهریار، قدس و کرج'),
  VipCanonicalRegion('10', 'حومه جنوب‌غرب؛ اسلامشهر، رباط‌کریم و پرند'),
  VipCanonicalRegion('11', 'حومه جنوب؛ حسن‌آباد فشافویه و شمس‌آباد'),
  VipCanonicalRegion('12', 'حومه جنوب‌شرق؛ پاکدشت، قرچک و ورامین'),
  VipCanonicalRegion('13', 'حومه شمال‌شرق؛ جاجرود، پردیس و دماوند'),
  VipCanonicalRegion('14', 'حومه شمال؛ لواسان، فشم و میگون'),
];

bool isVipCanonicalRegionCode(String? code) =>
    code != null && kVipCanonicalRegions.any((region) => region.code == code);

VipCanonicalRegion? vipCanonicalRegionByCode(String? code) {
  if (code == null) {
    return null;
  }
  for (final region in kVipCanonicalRegions) {
    if (region.code == code) {
      return region;
    }
  }
  return null;
}
