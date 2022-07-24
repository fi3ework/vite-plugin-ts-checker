import chokidar from 'chokidar'
import stylelint from 'stylelint'
import translateOptions from './options'
import path from 'path'
import { parentPort } from 'worker_threads'

import { Checker } from '../../Checker'
import { FileDiagnosticManager } from '../../FileDiagnosticManager'
import {
  consoleLog,
  diagnosticToTerminalLog,
  diagnosticToRuntimeError,
  filterLogLevel,
  normalizeStylelintDiagnostic,
  toViteCustomPayload,
  composeCheckerSummary,
} from '../../logger'
import { ACTION_TYPES, DiagnosticLevel } from '../../types'

const manager = new FileDiagnosticManager()

import type { CreateDiagnostic } from '../../types'

const createDiagnostic: CreateDiagnostic<'stylelint'> = (pluginConfig) => {
  let overlay = true
  let terminal = true

  return {
    config: async ({ enableOverlay, enableTerminal }) => {
      overlay = enableOverlay
      terminal = enableTerminal
    },
    async configureServer({ root }) {
      if (!pluginConfig.stylelint) return

      const translatedOptions = translateOptions(pluginConfig.stylelint.lintCommand)

      const logLevel = (() => {
        if (typeof pluginConfig.stylelint !== 'object') return undefined
        const userLogLevel = pluginConfig.stylelint.dev?.logLevel
        if (!userLogLevel) return undefined
        const map = {
          error: DiagnosticLevel.Error,
          warning: DiagnosticLevel.Warning,
        } as const

        return userLogLevel.map((l) => map[l])
      })()

      const dispatchDiagnostics = () => {
        const diagnostics = filterLogLevel(manager.getDiagnostics(), logLevel)

        if (terminal) {
          diagnostics.forEach((d) => {
            consoleLog(diagnosticToTerminalLog(d, 'Stylelint'))
          })
          const errorCount = diagnostics.filter((d) => d.level === DiagnosticLevel.Error).length
          const warningCount = diagnostics.filter((d) => d.level === DiagnosticLevel.Warning).length
          consoleLog(composeCheckerSummary('Stylelint', errorCount, warningCount))
        }

        if (overlay) {
          parentPort?.postMessage({
            type: ACTION_TYPES.overlayError,
            payload: toViteCustomPayload(
              'stylelint',
              diagnostics.map((d) => diagnosticToRuntimeError(d))
            ),
          })
        }
      }

      const handleFileChange = async (filePath: string, type: 'change' | 'unlink') => {
        const absPath = path.resolve(root, filePath)

        if (type === 'unlink') {
          manager.updateByFileId(absPath, [])
        } else if (type === 'change') {
          const { results: diagnosticsOfChangedFile } = await stylelint.lint({ files: filePath })
          const newDiagnostics = diagnosticsOfChangedFile
            .map((d) => normalizeStylelintDiagnostic(d))
            .flat(1)
          manager.updateByFileId(absPath, newDiagnostics)
        }

        dispatchDiagnostics()
      }

      // initial lint
      const { results: diagnostics } = await stylelint.lint({
        cwd: root,
        ...translatedOptions,
        ...pluginConfig.stylelint.dev?.overrideConfig,
      })

      manager.initWith(diagnostics.map((p) => normalizeStylelintDiagnostic(p)).flat(1))
      dispatchDiagnostics()

      // watch lint
      const watcher = chokidar.watch([], {
        cwd: root,
        ignored: (path: string) => path.includes('node_modules'),
      })
      watcher.add(translatedOptions.files as string)
      watcher.on('change', async (filePath) => {
        handleFileChange(filePath, 'change')
      })
      watcher.on('unlink', async (filePath) => {
        handleFileChange(filePath, 'unlink')
      })
    },
  }
}

export class StylelintChecker extends Checker<'stylelint'> {
  public constructor() {
    super({
      name: 'stylelint',
      absFilePath: __filename,
      build: {
        buildBin: (pluginConfig) => {
          if (pluginConfig.stylelint) {
            const { lintCommand } = pluginConfig.stylelint
            return ['stylelint', lintCommand.split(' ').slice(1)]
          }
          return ['stylelint', ['']]
        },
      },
      createDiagnostic,
    })
  }

  public init() {
    const createServeAndBuild = super.initMainThread()
    module.exports.createServeAndBuild = createServeAndBuild
    super.initWorkerThread()
  }
}

const stylelintChecker = new StylelintChecker()
stylelintChecker.prepare()
stylelintChecker.init()
