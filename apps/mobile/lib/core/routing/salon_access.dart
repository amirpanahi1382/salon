/// An onboarding token stays out of the product shell until a product session exists.
bool shouldExchangeProductSession({
  required String role,
  required String accessState,
  required String sessionScope,
}) {
  return role == 'OWNER' && accessState == 'PRODUCT' && sessionScope == 'onboarding';
}

/// Product salons stay on the product shell. Onboarding states stay on their own screens.
String? signedInSalonRedirect({
  required String accessState,
  required String sessionScope,
  required String location,
}) {
  const agreement = '/agreement';
  const payment = '/payment';
  if (accessState == 'AWAITING_AGREEMENT') {
    return location == agreement ? null : agreement;
  }
  if (accessState == 'AWAITING_PAYMENT' ||
      shouldExchangeProductSession(
        role: 'OWNER',
        accessState: accessState,
        sessionScope: sessionScope,
      )) {
    return location == payment ? null : payment;
  }
  if (location == agreement || location == payment) {
    return '/';
  }
  return null;
}
