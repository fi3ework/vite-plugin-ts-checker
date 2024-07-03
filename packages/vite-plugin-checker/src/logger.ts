import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import chalk from 'chalk'
import strip from 'strip-ansi'
import * as _vscodeUri from 'vscode-uri'

// hack to compatible with Jiti
// see details: https://github.com/fi3ework/vite-plugin-checker/issues/197
// @ts-expect-error
const URI = _vscodeUri?.default?.URI ?? _vscodeUri.URI
import { parentPort } from 'node:worker_threads'

import type { SourceLocation } from '@babel/code-frame'

import { WS_CHECKER_ERROR_EVENT } from './client/index.js'
import { createFrame, locationToBabelLocation, tsLocationToBabelLocation } from './codeFrame.js'
import {
  ACTION_TYPES,
  type ClientDiagnosticPayload,
  DiagnosticLevel,
  type DiagnosticToRuntime,
} from './types.js'
import { isMainThread } from './utils.js'

const _require = createRequire(import.meta.url)
import type { ESLint } from 'eslint'
import type Stylelint from 'stylelint'
import type {
  Diagnostic as LspDiagnostic,
  PublishDiagnosticsParams,
} from 'vscode-languageclient/node'

import type {
  Diagnostic as TsDiagnostic,
  flattenDiagnosticMessageText as flattenDiagnosticMessageTextType,
} from 'typescript'

export interface NormalizedDiagnostic {
  /** error message */
  message?: string
  /** error conclusion */
  conclusion?: string
  /** error stack */
  stack?: string | string[]
  /** file name */
  id?: string
  /** checker diagnostic source */
  checker: string
  /** raw code frame generated by @babel/code-frame */
  codeFrame?: string
  /** code frame, but striped */
  stripedCodeFrame?: string
  /** error code location */
  loc?: SourceLocation
  /** error level */
  level?: DiagnosticLevel
}

const defaultLogLevel = [
  DiagnosticLevel.Warning,
  DiagnosticLevel.Error,
  DiagnosticLevel.Suggestion,
  DiagnosticLevel.Message,
]

export function filterLogLevel(
  diagnostics: NormalizedDiagnostic,
  level?: DiagnosticLevel[]
): NormalizedDiagnostic | null
export function filterLogLevel(
  diagnostics: NormalizedDiagnostic[],
  level?: DiagnosticLevel[]
): NormalizedDiagnostic[]
export function filterLogLevel(
  diagnostics: NormalizedDiagnostic | NormalizedDiagnostic[],
  level: DiagnosticLevel[] = defaultLogLevel
): NormalizedDiagnostic | null | NormalizedDiagnostic[] {
  if (Array.isArray(diagnostics)) {
    return diagnostics.filter((d) => {
      if (typeof d.level !== 'number') return false
      return level.includes(d.level)
    })
  }
  if (!diagnostics.level) return null
  return level.includes(diagnostics.level) ? diagnostics : null
}

export function diagnosticToTerminalLog(
  d: NormalizedDiagnostic,
  name?: 'TypeScript' | 'vue-tsc' | 'VLS' | 'ESLint' | 'Stylelint'
): string {
  const nameInLabel = name ? `(${name})` : ''
  const boldBlack = chalk.bold.rgb(0, 0, 0)

  const labelMap: Record<DiagnosticLevel, string> = {
    [DiagnosticLevel.Error]: boldBlack.bgRedBright(` ERROR${nameInLabel} `),
    [DiagnosticLevel.Warning]: boldBlack.bgYellowBright(` WARNING${nameInLabel} `),
    [DiagnosticLevel.Suggestion]: boldBlack.bgBlueBright(` SUGGESTION${nameInLabel} `),
    [DiagnosticLevel.Message]: boldBlack.bgCyanBright(` MESSAGE${nameInLabel} `),
  }

  const levelLabel = labelMap[d.level ?? DiagnosticLevel.Error]
  const fileLabel = `${boldBlack.bgCyanBright(' FILE ')} `
  const position = d.loc
    ? `${chalk.yellow(d.loc.start.line)}:${chalk.yellow(d.loc.start.column)}`
    : ''

  return [
    `${levelLabel} ${d.message}`,
    `${fileLabel + d.id}:${position}${os.EOL}`,
    d.codeFrame + os.EOL,
    d.conclusion,
  ]
    .filter(Boolean)
    .join(os.EOL)
}

