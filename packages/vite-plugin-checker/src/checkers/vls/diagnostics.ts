import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Duplex } from 'node:stream'
import chokidar from 'chokidar'
import colors from 'picocolors'
import { globSync } from 'tinyglobby'
import { VLS } from 'vls'
import type { TextDocument } from 'vscode-languageserver-textdocument'
import {
  type Diagnostic,
  DiagnosticSeverity,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidOpenTextDocumentNotification,
  type InitializeParams,
  InitializeRequest,
  type InitializeResult,
  type Logger,
  type ServerCapabilities,
  StreamMessageReader,
  StreamMessageWriter,
  createConnection,
  createProtocolConnection,
} from 'vscode-languageserver/node.js'
import { URI } from 'vscode-uri'

import {
  type NormalizedDiagnostic,
  diagnosticToTerminalLog,
  normalizeLspDiagnostic,
  normalizePublishDiagnosticParams,
} from '../../logger.js'
import type { DeepPartial } from '../../types.js'
import { type VlsOptions, getInitParams } from './initParams.js'

import { FileDiagnosticManager } from '../../FileDiagnosticManager.js'

enum DOC_VERSION {
  init = -1,
}

type LogLevel = (typeof logLevels)[number]
export const logLevels = ['ERROR', 'WARN', 'INFO', 'HINT'] as const

let disposeSuppressConsole: ReturnType<typeof suppressConsole>
let initialVueFilesCount = 0
let initialVueFilesTick = 0
const fileDiagnosticManager = new FileDiagnosticManager()

export const logLevel2Severity = {
  ERROR: DiagnosticSeverity.Error,
  WARN: DiagnosticSeverity.Warning,
  INFO: DiagnosticSeverity.Information,
  HINT: DiagnosticSeverity.Hint,
}

export interface DiagnosticOptions {
  watch: boolean
  verbose: boolean
  config: DeepPartial<VlsOptions> | null
  onDispatchDiagnostics?: (normalized: NormalizedDiagnostic[]) => void
  onDispatchDiagnosticsSummary?: (
    errorCount: number,
    warningCount: number,
  ) => void
}

export async function diagnostics(
  workspace: string | null,
  logLevel: LogLevel,
  options: DiagnosticOptions = { watch: false, verbose: false, config: null },
) {
  if (options.verbose) {
    console.log('====================================')
    console.log('Getting Vetur diagnostics')
  }
  let workspaceUri: URI

  if (workspace) {
    const absPath = path.resolve(process.cwd(), workspace)
    console.log(`Loading Vetur in workspace path: ${colors.green(absPath)}`)
    workspaceUri = URI.file(absPath)
  } else {
    console.log(
      `Loading Vetur in current directory: ${colors.green(process.cwd())}`,
    )
    workspaceUri = URI.file(process.cwd())
  }

  const result = await getDiagnostics(
    workspaceUri,
    logLevel2Severity[logLevel],
    options,
  )

  if (options.verbose) {
    console.log('====================================')
  }

  // dispatch error summary in build mode
  if (!options.watch && typeof result === 'object' && result !== null) {
    const { initialErrorCount, initialWarningCount } = result
    options?.onDispatchDiagnosticsSummary?.(
      initialErrorCount,
      initialWarningCount,
    )
    process.exit(initialErrorCount > 0 ? 1 : 0)
  }
}

class NullLogger implements Logger {
  public error(_message: string): void {}
  public warn(_message: string): void {}
  public info(_message: string): void {}
  public log(_message: string): void {}
}

export class TestStream extends Duplex {
  public override _write(chunk: string, _encoding: string, done: () => void) {
    this.emit('data', chunk)
    done()
  }
  public override _read(_size: number) {}
}

function suppressConsole() {
  let disposed = false
  const rawConsoleLog = console.log
  console.log = () => {}

  return () => {
    if (disposed) return
    disposed = true
    console.log = rawConsoleLog
  }
}

