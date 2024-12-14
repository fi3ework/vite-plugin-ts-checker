import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { glob } from 'tinyglobby'
import { chromium } from 'playwright-chromium'

import type { BrowserServer } from 'playwright-chromium'
const DIR = path.join(os.tmpdir(), 'vitest_playwright_global_setup')

let browserServer: BrowserServer | undefined

export async function setup(): Promise<void> {
  browserServer = await chromium.launchServer({
    headless: !process.env.VITE_DEBUG_SERVE,
    args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : undefined,
  })

  await fs.mkdirp(DIR)
  await fs.writeFile(path.join(DIR, 'wsEndpoint'), browserServer.wsEndpoint())

  const tempDir = path.resolve(__dirname, '../playground-temp')
  await fs.ensureDir(tempDir)
  await fs.emptyDir(tempDir)
  await fs
    .copy(path.resolve(__dirname, '../playground'), tempDir, {
      dereference: false,
      filter(file) {
        const _file = file.replace(/\\/g, '/')
        return !_file.includes('__tests__') && !file.match(/dist(\/|$)/)
      },
    })
    .catch(async (error) => {
      if (error.code === 'EPERM' && error.syscall === 'symlink') {
        throw new Error(
          'Could not create symlinks. On Windows, consider activating Developer Mode to allow non-admin users to create symlinks by following the instructions at https://docs.microsoft.com/en-us/windows/apps/get-started/enable-your-device-for-development.'
        )
      } else {
        throw error
      }
    })

  if (process.env['VITEST_TEST_CJS']) {
    const packageJsons = await glob(`${tempDir}/**/package.json`)
    for (const packageJson of packageJsons) {
      const packageJsonContents = await fs.readJson(packageJson)
      delete packageJsonContents['module']
      await fs.writeJson(packageJson, packageJsonContents, { spaces: 2 })
    }
  }
}

export async function teardown(): Promise<void> {
  browserServer?.close()
  if (!process.env.VITE_PRESERVE_BUILD_ARTIFACTS) {
    fs.removeSync(path.resolve(__dirname, '../playground-temp'))
  }
}
