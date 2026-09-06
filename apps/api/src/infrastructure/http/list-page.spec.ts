import { toListPage } from './list-page';

describe('toListPage', () => {
  it('sets hasMore when the extra probe row is present', () => {
    expect(toListPage([1, 2, 3], 2)).toEqual({ items: [1, 2], hasMore: true });
    expect(toListPage([1, 2], 2)).toEqual({ items: [1, 2], hasMore: false });
  });
});
