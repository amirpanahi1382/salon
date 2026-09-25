import '../../shared/models/models.dart';

/// State for a single bounded, cursor-paginated list. The key is its stable row ID.
class CursorPageState<T> {
  CursorPageState({required this.keyOf, required this.changed});

  final String Function(T) keyOf;
  final void Function() changed;
  List<T> items = [];
  String? nextCursor;
  bool hasMore = true;
  bool loading = false;
  Object? error;
  int _generation = 0;

  bool get empty => !loading && error == null && !hasMore && items.isEmpty;

  void reset() {
    _generation++;
    items = [];
    nextCursor = null;
    hasMore = true;
    loading = false;
    error = null;
    changed();
  }

  Future<void> load(Future<ItemPage<T>> Function(String? cursor) fetch) async {
    if (loading || !hasMore) return;
    final generation = _generation;
    final cursor = nextCursor;
    loading = true;
    error = null;
    changed();
    try {
      final page = await fetch(cursor);
      if (generation != _generation) return;
      if (page.hasMore &&
          (page.nextCursor == null || page.nextCursor == cursor)) {
        throw StateError('Invalid continuation cursor');
      }
      final seen = items.map(keyOf).toSet();
      items = [...items, ...page.items.where((item) => seen.add(keyOf(item)))];
      nextCursor = page.nextCursor;
      hasMore = page.hasMore;
    } catch (failure) {
      if (generation != _generation) return;
      error = failure;
    } finally {
      if (generation == _generation) {
        loading = false;
        changed();
      }
    }
  }
}
