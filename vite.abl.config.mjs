import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  build: { outDir: process.env.ABL_OUT, emptyOutDir: true,
    rollupOptions: { input: './ablation.html' } },
})