export function diagnosticToRuntimeError(d: NormalizedDiagnostic): DiagnosticToRuntime
export function diagnosticToRuntimeError(d: NormalizedDiagnostic[]): DiagnosticToRuntime[]
export function diagnosticToRuntimeError(
  diagnostics: NormalizedDiagnostic | NormalizedDiagnostic[]
): DiagnosticToRuntime | DiagnosticToRuntime[] {
  const diagnosticsArray = Array.isArray(diagnostics) ? diagnostics : [diagnostics]

  const results: DiagnosticToRuntime[] = diagnosticsArray.map((d) => {
    let loc: DiagnosticToRuntime['loc']
    if (d.loc) {
      loc = {
        file: d.id ?? '',
        line: d.loc.start.line,
        column: typeof d.loc.start.column === 'number' ? d.loc.start.column : 0,
      }
    }

    return {
      message: d.message ?? '',
      stack:
        typeof d.stack === 'string' ? d.stack : Array.isArray(d.stack) ? d.stack.join(os.EOL) : '',
      id: d.id,
      frame: d.stripedCodeFrame,
      checkerId: d.checker,
      level: d.level,
      loc,
    }
  })

  return Array.isArray(diagnostics) ? results : results[0]!
}

export function toClientPayload(
  id: string,
  diagnostics: DiagnosticToRuntime[]
): ClientDiagnosticPayload {
  return {
    event: WS_CHECKER_ERROR_EVENT,
    data: {
      checkerId: id,
      diagnostics,
    },
  }
}

export function wrapCheckerSummary(checkerName: string, rawSummary: string): string {
  return `[${checkerName}] ${rawSummary}`
}

export function composeCheckerSummary(
  checkerName: string,
  errorCount: number,
  warningCount: number
): string {
  const message = `Found ${errorCount} error${
    errorCount > 1 ? 's' : ''
  } and ${warningCount} warning${warningCount > 1 ? 's' : ''}`

  const hasError = errorCount > 0
  const hasWarning = warningCount > 0
  const color = hasError ? 'red' : hasWarning ? 'yellow' : 'green'
  return chalk[color](wrapCheckerSummary(checkerName, message))
}

/* ------------------------------- TypeScript ------------------------------- */

export function normalizeTsDiagnostic(d: TsDiagnostic): NormalizedDiagnostic {
  const fileName = d.file?.fileName
  const {
    flattenDiagnosticMessageText,
  }: {
    flattenDiagnosticMessageText: typeof flattenDiagnosticMessageTextType
  } = _require('typescript')

  const message = flattenDiagnosticMessageText(d.messageText, os.EOL)

  let loc: SourceLocation | undefined
  const pos = d.start === undefined ? null : d.file?.getLineAndCharacterOfPosition?.(d.start)
  if (pos && d.file && typeof d.start === 'number' && typeof d.length === 'number') {
    loc = tsLocationToBabelLocation({
      start: pos,
      end: d.file.getLineAndCharacterOfPosition(d.start + d.length),
    })
  }

  let codeFrame: string | undefined
  if (loc) {
    codeFrame = createFrame(d.file!.text, loc)
  }

  return {
    message,
    conclusion: '',
    codeFrame,
    stripedCodeFrame: codeFrame && strip(codeFrame),
    id: fileName,
    checker: 'TypeScript',
    loc,
    level: d.category as any as DiagnosticLevel,
  }
}

/* ----------------------------------- LSP ---------------------------------- */

