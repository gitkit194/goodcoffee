// Rating and notes of a bean, edited on the taste screen while the bean itself may change underneath:
// a sync can merge it into the shared bean, which may bring a rating and notes from another entry.
// Only fields the user actually touched are written; untouched ones show and keep the current value.
import type { MyBean } from '../data/types';

export type FieldEdit<T> = { touched: false } | { touched: true; value: T };

export const untouched = { touched: false } as const;

/** What the field shows: the user's input once touched, else the bean's current value. */
export function shown<T>(edit: FieldEdit<T>, current: T): T {
  return edit.touched ? edit.value : current;
}

/** The change to save for the bean, or null: only touched fields, and only if they differ from the bean now. */
export function beanPatch(
  bean: Pick<MyBean, 'rating' | 'comment'> | undefined,
  rating: FieldEdit<number>,
  comment: FieldEdit<string>,
): Partial<Pick<MyBean, 'rating' | 'comment'>> | null {
  const patch: Partial<Pick<MyBean, 'rating' | 'comment'>> = {};
  if (rating.touched && (rating.value || null) !== (bean?.rating ?? null)) patch.rating = rating.value || null;
  if (comment.touched) {
    const text = comment.value.trim() || null;
    if (text !== (bean?.comment?.trim() || null)) patch.comment = text;
  }
  return Object.keys(patch).length ? patch : null;
}
