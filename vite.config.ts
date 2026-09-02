/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    // Fully offline after first visit: every asset is local and precached.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'The Game of Death',
        short_name: 'Game of Death',
        description:
          'A roguelike duel built on Conway’s Game of Life. Seed your colony, open the throttle, outlive the storm.',
        theme_color: '#05070c',
        background_color: '#04060b',
        display: 'standalone',
        orientation: 'landscape',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/sim/__tests__/**/*.test.ts'],
  },
})
