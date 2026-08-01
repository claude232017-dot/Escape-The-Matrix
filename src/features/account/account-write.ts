import { getSupabase } from '@/lib/supabase';

/**
 * Taking your data, and being erased.
 *
 * Both are single RPCs because both are rules the database has to own: an export assembled in
 * the browser would be limited to what RLS lets the client read, and a deletion driven from the
 * browser could not touch `auth.users` at all. See 0012_export_and_deletion.sql.
 */

/** The whole document. Shape is whatever `public.export_my_data()` returns — deliberately loose. */
export type ExportDocument = Record<string, unknown>;

export async function fetchExport(): Promise<ExportDocument> {
  const { data, error } = await getSupabase().rpc('export_my_data');
  if (error) throw error;
  if (!data) throw new Error('The server returned an empty export.');
  return data as ExportDocument;
}

/**
 * A filename a man will still understand in a year.
 *
 * Dated, because he will export more than once and "escape-the-matrix.json" four times in a
 * downloads folder is four files nobody can tell apart. The date comes from the document the
 * server produced rather than from the browser clock — the export is a record of what the
 * server held, and stamping it with the reader's clock would be a small lie about when.
 */
export function exportFilename(document: ExportDocument): string {
  const exportedAt = document['exported_at'];
  const stamp =
    typeof exportedAt === 'string' && exportedAt.length >= 10
      ? exportedAt.slice(0, 10)
      : 'undated';
  return `escape-the-matrix-${stamp}.json`;
}

/**
 * Hand the file to the browser.
 *
 * A blob and an object URL rather than a `data:` URI: a month of one man's record is comfortably
 * past the length some browsers will accept in an address bar, and the failure mode there is a
 * download that silently does nothing.
 *
 * The URL is revoked immediately after the click. It is a live handle to every sensitive thing
 * this app holds about him, and leaving it in the document for the rest of the session is a
 * needless second copy — §3.5 is about the boundary, and this is one.
 */
export function downloadExport(document_: ExportDocument, filename: string): void {
  const blob = new Blob([JSON.stringify(document_, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Erase the account.
 *
 * `confirmEmail` is passed straight through to the database, which compares it against the
 * address on the account and refuses on a mismatch. The browser does not pre-check it: a guard
 * enforced only in the browser is decoration (§3.3), and this is the one call in the app where
 * that would matter most.
 */
export async function deleteAccount(confirmEmail: string): Promise<void> {
  const { error } = await getSupabase().rpc('delete_my_account', {
    p_confirm_email: confirmEmail,
  });
  if (error) throw error;
}

export function accountRefusalMessage(cause: unknown): string {
  const message =
    typeof cause === 'object' && cause !== null && 'message' in cause
      ? String((cause as { message: unknown }).message)
      : String(cause);

  if (message.includes('delete_confirmation_mismatch')) {
    return 'That is not the address on this account. Type it exactly to confirm.';
  }
  if (message.includes('delete_no_account') || message.includes('delete_no_session')) {
    return 'You are not signed in. Sign in again and retry.';
  }
  if (message.includes('export_no_session')) {
    return 'You are not signed in. Sign in again and retry.';
  }
  return `The server refused it: ${message}`;
}
