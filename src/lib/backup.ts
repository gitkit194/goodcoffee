// What the profile shows under "Backup". Derived from the stored journal and the sync status, so it is right
// straight after a restart too: the sync status starts as "idle" on every launch and is not stored.
import { hasPending, sendable, type Synced } from '../data/pending';
import type { SyncStatus } from '../data/types';

export const REFUSED_REASON = "Some entries were not accepted by the server. They stay on this device.";

export type Backup =
  | { state: 'empty' | 'uploading' | 'uploaded' }
  | { state: 'local'; reason: string };

export function backupStatus(sync: SyncStatus, journal: Pick<Synced, 'cups' | 'pending'> & { beanCount: number }): Backup {
  if (sync.state === 'local') return { state: 'local', reason: sync.reason };
  // Still waiting for an upload (anything the sync would send: cups, beans, deletions, profile, roasters).
  if (sync.state === 'syncing' || hasPending(sendable(journal))) return { state: 'uploading' };
  // Entries the server refused stay on the phone and are not sent again until they change, so no sync
  // runs for them: they must not read as uploaded.
  if (Object.keys(journal.pending.rejected ?? {}).length) return { state: 'local', reason: REFUSED_REASON };
  if (journal.cups.length === 0 && journal.beanCount === 0) return { state: 'empty' };
  return { state: 'uploaded' };
}
