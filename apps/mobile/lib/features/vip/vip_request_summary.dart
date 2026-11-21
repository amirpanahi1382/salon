import 'package:flutter/material.dart';

import '../../core/theme/app_tokens.dart';
import '../../core/widgets/app_widgets.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';

/// Salon-facing requested quantity: zero until final submission.
String vipSummaryRequestedValue(VipRequestHistoryItem item) {
  return item.request.submittedAt == null
      ? '0'
      : item.request.requestedCount.toString();
}

/// Visit intentions recorded by the salon or admin for this request.
String vipSummaryIntentionsValue(VipRequestHistoryItem item) {
  if (!item.metricsAvailable) {
    return '—';
  }
  return '${item.reportedIntentionCount ?? 0}';
}

/// Manual sends recorded by the platform admin.
String vipSummaryRecordedSendsValue(VipRequestHistoryItem item) {
  return '${item.manualRecordedSendCount}';
}

/// Distinct recipients with a recorded visit for this request.
String vipSummaryVisitedValue(VipRequestHistoryItem item) {
  if (!item.metricsAvailable) {
    return '—';
  }
  return '${item.visitedRecipientCount ?? 0}';
}

VipRequestHistoryItem vipHistoryItemFromRequest(VipRequest request) {
  final cancelledUnsubmitted =
      request.status == 'CANCELLED' && request.submittedAt == null;
  return VipRequestHistoryItem(
    request: request,
    recordedSendCount: 0,
    manualRecordedSendCount: 0,
    stillQueuedOrInProgressCount: 0,
    intentionRecipientCount: cancelledUnsubmitted ? null : 0,
    reportedIntentionCount: cancelledUnsubmitted ? null : 0,
    visitedRecipientCount: cancelledUnsubmitted ? null : 0,
    recipientDenominator: cancelledUnsubmitted ? null : request.requestedCount,
    metricsAvailability: cancelledUnsubmitted ? 'UNAVAILABLE' : 'AVAILABLE',
  );
}

VipRequestHistoryItem vipSummaryItemForRequest(
  VipRequest request,
  List<VipRequestHistoryItem> history,
) {
  for (final item in history) {
    if (item.request.id == request.id) {
      return VipRequestHistoryItem(
        request: request,
        recordedSendCount: item.recordedSendCount,
        manualRecordedSendCount: item.manualRecordedSendCount,
        stillQueuedOrInProgressCount: item.stillQueuedOrInProgressCount,
        intentionRecipientCount: item.intentionRecipientCount,
        reportedIntentionCount: item.reportedIntentionCount,
        visitedRecipientCount: item.visitedRecipientCount,
        recipientDenominator: item.recipientDenominator,
        metricsAvailability: item.metricsAvailability,
      );
    }
  }
  return vipHistoryItemFromRequest(request);
}

int compareVipRequestHistoryNewestFirst(
  VipRequestHistoryItem a,
  VipRequestHistoryItem b,
) {
  final aAt = a.request.createdAt;
  final bAt = b.request.createdAt;
  if (aAt == null && bAt == null) {
    return b.request.id.compareTo(a.request.id);
  }
  if (aAt == null) {
    return -1;
  }
  if (bAt == null) {
    return 1;
  }
  final created = bAt.compareTo(aAt);
  if (created != 0) {
    return created;
  }
  return b.request.id.compareTo(a.request.id);
}

List<VipRequestHistoryItem> orderedVipRequestHistory({
  required List<VipRequestHistoryItem> page,
  VipRequest? extra,
  String? hideRequestId,
}) {
  final byId = <String, VipRequestHistoryItem>{};
  for (final item in page) {
    byId[item.request.id] = item;
  }
  if (extra != null && !byId.containsKey(extra.id)) {
    byId[extra.id] = vipHistoryItemFromRequest(extra);
  }
  final items = byId.values
      .where((item) => item.request.id != hideRequestId)
      .toList();
  items.sort(compareVipRequestHistoryNewestFirst);
  return items;
}

bool vipRequestAllowsIntention(VipRequest request) {
  switch (request.status) {
    case 'SUBMITTED':
    case 'MANUAL_QUEUED':
    case 'BALE_NOT_IMPLEMENTED':
      return true;
    default:
      return false;
  }
}

class VipRequestSummaryCard extends StatelessWidget {
  const VipRequestSummaryCard({
    super.key,
    required this.item,
    this.guidance = const [],
    this.footer,
  });

  final VipRequestHistoryItem item;
  final List<String> guidance;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AppSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            item.request.listName,
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: AppTokens.space8),
          Text(
            '${AppStrings.vipHistoryRequested}: ${vipSummaryRequestedValue(item)}',
          ),
          Text(
            '${AppStrings.vipHistoryIntentions}: ${vipSummaryIntentionsValue(item)}',
          ),
          Text(
            '${AppStrings.vipHistoryRecordedSends}: ${vipSummaryRecordedSendsValue(item)}',
          ),
          Text(
            '${AppStrings.vipHistoryVisited}: ${vipSummaryVisitedValue(item)}',
          ),
          for (final line in guidance)
            if (line.trim().isNotEmpty) ...[
              const SizedBox(height: AppTokens.space8),
              Text(line),
            ],
          if (footer != null) ...[
            const SizedBox(height: AppTokens.space12),
            footer!,
          ],
        ],
      ),
    );
  }
}
