import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

typedef PhoneLauncher = Future<bool> Function(String phone);

Future<bool> launchCustomerPhone(String phone) async {
  final uri = Uri(scheme: 'tel', path: phone);
  try {
    return await launchUrl(uri);
  } catch (error, stack) {
    debugPrint('tel launch failed: $error\n$stack');
    return false;
  }
}

final phoneLauncherProvider = Provider<PhoneLauncher>((ref) => launchCustomerPhone);