export async function prepareClientConnection(
  workspaceUri: URI,
  severity: DiagnosticSeverity,
  options: DiagnosticOptions,
) {
  const up = new TestStream()
  const down = new TestStream()
  const logger = new NullLogger()

  const clientConnection = createProtocolConnection(
    new StreamMessageReader(down),
    new StreamMessageWriter(up),
    logger,
  )

  const serverConnection = createConnection(
    new StreamMessageReader(up),
    new StreamMessageWriter(down),
  )

  // hijack sendDiagnostics
  serverConnection.sendDiagnostics = async (publishDiagnostics) => {
    disposeSuppressConsole?.()
    if (publishDiagnostics.version === DOC_VERSION.init) {
      return
    }

    const absFilePath = URI.parse(publishDiagnostics.uri).fsPath
    publishDiagnostics.diagnostics = filterDiagnostics(
      publishDiagnostics.diagnostics,
      severity,
    )
    const nextDiagnosticInFile =
      await normalizePublishDiagnosticParams(publishDiagnostics)
    fileDiagnosticManager.updateByFileId(absFilePath, nextDiagnosticInFile)

    const normalized = fileDiagnosticManager.getDiagnostics()
    const errorCount = normalized.filter(
      (d) => d.level === DiagnosticSeverity.Error,
    ).length
    const warningCount = normalized.filter(
      (d) => d.level === DiagnosticSeverity.Warning,
    ).length
    initialVueFilesTick++
    // only starts to log when all .vue files are loaded
    // onDispatchDiagnostics will dispatch diagnostics of all watched files
    if (initialVueFilesTick >= initialVueFilesCount) {
      options.onDispatchDiagnostics?.(normalized)
      options.onDispatchDiagnosticsSummary?.(errorCount, warningCount)
    }
  }

  const vls = new VLS(serverConnection as any)

  vls.validateTextDocument = async (
    textDocument: TextDocument,
    cancellationToken?: any,
  ) => {
    const diagnostics = await vls.doValidate(textDocument, cancellationToken)
    if (diagnostics) {
      // @ts-expect-error
      vls.lspConnection.sendDiagnostics({
        uri: textDocument.uri,
        version: textDocument.version,
        diagnostics,
      })
    }
  }

  serverConnection.onInitialize(
    async (params: InitializeParams): Promise<InitializeResult> => {
      await vls.init(params)

      if (options.verbose) {
        console.log('Vetur initialized')
        console.log('====================================')
      }

      return {
        capabilities: vls.capabilities as ServerCapabilities,
      }
    },
  )

  vls.listen()
  clientConnection.listen()

  const initParams = getInitParams(workspaceUri)

  if (options.config) {
    // Merge in used-provided VLS settings if present
    mergeDeep(initParams.initializationOptions.config, options.config)
  }

  await clientConnection.sendRequest(InitializeRequest.type, initParams)

  return { clientConnection, serverConnection, vls, up, down, logger }
}

function extToGlobs(exts: string[]) {
  return exts.map((e) => `**/*${e}`)
}

const watchedDidChangeContent = ['.vue']
const watchedDidChangeWatchedFiles = ['.js', '.ts', '.json']
const watchedDidChangeContentGlob = extToGlobs(watchedDidChangeContent)

