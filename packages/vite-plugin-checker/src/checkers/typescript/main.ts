import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parentPort } from 'node:worker_threads'
import colors from 'picocolors'
import invariant from 'tiny-invariant'
import type * as typescript from 'typescript'

import { Checker } from '../../Checker.js'
import {
  consoleLog,
  diagnosticToRuntimeError,
  diagnosticToTerminalLog,
  ensureCall,
  normalizeTsDiagnostic,
  toClientPayload,
  wrapCheckerSummary,
} from '../../logger.js'
import {
  ACTION_TYPES,
  type CreateDiagnostic,
  type DiagnosticToRuntime,
} from '../../types.js'

const __filename = fileURLToPath(import.meta.url)
let createServeAndBuild: any

const createDiagnostic: CreateDiagnostic<'typescript'> = (pluginConfig) => {
  let overlay = true
  let terminal = true
  let currDiagnostics: DiagnosticToRuntime[] = []

  return {
    config: async ({ enableOverlay, enableTerminal }) => {
      overlay = enableOverlay
      terminal = enableTerminal
    },
    async configureServer({ root }) {
      invariant(pluginConfig.typescript, 'config.typescript should be `false`')
      const finalConfig =
        pluginConfig.typescript === true
          ? {
              root,
              tsconfigPath: 'tsconfig.json',
              typescriptPath: 'typescript',
            }
          : {
              root: pluginConfig.typescript.root ?? root,
              tsconfigPath:
                pluginConfig.typescript.tsconfigPath ?? 'tsconfig.json',
              typescriptPath:
                pluginConfig.typescript.typescriptPath ?? 'typescript',
            }

      let configFile: string | undefined
      const ts: typeof typescript = await import(finalConfig.typescriptPath)
      configFile = ts.findConfigFile(
        finalConfig.root,
        ts.sys.fileExists,
        finalConfig.tsconfigPath,
      )

      if (configFile === undefined) {
        throw Error(
          `Failed to find a valid tsconfig.json: ${finalConfig.tsconfigPath} at ${finalConfig.root} is not a valid tsconfig`,
        )
      }

      let logChunk = ''

      // https://github.com/microsoft/TypeScript/blob/a545ab1ac2cb24ff3b1aaf0bfbfb62c499742ac2/src/compiler/watch.ts#L12-L28
      const reportDiagnostic = (diagnostic: typescript.Diagnostic) => {
        const normalizedDiagnostic = normalizeTsDiagnostic(diagnostic)
        if (normalizedDiagnostic === null) {
          return
        }

        currDiagnostics.push(diagnosticToRuntimeError(normalizedDiagnostic))
        logChunk +=
          os.EOL + diagnosticToTerminalLog(normalizedDiagnostic, 'TypeScript')
      }

      const reportWatchStatusChanged: typescript.WatchStatusReporter = (
        diagnostic,
        newLine,
        options,
        errorCount,
        // eslint-disable-next-line max-params
      ) => {
        if (diagnostic.code === 6031) return
        // https://github.com/microsoft/TypeScript/issues/32542
        // https://github.com/microsoft/TypeScript/blob/dc237b317ed4bbccd043ddda802ffde00362a387/src/compiler/diagnosticMessages.json#L4086-L4088
        switch (diagnostic.code) {
          case 6031:
          case 6032:
            // clear current error and use the newer errors
            logChunk = ''
            // currErr = null
            currDiagnostics = []
            return
          case 6193: // 1 Error
          case 6194: // 0 errors or 2+ errors
            if (overlay) {
              parentPort?.postMessage({
                type: ACTION_TYPES.overlayError,
                payload: toClientPayload('typescript', currDiagnostics),
              })
            }
        }

        ensureCall(() => {
          if (errorCount === 0) {
            logChunk = ''
          }

          if (terminal) {
            const color = errorCount && errorCount > 0 ? 'red' : 'green'
            consoleLog(
              colors[color](
                logChunk +
                  os.EOL +
                  wrapCheckerSummary(
                    'TypeScript',
                    diagnostic.messageText.toString(),
                  ),
              ),
            )
          }
        })
      }

      // https://github.com/microsoft/TypeScript/issues/32385
      // https://github.com/microsoft/TypeScript/pull/33082/files
      const createProgram = ts.createEmitAndSemanticDiagnosticsBuilderProgram

      if (
        typeof pluginConfig.typescript === 'object' &&
        pluginConfig.typescript.buildMode
      ) {
        const host = ts.createSolutionBuilderWithWatchHost(
          ts.sys,
          createProgram,
          reportDiagnostic,
          undefined,
          reportWatchStatusChanged,
        )

        ts.createSolutionBuilderWithWatch(host, [configFile], {}).build()
      } else {
        const host = ts.createWatchCompilerHost(
          configFile,
          { noEmit: true },
          ts.sys,
          createProgram,
          reportDiagnostic,
          reportWatchStatusChanged,
        )

        ts.createWatchProgram(host)
      }
    },
  }
}

export class TscChecker extends Checker<'typescript'> {
  public constructor() {
    super({
      name: 'typescript',
      absFilePath: __filename,
      build: {
        buildBin: (config) => {
          if (typeof config.typescript === 'object') {
            const {
              root = '',
              tsconfigPath = '',
              buildMode,
            } = config.typescript

            // Compiler option '--noEmit' may not be used with '--build'
            const args = [buildMode ? '-b' : '--noEmit']

            // Custom config path
            let projectPath = ''
            if (root || tsconfigPath) {
              projectPath = root ? path.join(root, tsconfigPath) : tsconfigPath
            }

            if (projectPath) {
              // In build mode, the tsconfig path is an argument to -b, e.g. "tsc -b [path]"
              if (buildMode) {
                args.push(projectPath)
              } else {
                args.push('-p', projectPath)
              }
            }

            return ['tsc', args]
          }

          return ['tsc', ['--noEmit']]
        },
      },
      createDiagnostic,
    })
  }

  public init() {
    const _createServeAndBuild = super.initMainThread()
    createServeAndBuild = _createServeAndBuild
    super.initWorkerThread()
  }
}

export { createServeAndBuild }
const tscChecker = new TscChecker()
tscChecker.prepare()
tscChecker.init()