export function normalizeLspDiagnostic({
  diagnostic,
  absFilePath,
  fileText,
}: {
  diagnostic: LspDiagnostic
  absFilePath: string
  fileText: string
}): NormalizedDiagnostic {
  let level = DiagnosticLevel.Error
  const loc = tsLocationToBabelLocation(diagnostic.range)
  const codeFrame = createFrame(fileText, loc)

  switch (diagnostic.severity) {
    case 1: // Error
      level = DiagnosticLevel.Error
      break
    case 2: // Warning
      level = DiagnosticLevel.Warning
      break
    case 3: // Information
      level = DiagnosticLevel.Message
      break
    case 4: // Hint
      level = DiagnosticLevel.Suggestion
      break
  }

  return {
    message: diagnostic.message.trim(),
    conclusion: '',
    codeFrame,
    stripedCodeFrame: codeFrame && strip(codeFrame),
    id: absFilePath,
    checker: 'VLS',
    loc,
    level,
  }
}

export async function normalizePublishDiagnosticParams(
  publishDiagnostics: PublishDiagnosticsParams
): Promise<NormalizedDiagnostic[]> {
  const diagnostics = publishDiagnostics.diagnostics
  const absFilePath = uriToAbsPath(publishDiagnostics.uri)
  const { readFile } = fs.promises
  const fileText = await readFile(absFilePath, 'utf-8')

  const res = diagnostics.map((d) => {
    return normalizeLspDiagnostic({
      diagnostic: d,
      absFilePath,
      fileText,
    })
  })

  return res
}

export function uriToAbsPath(documentUri: string): string {
  return URI.parse(documentUri).fsPath
}

/* --------------------------------- vue-tsc -------------------------------- */

export function normalizeVueTscDiagnostic(d: TsDiagnostic): NormalizedDiagnostic {
  const diagnostic = normalizeTsDiagnostic(d)
  diagnostic.checker = 'vue-tsc'
  return diagnostic
}

/* --------------------------------- ESLint --------------------------------- */

const isNormalizedDiagnostic = (
  d: NormalizedDiagnostic | null | undefined
): d is NormalizedDiagnostic => {
  return Boolean(d)
}

export function normalizeEslintDiagnostic(diagnostic: ESLint.LintResult): NormalizedDiagnostic[] {
  return diagnostic.messages
    .map((d) => {
      let level = DiagnosticLevel.Error
      switch (d.severity) {
        case 0: // off, ignore this
          level = DiagnosticLevel.Error
          return null
        case 1: // warn
          level = DiagnosticLevel.Warning
          break
        case 2: // error
          level = DiagnosticLevel.Error
          break
      }

      const loc = locationToBabelLocation(d)

      const codeFrame = createFrame(diagnostic.source ?? '', loc)

      return {
        message: `${d.message} (${d.ruleId})`,
        conclusion: '',
        codeFrame,
        stripedCodeFrame: codeFrame && strip(codeFrame),
        id: diagnostic.filePath,
        checker: 'ESLint',
        loc,
        level,
      } as any as NormalizedDiagnostic
    })
    .filter(isNormalizedDiagnostic)
}

/* --------------------------------- Stylelint --------------------------------- */

export function normalizeStylelintDiagnostic(
  diagnostic: Stylelint.LintResult
): NormalizedDiagnostic[] {
  return diagnostic.warnings
    .map((d) => {
      let level = DiagnosticLevel.Error
      switch (d.severity) {
        case 'warning': // warn
          level = DiagnosticLevel.Warning
          break
        case 'error': // error
          level = DiagnosticLevel.Error
          break
        default:
          level = DiagnosticLevel.Error
          return null
      }

      const loc = locationToBabelLocation(d)

      const codeFrame = createFrame(
        // @ts-ignore
        diagnostic._postcssResult.css ?? '',
        loc
      )

      return {
        message: `${d.text} (${d.rule})`,
        conclusion: '',
        codeFrame,
        stripedCodeFrame: codeFrame && strip(codeFrame),
        id: diagnostic.source,
        checker: 'Stylelint',
        loc,
        level,
      } as any as NormalizedDiagnostic
    })
    .filter(isNormalizedDiagnostic)
}

/* ------------------------------ miscellaneous ----------------------------- */
export function ensureCall(callback: CallableFunction) {
  setTimeout(() => {
    callback()
  })
}

export function consoleLog(value: string) {
  if (isMainThread) {
    console.log(value)
  } else {
    parentPort?.postMessage({
      type: ACTION_TYPES.console,
      payload: value,
    })
  }
}
