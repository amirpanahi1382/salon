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
  static const opportunities = 'Opportunities';
  static const profile = 'Profile';
  static const attentionQuestion = 'What should I pay attention to today?';
  static const caughtUpTitle = "You're all caught up.";
  static const caughtUpBody = 'No customers currently need attention.';
  static const noCustomers = 'No customers yet.';
  static const addFirstCustomer = 'Add a customer to start visit history.';
  static const noVisits = 'No completed visits yet.';
  static const recordVisit = 'Record completed visit';
  static const recommended = 'Recommended';
  static const recommendationNote =
      'This is a recommendation. Messaging is not available yet.';
  static const why = 'Why';
  static const visitHistory = 'Visit history';
  static const logout = 'Sign out';
  static const retry = 'Try again';
  static const searchCustomers = 'Search name or phone';
  static const addCustomer = 'Add customer';
  static const firstName = 'First name';
  static const lastName = 'Last name';
  static const phoneNumber = 'Phone number';
  static const save = 'Save';
  static const editCustomer = 'Edit customer';
  static const visitDate = 'Completed visit date';
  static const all = 'All';
  static const reactivation = 'Reactivation';
  static const customerReturn = 'Customer return';
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
