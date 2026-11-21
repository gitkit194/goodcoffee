// Review test 9: own photos still open after a restart, after the system emptied the cache, and after
// two beans with their own photos were merged.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyRemap } from '../src/lib/community.ts';
import { copyOldPhotos, keepAllPhotos, keepPhoto, replacePhotoUris, type PhotoFiles } from '../src/lib/photos.ts';
import { emptyPending } from '../src/data/pending.ts';
import type { Coffee } from '../src/data/types.ts';

const CACHE = 'file:///data/cache/ImagePicker/';
const DOCS = 'file:///data/files/photos/';

/** A file system with a cache the "system" can empty. */
function fakeFiles() {
  const files = new Set<string>();
  let failCopies = 0;
  const fs: PhotoFiles & { files: Set<string>; clearCache(): void; failNextCopy(): void } = {
    files,
    dir: () => DOCS,
    exists: (u) => files.has(u),
    async copy(from, to) {
      if (failCopies > 0) {
        failCopies--;
        throw new Error('no space');
      }
      if (!files.has(from)) throw new Error('source missing');
      files.add(to);
    },
    clearCache() {
      for (const f of [...files]) if (f.startsWith(CACHE)) files.delete(f);
    },
    failNextCopy() {
      failCopies = 1;
    },
  };
  return fs;
}

test('a picked photo is copied into the app folder and still opens after the cache is emptied', async () => {
  const fs = fakeFiles();
  fs.files.add(CACHE + 'abc.jpeg');
  const kept = await keepPhoto(CACHE + 'abc.jpeg', fs, 'p1');
  assert.equal(kept, DOCS + 'p1.jpeg');
  fs.clearCache();
  assert.ok(fs.exists(kept), 'the saved reference still points to a file');
  // Keeping it again changes nothing.
  assert.equal(await keepPhoto(kept, fs, 'p2'), kept);
});

test('if the copy fails, saving is refused instead of storing a reference that may vanish', async () => {
  const fs = fakeFiles();
  fs.files.add(CACHE + 'abc.jpg');
  fs.failNextCopy();
  await assert.rejects(keepPhoto(CACHE + 'abc.jpg', fs, 'p1'));
});

test('photos saved before this fix are copied at the next start, while the cache file is still there', async () => {
  const fs = fakeFiles();
  fs.files.add(CACHE + 'own.jpg');
  fs.files.add(CACHE + 'over.jpg');
  const journal = {
    coffees: [{ id: 'b1', photo_uri: CACHE + 'own.jpg' }, { id: 'b2', photo_uri: CACHE + 'gone.jpg' }],
    photos: { seed1: CACHE + 'over.jpg' },
  };
  let n = 0;
  const kept = await keepAllPhotos(journal, fs, () => 'k' + ++n);
  assert.notEqual(kept, journal);
  assert.equal(kept.coffees[0].photo_uri, DOCS + 'k1.jpg');
  assert.equal(kept.photos?.seed1, DOCS + 'k2.jpg');
  // A file the system already removed cannot be rescued; the reference stays, the bean shows its icon.
  assert.equal(kept.coffees[1].photo_uri, CACHE + 'gone.jpg');
  fs.clearCache();
  assert.ok(fs.exists(kept.coffees[0].photo_uri!) && fs.exists(kept.photos!.seed1));
  // Nothing left to copy: the journal is returned as it is.
  assert.equal(await keepAllPhotos(kept, fs, () => 'x'), kept);
});

test('merging two beans that both have an own photo keeps both photos', () => {
  const coffee = (id: string, photo: string): Coffee => ({ id, roaster_id: 'r', name: 'House', roaster_notes: [], photo_uri: photo });
  const d = {
    roasters: [],
    coffees: [coffee('A', DOCS + 'a.jpg'), coffee('B', DOCS + 'b.jpg')],
    beans: {},
    cups: [],
    pending: emptyPending,
  };
  const after = applyRemap(d, { coffees: { B: 'A' }, roasters: {} });
  const a = after.coffees.find((c) => c.id === 'A');
  assert.equal(a?.photo_uri, DOCS + 'a.jpg', 'A keeps its photo');
  assert.deepEqual(after.morePhotos, { A: [DOCS + 'b.jpg'] }, 'B\'s photo is kept as a further photo of A');
  // A later merge of A into C carries both along.
  const d2 = { ...after, photos: { ...after.photos, C: DOCS + 'c.jpg' } };
  const after2 = applyRemap(d2, { coffees: { A: 'C' }, roasters: {} });
  assert.equal(after2.photos?.C, DOCS + 'c.jpg');
  assert.deepEqual(after2.morePhotos?.C?.sort(), [DOCS + 'a.jpg', DOCS + 'b.jpg']);
});

test('copying old photos at start does not undo a merge or an edit made while it ran', async () => {
  const fs = fakeFiles();
  fs.files.add(CACHE + 'b.jpg');
  fs.files.add(CACHE + 'c.jpg');
  const coffee = (id: string, name: string, photo: string | null): Coffee => ({ id, roaster_id: 'r', name, roaster_notes: [], photo_uri: photo });
  const atStart = {
    roasters: [],
    coffees: [coffee('B', 'House', CACHE + 'b.jpg'), coffee('C', 'old', CACHE + 'c.jpg')],
    beans: {},
    cups: [],
    pending: emptyPending,
  };
  // The copy is slow …
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow: PhotoFiles = { ...fs, copy: async (a, b) => (await gate, fs.copy(a, b)) };
  let n = 0;
  const copying = copyOldPhotos(atStart, slow, () => 'k' + ++n);
  // … meanwhile the server merges B into A, and the user corrects C's name.
  let now = applyRemap(atStart, { coffees: { B: 'A' }, roasters: {} });
  now = { ...now, coffees: now.coffees.map((c) => (c.id === 'C' ? { ...c, name: 'corrected' } : c)) };
  release();
  const after = replacePhotoUris(now, await copying);
  fs.clearCache();
  assert.ok(after.photos?.A && fs.exists(after.photos.A), 'A keeps the merged photo, now as a kept copy');
  const c = after.coffees.find((x) => x.id === 'C')!;
  assert.equal(c.name, 'corrected', 'the edit made meanwhile stays');
  assert.ok(fs.exists(c.photo_uri!));
});

test('a photo added while the copy ran is left alone', () => {
  const d = { coffees: [{ id: 'X', photo_uri: DOCS + 'new.jpg' }], photos: { Y: DOCS + 'y.jpg' } };
  assert.equal(replacePhotoUris(d, new Map([[CACHE + 'gone.jpg', DOCS + 'k1.jpg']])), d);
});
