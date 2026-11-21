// Own bag photos live in the app's document folder. The image picker and the scan crop hand out files
// in the cache folder, which the system may empty at any time; a journal pointing there ends up with a
// broken photo. So a photo is copied into the document folder before the bean that uses it is saved,
// and photos still pointing to the cache (from before) are copied over when the app starts.
// No Expo import here: the file operations are passed in (src/data/photoFiles.ts), so this is testable.

export type PhotoFiles = {
  /** The folder for own photos, ending in "/", e.g. "file:///…/Documents/photos/". */
  dir(): string;
  exists(uri: string): boolean;
  /** Creates the folder if needed and copies the file. */
  copy(from: string, to: string): Promise<void>;
};

export function isKept(uri: string, files: PhotoFiles): boolean {
  return uri.startsWith(files.dir());
}

/** Only local files are copied; a web or data URI (web build, tests) is used as it is. */
function isLocalFile(uri: string): boolean {
  return uri.startsWith('file://') || uri.startsWith('/');
}

function extension(uri: string): string {
  const m = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(uri);
  return m ? m[1].toLowerCase() : 'jpg';
}

/**
 * Copies a photo into the app's own folder and returns its new uri. A photo already there is returned
 * as it is. Throws if the copy fails: the caller must not save a reference to a file that may vanish.
 */
export async function keepPhoto(uri: string, files: PhotoFiles, name: string): Promise<string> {
  if (!isLocalFile(uri) || isKept(uri, files)) return uri;
  const target = `${files.dir()}${name}.${extension(uri)}`;
  await files.copy(uri, target);
  if (!files.exists(target)) throw new Error('photo copy is missing');
  return target;
}

type WithPhotos = {
  coffees: { id: string; photo_uri?: string | null }[];
  photos?: Record<string, string>;
  morePhotos?: Record<string, string[]>;
};

/**
 * Copies every own photo that still points outside the app's folder (journals from before this was
 * done) and returns old uri → new uri. Photos whose file is gone already are skipped: there is nothing
 * to copy, and the bean shows its icon.
 */
export async function copyOldPhotos(d: WithPhotos, files: PhotoFiles, newName: () => string): Promise<Map<string, string>> {
  const all = [...d.coffees.map((c) => c.photo_uri), ...Object.values(d.photos ?? {}), ...Object.values(d.morePhotos ?? {}).flat()];
  const moved = new Map<string, string>();
  for (const uri of new Set(all)) {
    if (!uri || !isLocalFile(uri) || isKept(uri, files) || !files.exists(uri)) continue;
    try {
      moved.set(uri, await keepPhoto(uri, files, newName()));
    } catch {
      // Stays where it is; tried again at the next start.
    }
  }
  return moved;
}

/**
 * Points photo references to their copies. Changes only references that still hold a copied uri and
 * leaves everything else as it is, so it can be applied to the journal as it is NOW, after merges or
 * edits that happened while the copies ran. Returns the same object if nothing matched.
 */
export function replacePhotoUris<D extends WithPhotos>(d: D, moved: Map<string, string>): D {
  if (!moved.size) return d;
  let changed = false;
  const swap = (u: string) => {
    const n = moved.get(u);
    if (n) changed = true;
    return n ?? u;
  };
  const coffees = d.coffees.map((c) => (c.photo_uri && moved.has(c.photo_uri) ? { ...c, photo_uri: swap(c.photo_uri) } : c));
  const photos = d.photos && Object.fromEntries(Object.entries(d.photos).map(([id, u]) => [id, swap(u)]));
  const morePhotos = d.morePhotos && Object.fromEntries(Object.entries(d.morePhotos).map(([id, list]) => [id, list.map(swap)]));
  if (!changed) return d;
  return { ...d, coffees, ...(photos ? { photos } : {}), ...(morePhotos ? { morePhotos } : {}) };
}

/** Both steps on one journal (no changes in between). */
export async function keepAllPhotos<D extends WithPhotos>(d: D, files: PhotoFiles, newName: () => string): Promise<D> {
  return replacePhotoUris(d, await copyOldPhotos(d, files, newName));
}
