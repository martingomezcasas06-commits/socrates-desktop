import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The ported design CSS is valid for WKWebView; rolldown's lightningcss
  // minifier is over-strict, so skip CSS minification (size is irrelevant for a desktop app).
  build: { cssMinify: false },
})
