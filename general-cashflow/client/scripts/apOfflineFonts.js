import path from 'node:path';

// The standalone SSD review embeds the same unmodified fonts served by Vite.
export function apOfflineFontPlugin(client) {
  return {
    name: 'ap-offline-fonts',
    setup(build) {
      build.onResolve({ filter: /^\/fonts\/[\w-]+\.(?:woff2|ttf)$/ }, args => ({
        path: path.join(client, 'public', args.path.slice(1)),
      }));
    },
  };
}
