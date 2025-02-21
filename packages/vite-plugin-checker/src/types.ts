import type { Worker } from 'node:worker_threads'
import type { ESLint } from 'eslint'
import type * as Stylelint from 'stylelint'
import type { ConfigEnv, ErrorPayload } from 'vite'
import type { VlsOptions } from './checkers/vls/initParams.js'

/* ----------------------------- userland plugin options ----------------------------- */

interface TsConfigOptions {
  /**
   * path to tsconfig.json file
   */
  tsconfigPath: string
  /**
   * path to typescript package
   */
  typescriptPath: string
  /**
   * root path of cwd
   */
  root: string
  /**
   * root path of cwd
   */
  buildMode: boolean
}

/**
 * TypeScript checker configuration
 * @default true
 */
export type TscConfig =
  /**
   * - set to `true` to enable type checking with default configuration
   * - set to `false` to disable type checking, you can also remove `config.typescript` directly
   */
  boolean | Partial<TsConfigOptions>

/** vue-tsc checker configuration */
export type VueTscConfig =
  /**
   * - set to `true` to enable type checking with default configuration
   * - set to `false` to disable type checking, you can also remove `config.vueTsc` directly
   */
  boolean | Partial<Omit<TsConfigOptions, 'buildMode'>>

/** vls checker configuration */
export type VlsConfig = boolean | DeepPartial<VlsOptions>

/** ESLint checker configuration */
export type EslintConfig =
  | false
  | {
      /**
       * lintCommand will be executed at build mode, and will also be used as
       * default config for dev mode when options.eslint.dev.eslint is nullable.
       */
      lintCommand: string
      /**
       * @default false
       */
      useFlatConfig?: boolean
      dev?: Partial<{
        /** You can override the options of translated from lintCommand. */
        overrideConfig: ESLint.Options
        /** which level of the diagnostic will be emitted from plugin */
        logLevel: ('error' | 'warning')[]
      }>
    }

/** Stylelint checker configuration */
export type StylelintConfig =
  | false
  | {
      /**
       * lintCommand will be executed at build mode, and will also be used as
       * default config for dev mode when options.stylelint.dev.stylelint is nullable.
       */
      lintCommand: string
      dev?: Partial<{
        /** You can override the options of translated from lintCommand. */
        overrideConfig: Stylelint.LinterOptions
        /** which level of the diagnostic will be emitted from plugin */
        logLevel: ('error' | 'warning')[]
      }>
    }

type BiomeCommand = 'lint' | 'check' | 'format' | 'ci'
/** Biome checker configuration */
export type BiomeConfig =
  | boolean
  | {
      /**
       * Command will be used in dev and build mode, will be override
       * if `dev.command` or `build.command` is set their mode.
       */
      command?: BiomeCommand
      /**
       * Flags of the command, will be override if `dev.flags`
       * or `build.command` is set their mode.
       * */
      flags?: string
      dev?: Partial<{
        /** Command will be used in dev mode */
        command: BiomeCommand
        /** Flags of the command */
        flags?: string
        /** Which level of the diagnostic will be emitted from plugin */
        logLevel: ('error' | 'warning' | 'info')[]
      }>
      build?: Partial<{
        /** Command will be used in build mode */
        command: BiomeCommand
        /** Flags of the command */
        flags?: string
      }>
    }

export enum DiagnosticLevel {
  Warning = 0,
  Error = 1,
  Suggestion = 2,
  Message = 3,
}

type ErrorPayloadErr = ErrorPayload['err']
export interface DiagnosticToRuntime extends ErrorPayloadErr {
  checkerId: string
  level?: DiagnosticLevel
}

export interface ClientDiagnosticPayload {
  event: 'vite-plugin-checker:error'
  data: {
    checkerId: string
    diagnostics: DiagnosticToRuntime[]
  }
}

export interface ClientReconnectPayload {
  event: 'vite-plugin-checker:reconnect'
  data: ClientDiagnosticPayload[]
}

export type ClientPayload = ClientDiagnosticPayload | ClientReconnectPayload

