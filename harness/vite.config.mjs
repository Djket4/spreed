import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// Стенд «кадр по лицу»: npx vite --config harness/vite.config.mjs
const root = resolve(import.meta.dirname, '..')
export default defineConfig({
	root,
	server: { port: 5199, host: 'localhost', strictPort: true, fs: { strict: false } },
	assetsInclude: ['**/*.tflite', '**/*.wasm'],
	optimizeDeps: { exclude: ['@mediapipe/tasks-vision'] },
})
