// Community rating of a coffee: other users' ratings (from the server) plus the user's own local one.

/** Sum and number of the other users' ratings, as the server reports them. */
export type RatingStats = { sum: number; count: number };

export type RatingSummary = { average: number; count: number };

/**
 * Adds the user's own rating to the others'. Returns null while nothing is known yet (server not
 * reached), and `{ count: 0 }` when nobody has rated the coffee.
 */
export function combineRating(others: RatingStats | null, mine: number | null | undefined): RatingSummary | null {
  if (!others) return null;
  const own = mine != null && mine >= 1 && mine <= 5 ? mine : null;
  const sum = others.sum + (own ?? 0);
  const count = others.count + (own == null ? 0 : 1);
  if (count === 0) return { average: 0, count: 0 };
  return { average: Math.round((sum / count) * 10) / 10, count };
}

/** Reads the RPC result; anything unexpected counts as "not known" rather than as zero ratings. */
export function parseRatingStats(data: unknown): RatingStats | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const sum = Number((row as Record<string, unknown>).rating_sum);
  const count = Number((row as Record<string, unknown>).rating_count);
  if (!Number.isFinite(sum) || !Number.isInteger(count) || count < 0) return null;
  return { sum, count };
}
