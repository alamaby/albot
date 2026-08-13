// Helper for safe bigint to database conversion.
//
// PostgREST accepts decimal strings for bigint columns, and Telegram ids are
// 64-bit values that may exceed Number.MAX_SAFE_INTEGER. The generated
// supabase-js types model bigint columns as `number` (for both filters and
// inserts), so this helper returns the decimal string typed as `number`. The
// runtime value is a string, which PostgREST parses as bigint; centralizing
// the cast here keeps call sites honest and prevents precision loss.

export function bigintToDb(value: bigint): number {
  return value.toString() as unknown as number;
}
