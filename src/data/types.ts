export type Visibility = 'private' | 'friends' | 'public';

export type Roaster = {
  id: string;
  name: string;
  slug?: string | null;
  district?: string | null;
  website?: string | null;
};

/** A roaster's espresso recipe, in the database's field names. */
export type Recipe = {
  recipe_dose_g: number | null;
  recipe_yield_g: number | null;
  recipe_time_s: number | null;
  recipe_temp_c: number | null;
};

export type Coffee = {
  id: string;
  roaster_id: string | null;
  name: string;
  origin_country?: string | null;
  region?: string | null;
  producer?: string | null;
  process?: string | null;
  variety?: string | null;
  roast_for?: string | null;
  roast_level?: string | null;
  /** true = nobody named the roast level; it was estimated from roast_for (filter/omni = hell, else mittel). */
  roast_level_estimated?: boolean | null;
  /** The roaster's own espresso recipe for this bean, if it gives one. */
  recipe_dose_g?: number | null;
  recipe_yield_g?: number | null;
  recipe_time_s?: number | null;
  recipe_temp_c?: number | null;
  roaster_notes: string[];
  product_url?: string | null;
  /** HTTPS product photo from the roaster, stored in the existing database image field. */
  photo_path?: string | null;
  /** Local file uri of a photo taken in the app. Stays on the phone, never uploaded. */
  photo_uri?: string | null;
  /** 'user' = added by someone in the app; such a bean is "from the community" until reviewed. */
  source?: 'seed' | 'user' | 'roaster' | null;
  /** Checked by us: no longer a community bean. */
  reviewed?: boolean | null;
  /** Older app versions and caches carried the timestamp instead of `reviewed`. */
  reviewed_at?: string | null;
};

/** A bean on the user's own list: rating and comment belong to the bean, not to a cup. */
export type MyBean = {
  coffee_id: string;
  roast_date: string | null;
  rating: number | null;
  comment: string | null;
  added_at: string;
  updated_at: string;
  /** Only on the phone, after a merge: when each field's value was set; valid while updated_at === stamp. */
  field_times?: { stamp: string; rating?: string; comment?: string; roast_date?: string };
};

export type Cup = {
  id: string;
  coffee_id: string;
  brewed_at: string;
  grind: number;
  dose_g: number;
  yield_g: number;
  time_s: number;
  /** 0 = sauer, unterextrahiert · 5 = ausgewogen · 10 = bitter, überextrahiert */
  extraction: number;
  sweetness: number | null;
  acidity: number | null;
  body: number | null;
  /** Aroma keys such as "fruit:Beeren" or "choc" */
  aromas: string[];
};

export type Profile = {
  name: string;
  grinder: string;
  since: string;
};

export type SyncStatus =
  | { state: 'idle' | 'syncing' | 'synced'; at?: string }
  | { state: 'local'; reason: string };
