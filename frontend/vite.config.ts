import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf-8'),
)

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Statok',
        short_name: 'Statok',
        description: 'Особистий облік інвестицій та портфеля',
        lang: 'uk',
        display: 'standalone',
        theme_color: '#1a6ef5',
        background_color: '#ffffff',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
          { src: '/icons/maskable-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/, /^\/auth/, /^\/health/],
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/api') &&
              !url.pathname.startsWith('/api/backup') &&
              request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 4,
              expiration: { maxAgeSeconds: 86400 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // @vitaliysimkin/t-components еагерно імпортує codemirror у своєму барелі
      // (для компонента-редактора коду), якого Statok не використовує. Ці
      // peer-залежності не встановлені. Аляс на локальний no-op-стаб однаково
      // лагодить dev (esbuild optimizeDeps сканує весь барель) і build (Rollup),
      // без доставляння codemirror-пакетів. Деталі — у codemirror-stub.ts.
      'codemirror': fileURLToPath(
        new URL('./src/lib/codemirror-stub.ts', import.meta.url),
      ),
      '@codemirror/state': fileURLToPath(
        new URL('./src/lib/codemirror-stub.ts', import.meta.url),
      ),
      '@codemirror/lang-json': fileURLToPath(
        new URL('./src/lib/codemirror-stub.ts', import.meta.url),
      ),
      '@codemirror/lang-markdown': fileURLToPath(
        new URL('./src/lib/codemirror-stub.ts', import.meta.url),
      ),
      '@codemirror/theme-one-dark': fileURLToPath(
        new URL('./src/lib/codemirror-stub.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5273,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
