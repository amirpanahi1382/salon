import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:salon_mobile/core/state/cursor_page_state.dart';
import 'package:salon_mobile/shared/models/models.dart';

void main() {
  CursorPageState<String> state() => CursorPageState<String>(keyOf: (item) => item, changed: () {});

  test('appends distinct pages and finishes with no cursor', () async {
    final pages = state();
    await pages.load((cursor) async => const ItemPage(items: ['a', 'b'], hasMore: true, nextCursor: 'c1'));
    await pages.load((cursor) async {
      expect(cursor, 'c1');
      return const ItemPage(items: ['b', 'c'], hasMore: false);
    });
    expect(pages.items, ['a', 'b', 'c']);
    expect(pages.hasMore, false);
    expect(pages.nextCursor, null);
  });

  test('deduplicates concurrent load and keeps rows on retryable page failure', () async {
    final pages = state();
    final pending = Completer<ItemPage<String>>();
    var requests = 0;
    final first = pages.load((_) { requests++; return pending.future; });
    await pages.load((_) { requests++; throw StateError('duplicate'); });
    expect(requests, 1);
    pending.complete(const ItemPage(items: ['a'], hasMore: true, nextCursor: 'c1'));
    await first;
    await pages.load((cursor) async { expect(cursor, 'c1'); throw StateError('network'); });
    expect(pages.items, ['a']);
    expect(pages.error, isA<StateError>());
    await pages.load((cursor) async { expect(cursor, 'c1'); return const ItemPage(items: ['b'], hasMore: false); });
    expect(pages.items, ['a', 'b']);
    expect(pages.error, null);
  });

  test('reset ignores a stale response and restarts at the first page', () async {
    final pages = state();
    final pending = Completer<ItemPage<String>>();
    final stale = pages.load((_) => pending.future);
    pages.reset();
    await pages.load((cursor) async {
      expect(cursor, null);
      return const ItemPage(items: ['new'], hasMore: false);
    });
    pending.complete(const ItemPage(items: ['old'], hasMore: false));
    await stale;
    expect(pages.items, ['new']);
  });

  test('rejects unusable continuation without losing already loaded rows', () async {
    final pages = state();
    await pages.load((_) async => const ItemPage(items: ['a'], hasMore: true, nextCursor: 'c1'));
    await pages.load((_) async => const ItemPage(items: ['b'], hasMore: true, nextCursor: 'c1'));
    expect(pages.items, ['a']);
    expect(pages.error, isA<StateError>());
    expect(pages.nextCursor, 'c1');
  });
}
