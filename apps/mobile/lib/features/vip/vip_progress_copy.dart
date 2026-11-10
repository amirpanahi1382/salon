bool shouldDisplayVipProgressExplanation(String explanation) {
  final text = explanation.trim();
  if (text.isEmpty) {
    return false;
  }
  if (text.startsWith(
    'این عنوان فقط ثبت درخواست است و به معنای ارسال یا تحویل پیام نیست',
  )) {
    return false;
  }
  if (text.startsWith('رسیدگی دستی شروع شده است')) {
    return false;
  }
  return true;
}
