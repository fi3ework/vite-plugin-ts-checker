import { spawn } from 'node:child_process'
import { type ProcessEnv, npmRunPathEnv } from 'npm-run-path'
import colors from 'picocolors'

import type { ConfigEnv, Logger, Plugin } from 'vite'
import { Checker } from './Checker.js'
import {
  RUNTIME_CLIENT_ENTRY_PATH,
  RUNTIME_CLIENT_RUNTIME_PATH,
  WS_CHECKER_RECONNECT_EVENT,
  composePreambleCode,
  runtimeCode,
  wrapVirtualPrefix,
} from './client/index.js'
import {
  ACTION_TYPES,
  type Action,
  type BuildCheckBinStr,
  type BuildInCheckerNames,
  type ClientDiagnosticPayload,
  type ClientReconnectPayload,
  type PluginConfig,
  type ServeAndBuildChecker,
  type UserPluginConfig,
} from './types.js'

const buildInCheckerKeys: BuildInCheckerNames[] = [
  'typescript',
  'vueTsc',
  'vls',
  'eslint',
  'stylelint',
  'biome',
]

async function createCheckers(
  userConfig: UserPluginConfig,
  env: ConfigEnv,
): Promise<ServeAndBuildChecker[]> {
  const serveAndBuildCheckers: ServeAndBuildChecker[] = []
  const { enableBuild, overlay } = userConfig
  const sharedConfig = { enableBuild, overlay }

  // buildInCheckerKeys.forEach(async (name: BuildInCheckerNames) => {
  for (const name of buildInCheckerKeys) {
    if (!userConfig[name]) continue
    const { createServeAndBuild } = await import(`./checkers/${name}/main.js`)
    serveAndBuildCheckers.push(
      createServeAndBuild({ [name]: userConfig[name], ...sharedConfig }, env),
    )
  }

  return serveAndBuildCheckers
}

