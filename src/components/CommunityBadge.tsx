import { View } from 'react-native';

import type { Coffee } from '../data/types';
import { t, useLanguage } from '../i18n';
import { isCommunity } from '../lib/community';
import { colors, fonts } from '../theme';
import { T } from './ui';

/** Marks a bean a user added that hasn't been reviewed yet. Renders nothing for any other bean. */
export function CommunityBadge({ coffee, explain }: { coffee: Coffee | undefined; explain?: boolean }) {
  useLanguage();
  if (!isCommunity(coffee)) return null;
  return (
    <View style={{ gap: 6, alignItems: 'flex-start' }}>
      <View style={{ paddingHorizontal: 10, height: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.kraft, backgroundColor: colors.unsureBg, justifyContent: 'center' }}>
        <T style={{ fontSize: 11, fontFamily: fonts.uiMedium, color: colors.text }}>{t("From the community")}</T>
      </View>
      {explain ? (
        <T style={{ fontSize: 12, lineHeight: 17, color: colors.muted }}>{t("Added by someone in the community and not reviewed yet. Only they can change these details.")}</T>
      ) : null}
    </View>
  );
}
