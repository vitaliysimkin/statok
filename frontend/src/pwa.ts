import { registerSW } from 'virtual:pwa-register'

export function initPWA(): void {
  registerSW({
    onNeedRefresh() {
      // autoUpdate handles reload automatically
    },
    onOfflineReady() {
      console.info('[PWA] Ready to work offline')
    },
  })
}
