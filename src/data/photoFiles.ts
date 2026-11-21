// The app's photo folder on the phone (expo-file-system), for src/lib/photos.ts.
import { Directory, File, Paths } from 'expo-file-system';

import type { PhotoFiles } from '../lib/photos';

const folder = () => new Directory(Paths.document, 'photos');

export const photoFiles: PhotoFiles = {
  dir() {
    const uri = folder().uri;
    return uri.endsWith('/') ? uri : uri + '/';
  },
  exists(uri) {
    try {
      return new File(uri).exists;
    } catch {
      return false;
    }
  },
  async copy(from, to) {
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    await new File(from).copy(new File(to));
  },
};
