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
    // Full PWA configuration will be done in ST-049
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Statok',
        short_name: 'Statok',
        display: 'standalone',
        theme_color: '#ffffff',
        background_color: '#ffffff',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5273,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
