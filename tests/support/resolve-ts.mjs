// Lets the tests load app modules that import each other without a file extension ('./community'),
// as Metro and TypeScript allow. Only relative imports are touched; packages resolve as usual.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        try {
          return next(specifier + ext, context);
        } catch {
          // try the next extension
        }
      }
    }
    return next(specifier, context);
  },
});
