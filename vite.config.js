import { defineConfig } from 'vite';
import { ViteMinifyPlugin } from 'vite-plugin-minify';

export default defineConfig({
  base: process.env.BASE_URL || '/',
  server: {
    port: 8080,
    strictPort: true,
  },
  // Geolonia Maps / GeonicDB SDK は外部CDNから読み込むため、
  // Vite のビルド対象外とする
  build: {
    rollupOptions: {
      external: ['geolonia', 'GeonicDB'],
    },
  },
  plugins: [
    {
      name: 'html-env-defaults',
      transformIndexHtml(html) {
        return html.replace(/%VITE_GEOLONIA_API_KEY%/g, process.env.VITE_GEOLONIA_API_KEY || 'YOUR-API-KEY');
      },
    },
    ViteMinifyPlugin({
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      minifyCSS: true,
      minifyJS: true,
    }),
  ],
});
