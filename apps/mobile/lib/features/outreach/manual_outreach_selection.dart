import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/state/providers.dart';
import '../../shared/labels.dart';
import '../../shared/models/models.dart';
import 'manual_outreach_state.dart';

class ManualOutreachController extends Notifier<ManualOutreachState> {
  @override
  ManualOutreachState build() {
    ref.listen<AuthState>(authControllerProvider, (previous, next) {
      if (next.status != AuthStatus.signedIn || next.user?.isPlatformAdmin == true) {
        Future.microtask(() {
          state = const ManualOutreachState();
        });
      }
    });
    return const ManualOutreachState();
  }

  void enterSelection() {
    state = state.copyWith(selecting: true, clearLimitMessage: true);
  }

  void exitSelection() {
    state = state.copyWith(selecting: false, clearLimitMessage: true);
  }

  bool toggle(Customer customer) {
    if (state.isSelected(customer.id)) {
      state = state.copyWith(
        customers: [
          for (final item in state.customers)
            if (item.id != customer.id) item,
        ],
        clearLimitMessage: true,
      );
      return true;
    }
    if (state.selectedCount >= ManualOutreachState.maxSelection) {
      state = state.copyWith(limitMessage: AppStrings.selectionLimitReached);
      return false;
    }
    state = state.copyWith(
      customers: [
        ...state.customers,
        OutreachCustomerRef(id: customer.id, fullName: customer.fullName),
      ],
      clearLimitMessage: true,
    );
    return true;
  }

  void confirmAndFocusOpportunities() {
    state = state.copyWith(
      selecting: false,
      focusOutreachTab: true,
      clearLimitMessage: true,
    );
  }

  void consumeFocus() {
    if (state.focusOutreachTab) {
      state = state.copyWith(focusOutreachTab: false);
    }
  }

  void markSubmitted({
    required String customerId,
    required String messageRequestId,
    required String status,
    required DateTime requestedAt,
  }) {
    OutreachCustomerRef? selected;
    for (final item in state.customers) {
      if (item.id == customerId) {
        selected = item;
        break;
      }
    }
    var fullName = selected?.fullName ?? '';
    if (fullName.isEmpty) {
      for (final item in state.requested) {
        if (item.id == customerId) {
          fullName = item.fullName;
          break;
        }
      }
    }
    final submitted = OutreachCustomerRef(
      id: customerId,
      fullName: fullName,
      messageRequestId: messageRequestId,
      status: status,
      requestedAt: requestedAt,
    );
    state = state.copyWith(
      requested: [
        submitted,
        for (final item in state.requested)
          if (item.id != customerId) item,
      ],
    );
  }

  void ingestRequested(List<OutreachCustomerRef> items) {
    state = state.copyWith(requested: items);
  }

  void remove(String customerId) {
    if (state.requested.any((item) => item.id == customerId)) {
      return;
    }
    state = state.copyWith(
      customers: [
        for (final item in state.customers)
          if (item.id != customerId) item,
      ],
    );
  }
}

final manualOutreachSelectionProvider =
    NotifierProvider<ManualOutreachController, ManualOutreachState>(
  ManualOutreachController.new,
);
