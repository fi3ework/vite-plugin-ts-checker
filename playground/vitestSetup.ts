import { execa } from 'execa'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type * as http from 'node:http'
import os from 'node:os'
import path, { dirname, join, resolve } from 'node:path'
import { chromium } from 'playwright-chromium'
import strip from 'strip-ansi'
import { createServer, mergeConfig } from 'vite'
import { beforeAll, expect } from 'vitest'
import type { Checker } from '../packages/vite-plugin-checker/src/Checker'

import { normalizeLogSerializer } from './serializers'

import type { Browser, Page } from 'playwright-chromium'
import type { InlineConfig, ResolvedConfig, ViteDevServer } from 'vite'
import type { File } from 'vitest'

expect.addSnapshotSerializer(normalizeLogSerializer)

export const workspaceRoot = resolve(__dirname, '../')

export const isBuild = !!process.env.VITE_TEST_BUILD
export const isServe = !isBuild
export const isWindows = process.platform === 'win32'
export const viteBinPath = path.posix.join(workspaceRoot, 'packages/vite/bin/vite.js')

let server: ViteDevServer | http.Server

/**
 * Vite Dev Server when testing serve
 */
export let viteServer: ViteDevServer
/**
 * Root of the Vite fixture
 */
export let rootDir: string
/**
 * Path to the current test file
 */
export let testPath: string
/**
 * Path to the test folder
 */
export let testDir: string
/**
 * Test folder name
 */
export let testName: string
/**
 * current test using vite inline config
 * when using server.js is not possible to get the config
 */
export let viteConfig: InlineConfig | undefined

export let log = ''
export let stripedLog: string[] = []
export let diagnostics: string[] = []
export let buildSucceed: boolean

export let resolvedConfig: ResolvedConfig = undefined!

export let page: Page = undefined!
export let browser: Browser = undefined!
export let viteTestUrl = ''

declare module 'vite' {
  interface InlineConfig {
    testConfig?: {
      // relative base output use relative path
      // rewrite the url to truth file path
      baseRoute: string
    }
  }
}

export function setViteUrl(url: string): void {
  viteTestUrl = url
}

// #endregion

const DIR = join(os.tmpdir(), 'vitest_playwright_global_setup')

beforeAll(async (s) => {
  const suite = s as File
  // skip browser setup for non-playground tests
  if (!suite.filepath.includes('playground')) {
    return
  }

  const wsEndpoint = await fs.readFile(join(DIR, 'wsEndpoint'), 'utf-8')
  if (!wsEndpoint) {
    throw new Error('wsEndpoint not found')
  }

  browser = await chromium.connect(wsEndpoint)
  page = await browser.newPage()

  try {
    testPath = suite.filepath!

    testName = slash(testPath).match(/playground\/([\w-]+)\//)?.[1]
    testDir = dirname(testPath)

    // if this is a test placed under playground/xxx/__tests__
    // start a vite server in that directory.
    if (testName) {
      testDir = resolve(workspaceRoot, 'playground-temp', testName)

      // when `root` dir is present, use it as vite's root
      const testCustomRoot = resolve(testDir, 'root')
      rootDir = existsSync(testCustomRoot) ? testCustomRoot : testDir

      const testCustomServe = [
        resolve(dirname(rootDir), 'serve.ts'),
        resolve(dirname(rootDir), 'serve.js'),
      ].find((i) => existsSync(i))

      if (testCustomServe && isServe) {
        // test has custom server configuration.
        const mod = await import(testCustomServe)
        const serve = mod.serve || mod.default?.serve
        const preServe = mod.preServe || mod.default?.preServe
        if (preServe) {
          await preServe()
        }
        if (serve) {
          server = await serve()
          viteServer = mod.viteServer
          startDefaultServe({ _server: (server as any).viteDevServer, port: (server as any).port })
        }
      } else {
        await startDefaultServe({ port: 5173 + Number(process.env.VITEST_POOL_ID) })
      }
    }
  } catch (e) {
    // Closing the page since an error in the setup, for example a runtime error
    // when building the playground should skip further tests.
    // If the page remains open, a command like `await page.click(...)` produces
    // a timeout with an exception that hides the real error in the console.
    await page.close()
    await server?.close()
    throw e
  }

  return async () => {
    await page?.close()
    await server?.close()
    await browser?.close()
  }
})

export async function startDefaultServe({
  _server,
  port,
}: {
  _server?: ViteDevServer
  port?: number
} = {}): Promise<void> {
  const testCustomConfig = resolve(testDir, 'vite.config.js')

  let config: InlineConfig | undefined
  if (existsSync(testCustomConfig)) {
    // test has custom server configuration.
    config = await import(testCustomConfig).then((r) => r.default)
  }

  const options: InlineConfig = {
    root: rootDir,
    server: {
      port,
    },
    configFile: false,
  }

  if (!isBuild) {
    process.env.VITE_INLINE = 'inline-serve'
    const testConfig = mergeConfig(options, config || {})
    viteConfig = testConfig

    const viteDevServer = _server || (await createServer(testConfig))
    const checker = viteDevServer.config.plugins.filter(
      ({ name }) => name === 'vite-plugin-checker'
    )[0]

    // @ts-ignore
    setCheckerLoggerForTest(checker.__internal__checker)
    viteServer = server = await viteDevServer.listen()

    // use resolved port/base from server
    const devBase = server.config.base
    viteTestUrl = `http://localhost:${port ?? server.config.server.port}${
      devBase === '/' ? '' : devBase
    }`

    const rawWsSend = server.ws.send
    server.ws.send = (...args) => {
      const type = args?.[0]
      const payload = args?.[1]

      if (type === 'vite-plugin-checker' && payload.event === 'vite-plugin-checker:error') {
        const existedCheckerIds = diagnostics.map((d) => d)
        const currentCheckerId = payload.data.diagnostics[0]?.checkerId
        const checkerReported = existedCheckerIds.some((id) => id === currentCheckerId)

        if (checkerReported) {
          // update diagnostics for the same checker
          diagnostics = diagnostics.filter((d) => d !== currentCheckerId)
        }

        diagnostics = diagnostics.concat(payload.data.diagnostics)
      }

      // @ts-ignore
      return rawWsSend(...args)
    }

    await page.goto(viteTestUrl, {
      timeout: 1000 * 60 * 3, // 3min
    })
  } else {
    const testConfig = mergeConfig(options, config || {})
    const binPath = path.resolve(testDir, 'node_modules/vite/bin/vite.js')
    const promise = execa(binPath, ['build'], { cwd: testConfig.root })
    try {
      await promise
      buildSucceed = true
    } catch (e) {
      log = (e as any).toString()
      stripedLog.push(strip(log))
      buildSucceed = false
    }
  }
}

function setCheckerLoggerForTest(checker: typeof Checker, accumulate = true) {
  checker.logger = [
    (...args: any[]) => {
      if (accumulate) {
        log += args[0].payload
        stripedLog.push(strip(args[0].payload))
      } else {
        log = args[0].payload
        stripedLog.push(strip(args[0].payload))
      }
    },
  ]
}

export function slash(p: string): string {
  return p.replace(/\\/g, '/')
}

export function resetReceivedLog() {
  log = ''
  stripedLog = []
}

export function resetDiagnostics() {
  diagnostics = []
}
