import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/errors/api_exception.dart';
import 'package:salon_mobile/shared/models/models.dart';

void main() {
  test('parses intelligence summary from the backend contract', () {
    final summary = IntelligenceSummary.fromJson({
      'customers': 5,
      'new': 1,
      'active': 1,
      'returning': 1,
      'atRisk': 1,
      'inactive': 1,
      'reactivationOpportunities': 2,
      'customerReturnOpportunities': 0,
      'frequent': 0,
      'currency': 'IRR',
      'totalRevenue': '1500000.00',
      'revenueThisUtcMonth': '200000.00',
      'reportingTime': 'UTC',
    });
    expect(summary.atRisk, 1);
    expect(summary.reactivationOpportunities, 2);
    expect(summary.totalRevenue, '1500000.00');
    expect(summary.reportingTime, 'UTC');
  });

  test(
    'parses customer intelligence including reason and recommended action',
    () {
      final intelligence = CustomerIntelligence.fromJson({
        'customerId': 'c1',
        'firstName': 'Sara',
        'lastName': 'Ahmadi',
        'status': 'AT_RISK',
        'explanation':
            'Usually returns every 35 days. Last visit was 52 days ago.',
        'behavior': {
          'visitCount': 2,
          'firstVisitAt': '2026-06-01T00:00:00.000Z',
          'lastVisitAt': '2026-07-06T00:00:00.000Z',
          'daysSinceLastVisit': 52,
          'averageReturnIntervalDays': 35,
          'expectedReturnIntervalDays': 35,
        },
        'signals': ['OVERDUE'],
        'opportunities': [
          {
            'type': 'REACTIVATION',
            'customerId': 'c1',
            'firstName': 'Sara',
            'lastName': 'Ahmadi',
            'status': 'AT_RISK',
            'reason':
                'Usually returns every 35 days. Last visit was 52 days ago.',
            'recommendedAction': 'Send a reactivation message.',
          },
        ],
      });
      expect(intelligence.status, 'AT_RISK');
      expect(intelligence.explanation, contains('52 days'));
      expect(
        intelligence.opportunities.first.recommendedAction,
        contains('reactivation'),
      );
    },
  );

  test('parses list pages with items and hasMore', () {
    final items = parseItemList({
      'items': [
        {
          'id': 'c1',
          'firstName': 'Sara',
          'lastName': 'Ahmadi',
          'phoneNumber': '09121111111',
          'createdAt': '2026-01-01T00:00:00.000Z',
          'updatedAt': '2026-01-01T00:00:00.000Z',
        },
      ],
      'hasMore': true,
    }, Customer.fromJson);
    expect(items, hasLength(1));
    expect(items.first.firstName, 'Sara');
  });

  test('auth me uses userId from GET /auth/me', () {
    final user = AuthUser.fromMeJson({
      'userId': 'u1',
      'tenantId': 't1',
      'role': 'OWNER',
    });
    expect(user.id, 'u1');
  });

  test('api exceptions expose friendly 401 and 403 messages', () {
    expect(
      const ApiException(
        statusCode: 401,
        code: 'UNAUTHENTICATED',
        message: 'x',
      ).userMessage,
      contains('sign in'),
    );
    expect(
      const ApiException(
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'x',
      ).userMessage,
      contains('permission'),
    );
    expect(
      const ApiException(
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'nope',
      ).userMessage,
      'We could not find that record.',
    );
  });
}
