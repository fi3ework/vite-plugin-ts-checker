import { copyFile } from 'node:fs/promises'
import { defineConfig } from 'tsup'

export default defineConfig({
  format: ['esm'],
  outDir: 'dist',
  async onSuccess() {
    await copyFile(
      'src/checkers/vueTsc/languagePlugins.cjs',
      'dist/checkers/vueTsc/languagePlugins.cjs',
    )
  },
  entry: ['src', '!src/checkers/vueTsc/languagePlugins.cjs'],
  splitting: false,
  bundle: false,
  sourcemap: true,
  clean: true,
  target: 'node14',
  platform: 'node',
  dts: true,
})
