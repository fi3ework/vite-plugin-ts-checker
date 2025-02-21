import { rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-chromium'

import type { BrowserServer } from 'playwright-chromium'
const DIR = path.join(os.tmpdir(), 'vitest_playwright_global_setup')

let browserServer: BrowserServer | undefined

export async function setup(): Promise<void> {
  browserServer = await chromium.launchServer({
    headless: !process.env.VITE_DEBUG_SERVE,
    args: process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : undefined,
  })

  await fs.mkdir(DIR, { recursive: true })
  await fs.writeFile(path.join(DIR, 'wsEndpoint'), browserServer.wsEndpoint())

  const tempDir = path.resolve(__dirname, '../playground-temp')
  await fs.rm(tempDir, { force: true, recursive: true })
  await fs.mkdir(tempDir, { recursive: true })
  await fs
    .cp(path.resolve(__dirname, '../playground'), tempDir, {
      dereference: false,
      recursive: true,
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
}

export async function teardown(): Promise<void> {
  browserServer?.close()
  if (!process.env.VITE_PRESERVE_BUILD_ARTIFACTS) {
    rmSync(path.resolve(__dirname, '../playground-temp'), { force: true, recursive: true })
  }
}
