// The "Backup" line on the profile, as it reads right after a launch (sync status "idle", nothing kept
// in memory) and while the app runs.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emptyPending, mark } from '../src/data/pending.ts';
import { backupStatus, REFUSED_REASON } from '../src/lib/backup.ts';

const cup = { id: 'c1', coffee_id: 'k1' } as never;
const idle = { state: 'idle' } as const;

test('backup: fresh install has nothing to back up; a synced journal reads uploaded', () => {
  assert.deepEqual(backupStatus(idle, { cups: [], pending: emptyPending, beanCount: 0 }), { state: 'empty' });
  assert.deepEqual(backupStatus(idle, { cups: [cup], pending: emptyPending, beanCount: 1 }), { state: 'uploaded' });
});

test('backup: a profile change or a deleted cup alone is still waiting', () => {
  assert.deepEqual(backupStatus(idle, { cups: [], pending: mark(emptyPending, { profile: true }), beanCount: 0 }), { state: 'uploading' });
  assert.deepEqual(backupStatus(idle, { cups: [cup], pending: mark(emptyPending, { deletedCups: ['c0'] }), beanCount: 1 }), { state: 'uploading' });
});

test('backup: after a restart, a cup the server refused reads "only on this device", not uploaded', () => {
  // Stored journal as it is loaded on launch: the refused cup is still pending but no longer sendable.
  const pending = { ...emptyPending, cups: ['c1'], rejected: { 'cup:c1': 'server rejected' } };
  assert.deepEqual(backupStatus(idle, { cups: [cup], pending, beanCount: 1 }), { state: 'local', reason: REFUSED_REASON });
  // A failed upload keeps its own reason.
  assert.deepEqual(backupStatus({ state: 'local', reason: 'offline' }, { cups: [cup], pending, beanCount: 1 }), { state: 'local', reason: 'offline' });
});
