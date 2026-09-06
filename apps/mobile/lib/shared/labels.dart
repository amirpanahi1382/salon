class AppStrings {
  static const appName = 'Salon Attention';
  static const loginTitle = 'Sign in';
  static const registerTitle = 'Create salon account';
  static const email = 'Email';
  static const password = 'Password';
  static const salonName = 'Salon name';
  static const ownerName = 'Your name';
  static const signIn = 'Sign in';
  static const createAccount = 'Create account';
  static const needAccount = 'Create a salon account';
  static const haveAccount = 'Already have an account? Sign in';
  static const dashboard = 'Today';
  static const customers = 'Customers';
  static const visits = 'Visits';
  static const opportunities = 'Opportunities';
  static const profile = 'Profile';
  static const attentionQuestion = 'What should I pay attention to today?';
  static const caughtUpTitle = "You're all caught up.";
  static const caughtUpBody = 'No customers currently need attention.';
  static const noCustomers = 'No customers yet.';
  static const addFirstCustomer = 'Add a customer to start visit history.';
  static const noVisits = 'No completed visits yet.';
  static const noVisitsToday = 'No visits recorded today.';
  static const noMatchingVisits = 'No visits match these filters.';
  static const recordVisit = 'Record completed visit';
  static const deleteCustomer = 'Delete customer';
  static const deleteVisit = 'Delete visit';
  static const cancel = 'Cancel';
  static const delete = 'Delete';
  static const deleteCustomerConfirm =
      'This removes the customer and visit history only when they have no financial records.';
  static const deleteVisitConfirm = 'Delete this completed visit?';
  static const allCustomers = 'All customers';
  static const today = 'Today';
  static const yesterday = 'Yesterday';
  static const chooseDate = 'Choose date';
  static const allDates = 'All dates';
  static const clearFilters = 'Clear filters';
  static const visitCountLabel = 'visits';
  static const exportExcel = 'خروجی اکسل';
  static const exportExcelSaved = 'Excel file saved.';
  static const recommended = 'Recommended';
  static const recommendationNote =
      'This is a recommendation. Messaging is not available yet.';
  static const why = 'Why';
  static const visitHistory = 'Visit history';
  static const logout = 'Sign out';
  static const retry = 'Try again';
  static const searchCustomers = 'Search name or phone';
  static const addCustomer = 'Add customer';
  static const customerCreated = 'Customer created successfully';
  static const backToCustomers = 'Back to Customers';
  static const importFromExcel = 'Import from Excel';
  static const importCustomers = 'Import customers';
  static const selectExcelFile = 'Select Excel file';
  static const downloadTemplate = 'Download Excel template';
  static const saveTemplate = 'Save Excel template';
  static const importComplete = 'Import complete';
  static const rowsProcessed = 'rows processed';
  static const importedCount = 'imported';
  static const skippedCount = 'skipped';
  static const failedCount = 'failed';
  static const skipped = 'Skipped';
  static const failed = 'Failed';
  static const row = 'Row';
  static const done = 'Done';
  static const firstName = 'First name';
  static const lastName = 'Last name';
  static const phoneNumber = 'Phone number';
  static const phoneHint =
      'Exactly 11 digits starting with 09, for example 09121111111.';
  static const save = 'Save';
  static const editCustomer = 'Edit customer';
  static const visitDate = 'Completed visit date';
  static const amountReceived = 'Amount received (IRR)';
  static const saveCompletedVisit = 'Save completed visit';
  static const complimentaryHint =
      'Leave amount empty for a complimentary visit with no revenue.';
  static const noActiveServices = 'No active services available.';
  static const noActiveServicesBody =
      'A sale needs an active service from the salon catalog. You can still record a complimentary visit with no amount.';
  static const serviceLabel = 'Service';
  static const all = 'All';
  static const reactivation = 'Reactivation';
  static const customerReturn = 'Customer return';
  static const revenueDecline = 'Revenue declining';
}

String statusLabel(String value) {
  switch (value) {
    case 'NEW':
      return 'New customer';
    case 'ACTIVE':
      return 'Active';
    case 'RETURNING':
      return 'Returning';
    case 'AT_RISK':
      return 'At risk';
    case 'INACTIVE':
      return 'Inactive';
    default:
      return 'Unknown status';
  }
}

String opportunityLabel(String value) {
  switch (value) {
    case 'REACTIVATION':
      return 'Reactivation';
    case 'CUSTOMER_RETURN':
      return 'Customer return';
    case 'REVENUE_DECLINE':
      return 'Revenue declining';
    default:
      return 'Opportunity';
  }
}

String signalLabel(String value) {
  switch (value) {
    case 'NEW_CUSTOMER':
      return 'New customer';
    case 'OVERDUE':
      return 'Overdue';
    case 'FREQUENT':
      return 'Frequent visitor';
    case 'REVENUE_DECLINING':
      return 'Revenue declining';
    case 'RECENTLY_ACTIVE':
      return 'Recently active';
    case 'RETURNING_CUSTOMER':
      return 'Returning customer';
    case 'AT_RISK':
      return 'At risk';
    case 'INACTIVE':
      return 'Inactive';
    default:
      return 'Signal';
  }
}

String importStatusLabel(String value) {
  switch (value) {
    case 'IMPORTED':
      return 'Imported';
    case 'ALREADY_EXISTS':
      return 'Already exists';
    case 'DUPLICATE_IN_FILE':
      return 'Duplicate in file';
    case 'INVALID':
      return 'Invalid row';
    default:
      return 'Skipped';
  }
}

String roleLabel(String value) {
  switch (value) {
    case 'OWNER':
      return 'Owner';
    case 'MANAGER':
      return 'Manager';
    case 'STAFF':
      return 'Staff';
    default:
      return 'Team member';
  }
}