/** checkers shared configuration */
export interface SharedConfig {
  /**
   * Show overlay on UI view when there are errors or warnings in dev mode.
   * - Set `true` to show overlay
   * - Set `false` to disable overlay
   * - Set with a object to customize overlay
   *
   * @defaultValue `true`
   */
  overlay:
    | boolean
    | {
        /**
         * Set this true if you want the overlay to default to being open if
         * errors/warnings are found
         * @defaultValue `true`
         */
        initialIsOpen?: boolean | 'error'
        /**
         * The position of the vite-plugin-checker badge to open and close
         * the diagnostics panel
         * @default `bl`
         */
        position?: 'tl' | 'tr' | 'bl' | 'br'
        /**
         * Use this to add extra style string to the badge button, the string format is
         * [HTML element's style property](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/style)
         * For example, if you want to hide the badge,
         * you can pass `display: none;` to the badgeStyle property
         * @default no default value
         */
        badgeStyle?: string
        /**
         * Use this to add extra style string to the diagnostic panel, the string format is
         * [HTML element's style property](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/style)
         * For example, if you want to change the opacity of the panel,
         * you can pass `opacity: 0.8;` to the panelStyle property
         * @default no default value
         */
        panelStyle?: string
      }
  /**
   * stdout in terminal which starts the Vite server in dev mode.
   * - Set `true` to enable
   * - Set `false` to disable
   *
   * @defaultValue `true`
   */
  terminal: boolean
  /**
   * Enable checking in build mode
   * @defaultValue `true`
   */
  enableBuild: boolean
  /**
   * Configure root directory of checkers
   * @defaultValue no default value
   */
  root?: string
}

export interface BuildInCheckers {
  typescript: TscConfig
  vueTsc: VueTscConfig
  vls: VlsConfig
  eslint: EslintConfig
  stylelint: StylelintConfig
  biome: BiomeConfig
}

export type BuildInCheckerNames = keyof BuildInCheckers

export type PluginConfig = SharedConfig & BuildInCheckers

/** Userland plugin configuration */
export type UserPluginConfig = Partial<PluginConfig>

/* ----------------------------- worker actions ----------------------------- */

export enum ACTION_TYPES {
  config = 'config',
  configureServer = 'configureServer',
  overlayError = 'overlayError',
  console = 'console',
  unref = 'unref',
}

interface AbstractAction {
  type: string
  payload: unknown
}

export interface OverlayErrorAction extends AbstractAction {
  type: ACTION_TYPES.overlayError
  /**
   * send `ClientPayload` to raise error overlay
   * send `null` to clear overlay for current checker
   */
  payload: ClientPayload
}

export interface ConfigAction extends AbstractAction {
  type: ACTION_TYPES.config
  payload: ConfigActionPayload
}

export interface ConfigureServerAction extends AbstractAction {
  type: ACTION_TYPES.configureServer
  payload: {
    root: string
  }
}

export interface ConsoleAction extends AbstractAction {
  type: ACTION_TYPES.console
  payload: string
}

export interface UnrefAction extends AbstractAction {
  type: ACTION_TYPES.unref
}

interface ConfigActionPayload {
  enableOverlay: boolean
  enableTerminal: boolean
  env: ConfigEnv
}

export type Action =
  | ConfigAction
  | ConfigureServerAction
  | ConsoleAction
  | OverlayErrorAction
  | UnrefAction

/* ----------------------------- internal types ----------------------------- */

// prepare for create serve & build checker

export type BuildCheckBin = BuildCheckBinStr | BuildCheckBinFn
export type BuildCheckBinStr = [string, ReadonlyArray<string>]
export type BuildCheckBinFn = (
  config: UserPluginConfig,
) => [string, ReadonlyArray<string>]

export interface ConfigureServeChecker {
  worker: Worker
  config: (config: ConfigAction['payload']) => void
  configureServer: (serverConfig: ConfigureServerAction['payload']) => void
}

export interface ServeAndBuildChecker {
  serve: ConfigureServeChecker
  build: { buildBin: BuildCheckBin; buildFile?: string }
}

/**
 * create serve & build checker
 */

export interface ServeChecker<T extends BuildInCheckerNames = any> {
  createDiagnostic: CreateDiagnostic<T>
}

export interface CheckerDiagnostic {
  config: (options: ConfigActionPayload) => unknown
  configureServer: (options: { root: string }) => unknown
}

export type CreateDiagnostic<T extends BuildInCheckerNames = any> = (
  config: Pick<BuildInCheckers, T> & SharedConfig,
) => CheckerDiagnostic

/* ----------------------------- generic utility types ----------------------------- */

export type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>
}
