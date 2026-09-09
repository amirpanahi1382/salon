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

  test('parses opportunity actions without salonId', () {
    final action = OpportunityAction.fromJson({
      'id': 'a1',
      'customerId': 'c1',
      'firstName': 'Sara',
      'lastName': 'Ahmadi',
      'opportunityType': 'REACTIVATION',
      'status': 'COMPLETED',
      'createdBy': 'u1',
      'createdAt': '2026-09-09T00:00:00.000Z',
      'updatedAt': '2026-09-09T00:00:00.000Z',
      'completedAt': '2026-09-09T00:00:00.000Z',
      'dismissedAt': null,
    });
    expect(action.status, 'COMPLETED');
    expect(action.fullName, 'Sara Ahmadi');
  });

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

  test('parses service pages even when JSON maps are untyped', () {
    final page = parseItemPage(<dynamic, dynamic>{
      'items': <dynamic>[
        <dynamic, dynamic>{
          'id': 'svc-hair',
          'name': 'Hair Service',
          'status': 'ACTIVE',
          'createdAt': '2026-01-01T00:00:00.000Z',
          'updatedAt': '2026-01-01T00:00:00.000Z',
        },
        <dynamic, dynamic>{
          'id': 'svc-nail',
          'name': 'Nail Service',
          'status': 'ACTIVE',
          'createdAt': '2026-01-01T00:00:00.000Z',
          'updatedAt': '2026-01-01T00:00:00.000Z',
        },
      ],
      'hasMore': false,
      'nextCursor': null,
    }, SalonService.fromJson);
    expect(page.items.map((item) => item.name), [
      'Hair Service',
      'Nail Service',
    ]);
    expect(page.hasMore, isFalse);
  });

  test('parses enriched visit list facts', () {
    final visit = Visit.fromJson({
      'id': 'v1',
      'customerId': 'c1',
      'visitedAt': '2026-08-31T10:00:00.000Z',
      'createdAt': '2026-08-31T10:01:00.000Z',
      'firstName': 'Maryam',
      'lastName': 'Ahmadi',
      'serviceName': 'Hair Service',
      'amountReceived': '8000000.00',
    });
    expect(visit.customerName, 'Maryam Ahmadi');
    expect(visit.serviceLabel, 'Hair Service');
    expect(visit.amountLabel, '8000000.00 ریال');

    final visitOnly = Visit.fromJson({
      'id': 'v2',
      'customerId': 'c1',
      'visitedAt': '2026-08-01T10:00:00.000Z',
      'createdAt': '2026-08-01T10:01:00.000Z',
      'firstName': 'Maryam',
      'lastName': 'Ahmadi',
      'serviceName': null,
      'amountReceived': null,
    });
    expect(visitOnly.serviceLabel, '—');
    expect(visitOnly.amountLabel, '—');
  });

  test('paginated visit pages keep serviceName and amountReceived', () {
    final page = parseItemPage({
      'items': [
        {
          'id': 'v-hair',
          'customerId': 'c1',
          'visitedAt': '2026-06-10T10:00:00.000Z',
          'createdAt': '2026-06-10T10:01:00.000Z',
          'firstName': 'Maryam',
          'lastName': 'Ahmadi',
          'serviceName': 'Hair Service',
          'amountReceived': '8000000.00',
        },
        {
          'id': 'v-nail',
          'customerId': 'c2',
          'visitedAt': '2026-06-11T10:00:00.000Z',
          'createdAt': '2026-06-11T10:01:00.000Z',
          'firstName': 'Sara',
          'lastName': 'Mohammadi',
          'serviceName': 'Nail Service',
          'amountReceived': '5000000.00',
        },
      ],
      'hasMore': true,
      'nextCursor': 'cursor-2',
    }, Visit.fromJson);
    expect(page.hasMore, isTrue);
    expect(page.nextCursor, 'cursor-2');
    expect(page.items[0].serviceName, 'Hair Service');
    expect(page.items[0].amountReceived, '8000000.00');
    expect(page.items[1].serviceName, 'Nail Service');
    expect(page.items[1].amountReceived, '5000000.00');
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
      contains('وارد شوید'),
    );
    expect(
      const ApiException(
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'x',
      ).userMessage,
      contains('دسترسی'),
    );
    expect(
      const ApiException(
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'nope',
      ).userMessage,
      'این مورد پیدا نشد.',
    );
  });
}
