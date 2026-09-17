import '../../shared/jalali.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

bool canRecordReturnCommitment(MessageDelivery message) {
  if (message.customerId.isEmpty) {
    return false;
  }
  if (message.status != 'SENT') {
    return false;
  }
  return message.returnCommitment == null;
}

bool isOpenReturnCommitment(ReturnCommitment commitment) =>
    commitment.actualVisitId == null;

bool isAgreedTimePast(ReturnCommitment commitment, [DateTime? now]) {
  if (commitment.actualVisitId != null) {
    return false;
  }
  return commitment.expectedAt.isBefore(now ?? DateTime.now());
}

Set<String> commitmentBackedVisitIds(Iterable<ReturnCommitment> commitments) {
  return {
    for (final row in commitments)
      if (row.actualVisitId != null) row.actualVisitId!,
  };
}

List<ObservedReturn> observedReturnsWithoutCommitmentWins({
  required Iterable<ObservedReturn> observed,
  required Iterable<ReturnCommitment> commitments,
}) {
  final preferred = commitmentBackedVisitIds(commitments);
  return [
    for (final row in observed)
      if (!preferred.contains(row.visitId)) row,
  ];
}

String formatRecordedRial(String amount) {
  return '${toPersianDigits(amount)} ${AppStrings.rial}';
}

String associatedRevenueCopy(AssociatedRevenue revenue) {
  if (!revenue.recorded || revenue.amount == null || revenue.amount!.isEmpty) {
    return AppStrings.recoveryRevenueNone;
  }
  return AppStrings.recoveryRevenueRecorded.replaceFirst(
    '{amount}',
    formatRecordedRial(revenue.amount!),
  );
}

String commitmentBackedHeadline() => AppStrings.recoveryCommitmentBackedTitle;

String commitmentBackedBody() => AppStrings.recoveryCommitmentBackedBody;

String observedReturnCopy() => AppStrings.recoveryObservedBody;

String upcomingDayHeading(DateTime expectedAt, [DateTime? now]) {
  final local = asLocalDateTime(expectedAt);
  final clock = now ?? DateTime.now();
  final today = DateTime(clock.year, clock.month, clock.day);
  final day = DateTime(local.year, local.month, local.day);
  if (day == today) {
    return AppStrings.today;
  }
  if (day == today.add(const Duration(days: 1))) {
    return AppStrings.outreachTomorrow;
  }
  return formatJalaliPrettyDate(local);
}

String formatClock(DateTime value) {
  final local = asLocalDateTime(value);
  return toPersianDigits(
    '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}',
  );
}
