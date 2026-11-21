import type { ConfigContext, ExpoConfig } from 'expo/config';

// The Expo account and the EAS project belong to whoever builds the app, so they are not in the
// repository. Set them locally, e.g. in a git-ignored .env (Expo CLI loads it):
//   EXPO_OWNER=<your expo account>
//   EAS_PROJECT_ID=<id from `eas project:info`>
// On EAS Build servers the project id comes from EAS_BUILD_PROJECT_ID, which EAS sets itself.
export default ({ config }: ConfigContext): ExpoConfig => {
  const owner = process.env.EXPO_OWNER;
  const projectId = process.env.EAS_PROJECT_ID ?? process.env.EAS_BUILD_PROJECT_ID;
  return {
    ...config,
    name: config.name ?? 'GoodCoffee',
    slug: config.slug ?? 'goodcoffee',
    ...(owner ? { owner } : {}),
    ...(projectId ? { extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } } } : {}),
  };
};
