import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { target: 'safari16', assetsInlineLimit: 0, modulePreload: { polyfill: false } },
});