async function getDiagnostics(
  workspaceUri: URI,
  severity: DiagnosticSeverity,
  options: DiagnosticOptions,
): Promise<{ initialErrorCount: number; initialWarningCount: number } | null> {
  const { clientConnection } = await prepareClientConnection(
    workspaceUri,
    severity,
    options,
  )

  const files = globSync([...watchedDidChangeContentGlob], {
    cwd: workspaceUri.fsPath,
    ignore: ['node_modules/**'],
  })

  if (files.length === 0) {
    console.log('[VLS checker] No input files')
    return { initialWarningCount: 0, initialErrorCount: 0 }
  }

  if (options.verbose) {
    console.log('')
    console.log('Getting diagnostics from: ', files, '\n')
  }

  const absFilePaths = files.map((f) => path.resolve(workspaceUri.fsPath, f))

  // VLS will stdout verbose log, suppress console before any serverConnection
  disposeSuppressConsole = suppressConsole()
  initialVueFilesCount = absFilePaths.length
  let initialErrorCount = 0
  let initialWarningCount = 0
  await Promise.all(
    absFilePaths.map(async (absFilePath) => {
      // serve mode - step 1
      // build mode - step 1
      // report all existing files from client side to server with type `DidOpenTextDocumentNotification.type`
      const fileText = await fs.promises.readFile(absFilePath, 'utf-8')
      clientConnection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          languageId: 'vue',
          uri: URI.file(absFilePath).toString(),
          version: DOC_VERSION.init,
          text: fileText,
        },
      })

      // build mode - step 2
      // use $/getDiagnostics to get diagnostics from server side directly
      if (options.watch) return
      try {
        let diagnostics = (await clientConnection.sendRequest(
          '$/getDiagnostics',
          {
            uri: URI.file(absFilePath).toString(),
            version: DOC_VERSION.init,
          },
        )) as Diagnostic[]

        diagnostics = filterDiagnostics(diagnostics, severity)
        let logChunk = ''
        if (diagnostics.length > 0) {
          logChunk +=
            os.EOL +
            diagnostics
              .map((d) =>
                diagnosticToTerminalLog(
                  normalizeLspDiagnostic({
                    diagnostic: d,
                    absFilePath,
                    fileText,
                  }),
                  'VLS',
                ),
              )
              .join(os.EOL)

          for (const d of diagnostics) {
            if (d.severity === DiagnosticSeverity.Error) {
              initialErrorCount++
            }
            if (d.severity === DiagnosticSeverity.Warning) {
              initialWarningCount++
            }
          }
        }

        console.log(logChunk)
        return { initialErrorCount, initialWarningCount }
      } catch (err: any) {
        console.error(err.stack)
        return { initialErrorCount, initialWarningCount }
      }
    }),
  )

  if (!options.watch) {
    return { initialErrorCount, initialWarningCount }
  }

  // serve mode - step 2
  // watch files (.vue,.js,.ts,.json) change and send notification to server
  await Promise.all(
    absFilePaths.map(async (absFilePath) => {
      const fileText = await fs.promises.readFile(absFilePath, 'utf-8')
      clientConnection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: {
          languageId: 'vue',
          uri: URI.file(absFilePath).toString(),
          version: DOC_VERSION.init,
          text: fileText,
        },
      })
    }),
  )

  const watcher = chokidar.watch([], {
    ignored: (path: string) => path.includes('node_modules'),
  })

  watcher.add(workspaceUri.fsPath)
  watcher.on('all', async (event, filePath) => {
    const extname = path.extname(filePath)
    // .vue file changed
    if (!filePath.endsWith('.vue')) return
    const fileContent = await fs.promises.readFile(filePath, 'utf-8')
    clientConnection.sendNotification(DidChangeTextDocumentNotification.type, {
      textDocument: {
        uri: URI.file(filePath).toString(),
        version: Date.now(),
      },
      contentChanges: [{ text: fileContent }],
    })

    // .js,.ts,.json file changed
    if (watchedDidChangeWatchedFiles.includes(extname)) {
      clientConnection.sendNotification(
        DidChangeWatchedFilesNotification.type,
        {
          changes: [
            {
              uri: URI.file(filePath).toString(),
              type: event === 'add' ? 1 : event === 'unlink' ? 3 : 2,
            },
          ],
        },
      )
    }
  })

  return null
}

// biome-ignore lint/complexity/noBannedTypes: <explanation>
function isObject(item: any): item is {} {
  return item && typeof item === 'object' && !Array.isArray(item)
}

function mergeDeep<T>(target: T, source: DeepPartial<T> | undefined) {
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} })
        mergeDeep(target[key], source[key])
      } else {
        Object.assign(target, { [key]: source[key] })
      }
    }
  }

  return target
}

function filterDiagnostics(
  diagnostics: Diagnostic[],
  severity: number,
): Diagnostic[] {
  /**
   * Ignore eslint errors for now
   */
  return diagnostics
    .filter((r) => r.source !== 'eslint-plugin-vue')
    .filter((r) => r.severity && r.severity <= severity)
}
