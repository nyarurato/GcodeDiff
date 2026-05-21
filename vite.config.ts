import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages: リポジトリ名に合わせる（例: /GcodeDiff/）
  // ローカル開発時は '/' でも動作する
  base: process.env.NODE_ENV === 'production' ? '/GcodeDiff/' : '/',
})
