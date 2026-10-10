import {
  decodeCursor,
  encodeCursor,
  parseCursorInstant,
  parseCursorUuid,
} from '../infrastructure/http/list-page';

export type SupportCursor = { at: Date; id: string };

export function encodeSupportCursor(at: Date, id: string): string {
  return encodeCursor([at.toISOString(), id]);
}

export function decodeSupportCursor(value: string | undefined): SupportCursor | undefined {
  const parts = decodeCursor(value, 2);
  if (!parts) {
    return undefined;
  }
  return {
    at: parseCursorInstant(parts[0]!),
    id: parseCursorUuid(parts[1]!),
  };
}
