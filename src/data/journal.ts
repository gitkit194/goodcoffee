// What a finished push does to the journal: clear what reached the server (except rows changed since),
// keep refusals, and move data to server ids. Shared by the store and the sync tests, so the tests run
// the same steps as the app. No React.
import { applyRemap, isEmptyRemap, standInsAfterRemap, type LocalData } from '../lib/community';
import { settle, type Pending, type Synced } from './pending';
import type { Sent } from './push';
import type { RestoreState } from './restore';
import type { Coffee } from './types';

export type Journal = Synced & LocalData<Pending> & { standIns?: Record<string, Coffee> } & RestoreState;

/** `now` is the journal as it is after the push; `snapshot` the one the push was made from. */
export function applySent<D extends Journal>(now: D, snapshot: Synced, sent: Sent, catalog: Coffee[]): D {
  const settled = { ...now, pending: settle(now, snapshot, sent) };
  if (isEmptyRemap(sent.remap)) return settled;
  const next = applyRemap(settled, sent.remap);
  return { ...next, standIns: standInsAfterRemap(settled, next, sent.remap, catalog) };
}
