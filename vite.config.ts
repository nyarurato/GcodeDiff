import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  // GitHub Pages: リポジトリ名に合わせる（例: /GcodeDiff/）
  // ローカル開発時は '/' でも動作する
  base: process.env.NODE_ENV === 'production' ? '/GcodeDiff/' : '/',
  plugins: [
    // gcode-toolpath/gcode-parser が依存する Node.js built-in を polyfill
    nodePolyfills({
      include: ['events', 'stream', 'timers', 'buffer', 'util'],
      globals: { process: true, Buffer: true },
    }),
  ],
})
