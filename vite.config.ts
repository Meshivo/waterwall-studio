import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@xyflow')) return 'react-flow';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/lucide-react')) return 'icons';
        }
      }
    }
  },
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['waterwall.svg'],
    manifest: {
      name: 'WaterWall Studio', short_name: 'WW Studio', lang: 'fa', dir: 'rtl',
      description: 'ساخت، اعتبارسنجی و شبیه‌سازی توپولوژی WaterWall',
      theme_color: '#14100b', background_color: '#14100b', display: 'standalone', start_url: './',
      icons: [
        { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    },
    workbox: { globPatterns: ['**/*.{js,css,html,woff2,png,svg,json}'] }
  })]
});