export function checker(userConfig: UserPluginConfig): Plugin {
  const enableBuild = userConfig?.enableBuild ?? true
  const enableOverlay = userConfig?.overlay !== false
  const enableTerminal = userConfig?.terminal !== false
  const overlayConfig =
    typeof userConfig?.overlay === 'object' ? userConfig?.overlay : {}
  let initialized = false
  let initializeCounter = 0
  let checkers: ServeAndBuildChecker[] = []
  let isProduction = false
  let baseWithOrigin: string
  let viteMode: ConfigEnv['command'] | undefined
  let buildWatch = false
  let logger: Logger | null = null
  let checkerPromise: Promise<void> | null = null

  return {
    name: 'vite-plugin-checker',
    enforce: 'pre',
    // @ts-ignore
    __internal__checker: Checker,
    config: async (config, env) => {
      // for dev mode (1/2)
      // Initialize checker with config
      viteMode = env.command
      // avoid running twice when running in SSR
      if (initializeCounter === 0) {
        initializeCounter++
      } else {
        initialized = true
        return
      }

      checkers = await createCheckers(userConfig || {}, env)
      if (viteMode !== 'serve') return

      for (const checker of checkers) {
        const workerConfig = checker.serve.config
        workerConfig({
          enableOverlay,
          enableTerminal,
          env,
        })
      }
    },
    configResolved(config) {
      logger = config.logger
      baseWithOrigin = config.server.origin
        ? config.server.origin + config.base
        : config.base
      isProduction ||= config.isProduction || config.command === 'build'
      buildWatch = !!config.build.watch
    },
    async buildEnd() {
      if (viteMode !== 'serve') {
        await checkerPromise
      }

      if (initialized) return

      if (viteMode === 'serve') {
        for (const checker of checkers) {
          const { worker } = checker.serve
          worker.terminate()
        }
      }
    },
    resolveId(id) {
      if (
        id === RUNTIME_CLIENT_RUNTIME_PATH ||
        id === RUNTIME_CLIENT_ENTRY_PATH
      ) {
        return wrapVirtualPrefix(id)
      }

      return
    },
    load(id) {
      if (id === wrapVirtualPrefix(RUNTIME_CLIENT_RUNTIME_PATH)) {
        return runtimeCode
      }

      if (id === wrapVirtualPrefix(RUNTIME_CLIENT_ENTRY_PATH)) {
        return composePreambleCode({ baseWithOrigin, overlayConfig })
      }

      return
    },
    transformIndexHtml() {
      if (initialized) return
      if (isProduction) return

      return [
        {
          tag: 'script',
          attrs: { type: 'module' },
          children: composePreambleCode({ baseWithOrigin, overlayConfig }),
        },
      ]
    },
    buildStart: () => {
      if (initialized) return
      // only run in build mode
      // run a bin command in a separated process
      if (!isProduction || !enableBuild) return

      const localEnv = npmRunPathEnv({
        env: process.env,
        cwd: process.cwd(),
        execPath: process.execPath,
      })

      const spawnedCheckers = checkers.map((checker) =>
        spawnChecker(checker, userConfig, localEnv),
      )

      // wait for checker states while avoiding blocking the build from continuing in parallel
      checkerPromise = Promise.all(spawnedCheckers).then((exitCodes) => {
        const exitCode = exitCodes.find((code) => code !== 0) ?? 0
        // do not exit the process if run `vite build --watch`
        if (exitCode !== 0 && !buildWatch) {
          process.exit(exitCode)
        }
      })
    },
    configureServer(server) {
      if (initialized) return

      const latestOverlayErrors: ClientReconnectPayload['data'] = new Array(
        checkers.length,
      )
      // for dev mode (2/2)
      // Get the server instance and keep reference in a closure
      checkers.forEach((checker, index) => {
        const { worker, configureServer: workerConfigureServer } = checker.serve
        workerConfigureServer({ root: userConfig.root || server.config.root })
        worker.on('message', (action: Action) => {
          if (action.type === ACTION_TYPES.overlayError) {
            latestOverlayErrors[index] =
              action.payload as ClientDiagnosticPayload
            if (action.payload) {
              server.ws.send('vite-plugin-checker', action.payload)
            }
          } else if (action.type === ACTION_TYPES.console) {
            if (Checker.logger.length) {
              // for test injection and customize logger in the future
              Checker.log(action)
            } else {
              logger!.error(action.payload)
            }
          }
        })
      })

      if (server.ws.on) {
        server.watcher.on('change', () => {
          logger!.clearScreen('error')
        })
        server.ws.on('vite-plugin-checker', (data) => {
          // NOTE: sync modification with packages /packages/runtime/src/ws.js
          if (data.event === 'runtime-loaded') {
            server.ws.send('vite-plugin-checker', {
              event: WS_CHECKER_RECONNECT_EVENT,
              data: latestOverlayErrors.filter(Boolean),
            })
          }
        })
      } else {
        setTimeout(() => {
          logger!.warn(
            colors.yellow(
              '[vite-plugin-checker]: `server.ws.on` is introduced to Vite in 2.6.8, see [PR](https://github.com/vitejs/vite/pull/5273) and [changelog](https://github.com/vitejs/vite/blob/main/packages/vite/CHANGELOG.md#268-2021-10-18). \nvite-plugin-checker relies on `server.ws.on` to send overlay message to client. Support for Vite < 2.6.8 will be removed in the next major version release.',
            ),
          )
          // make a delay to avoid flush by Vite's console
        }, 5000)
      }
    },
  }
}

function spawnChecker(
  checker: ServeAndBuildChecker,
  userConfig: Partial<PluginConfig>,
  localEnv: ProcessEnv,
) {
  return new Promise<number>((resolve) => {
    const buildBin = checker.build.buildBin
    const finalBin: BuildCheckBinStr =
      typeof buildBin === 'function' ? buildBin(userConfig) : buildBin

    const proc = spawn(...finalBin, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: localEnv,
      // shell is necessary on windows to get the process to even start.
      // Command line args constructed by checkers therefore need to escape double quotes
      // to have them not striped out by cmd.exe. Using shell on all platforms lets us avoid
      // having to perform platform-specific logic around escaping quotes since all platform
      // shells will strip out unescaped double quotes. E.g. shell=false on linux only would
      // result in escaped quotes not being unescaped.
      shell: true,
    })

    proc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        resolve(code)
      } else {
        resolve(0)
      }
    })
  })
}

export default checker
