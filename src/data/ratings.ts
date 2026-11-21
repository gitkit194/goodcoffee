// Fetches the community rating of a coffee. Read-only, separate from the push sync in sync.ts.
import { useEffect, useState } from 'react';

import { parseRatingStats, type RatingStats } from '../lib/rating';
import { supabase } from './supabase';

export async function fetchRatingStats(coffeeId: string): Promise<RatingStats | null> {
  const { data, error } = await supabase.rpc('coffee_rating_stats', { p_coffee_id: coffeeId });
  if (error) return null;
  return parseRatingStats(data);
}

/** Other users' ratings of a coffee; null until loaded or when the server cannot be reached. */
export function useRatingStats(coffeeId: string | undefined): RatingStats | null {
  // Keyed by coffee so a previous bean's numbers never show on the next one.
  const [loaded, setLoaded] = useState<{ id: string; stats: RatingStats | null } | null>(null);
  useEffect(() => {
    if (!coffeeId) return;
    let live = true;
    fetchRatingStats(coffeeId)
      .then((stats) => { if (live) setLoaded({ id: coffeeId, stats }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [coffeeId]);
  return loaded && loaded.id === coffeeId ? loaded.stats : null;
}
