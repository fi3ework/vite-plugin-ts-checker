import fs from 'fs'
import { globSync } from 'tinyglobby'
import path from 'path'
import { describe, expect, it } from 'vitest'

import { isBuild, sleepForServerReady, testDir } from '../../testUtils'

describe('config-no-runtime-code-in-build', () => {
  describe.runIf(isBuild)('build', () => {
    it('should not contain plugin code in build artifacts', async () => {
      await sleepForServerReady()
      const files = globSync('**', { cwd: path.resolve(testDir, 'dist'), absolute: true, onlyFiles: true })
      expect(files.length).toBeGreaterThan(1)
      for await (const file of files) {
        const content = await fs.promises.readFile(file, 'utf-8')
        expect(content).not.toContain('vite-plugin-checker')
      }
    })
  })
})
