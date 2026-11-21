import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { Image, View } from 'react-native';

import type { Coffee } from '../data/types';
import { safeHttpsUrl } from '../lib/url';
import { colors } from '../theme';
import { BeanIcon } from './ui';

/**
 * The roaster's product photo takes precedence; a photo taken in the app is the fallback when the
 * product photo is missing or doesn't load (a scanned bean keeps both). Then the bean icon.
 * `stockOnly` (Entdecken) never shows the user's own photo, only product photos.
 */
export function BeanPhoto({ coffee, size = 48, stockOnly }: { coffee?: Coffee; size?: number; stockOnly?: boolean }) {
  useLanguage();
  const remote = safeHttpsUrl(coffee?.photo_path) ?? undefined;
  const [failed, setFailed] = useState<string[]>([]);
  const uri = [remote, stockOnly ? null : coffee?.photo_uri].find((u) => !!u && !failed.includes(u));
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const showImage = !!uri;

  return (
    <View style={{ width: size, height: size, flexShrink: 0, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
      {!showImage || loadedUri !== uri ? <BeanIcon id={coffee?.id ?? 'unknown'} size={Math.min(size, 56)} /> : null}
      {showImage ? (
        <Image
          key={uri}
          source={{ uri }}
          accessibilityLabel={coffee?.name ? t("Coffee bag: {name}", { name: coffee.name }) : t("Coffee bag")}
          resizeMode={uri === remote ? 'contain' : 'cover'}
          onLoad={() => setLoadedUri(uri)}
          onError={() => setFailed((f) => [...f, uri!])}
          style={{ position: 'absolute', width: size, height: size, opacity: loadedUri === uri ? 1 : 0 }}
        />
      ) : null}
    </View>
  );
}
