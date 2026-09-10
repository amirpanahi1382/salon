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

  void remove(String customerId) {
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
