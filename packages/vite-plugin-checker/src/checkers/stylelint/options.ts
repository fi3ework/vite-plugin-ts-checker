/* eslint-disable */

/**
 * This file is copied and modified from https://github.com/stylelint/stylelint/blob/97ea6f7446b861fd8940f69e90b41fa9ab1fffb5/lib/cli.js
 *
 */

'use strict'

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

import meow from 'meow'
import type Stylelint from 'stylelint'
import { parseArgsStringToArgv } from './argv.js'

//------------------------------------------------------------------------------
// Typedefs
//------------------------------------------------------------------------------

/**
 * @typedef {object} CLIFlags
 * @property {boolean} [cache]
 * @property {string} [cacheLocation]
 * @property {string | false} config
 * @property {string} [configBasedir]
 * @property {string} [customSyntax]
 * @property {string} [printConfig]
 * @property {string} [color]
 * @property {string} [customFormatter]
 * @property {boolean} [disableDefaultIgnores]
 * @property {boolean} [fix]
 * @property {string} [formatter="json"]
 * @property {string} [help]
 * @property {boolean} [ignoreDisables]
 * @property {string} [ignorePath]
 * @property {string[]} [ignorePattern]
 * @property {string} [noColor]
 * @property {string} [outputFile]
 * @property {boolean} [stdin]
 * @property {string} [stdinFilename]
 * @property {boolean} [reportNeedlessDisables]
 * @property {boolean} [reportInvalidScopeDisables]
 * @property {boolean} [reportDescriptionlessDisables]
 * @property {number} [maxWarnings]
 * @property {boolean} quiet
 * @property {string} [syntax]
 * @property {string} [version]
 * @property {boolean} [allowEmptyInput]
 */

/**
 * @typedef {object} CLIOptions
 * @property {any} input
 * @property {any} help
 * @property {any} pkg
 * @property {Function} showHelp
 * @property {Function} showVersion
 * @property {CLIFlags} flags
 */

/**
 * @typedef {object} OptionBaseType
 * @property {any} formatter
 * @property {boolean} [cache]
 * @property {string} [configFile]
 * @property {string} [cacheLocation]
 * @property {string} [customSyntax]
 * @property {string} [codeFilename]
 * @property {string} [configBasedir]
 * @property {boolean} [quiet]
 * @property {any} [printConfig]
 * @property {boolean} [fix]
 * @property {boolean} [ignoreDisables]
 * @property {any} [ignorePath]
 * @property {string} [outputFile]
 * @property {boolean} [reportNeedlessDisables]
 * @property {boolean} [reportInvalidScopeDisables]
 * @property {boolean} [reportDescriptionlessDisables]
 * @property {boolean} [disableDefaultIgnores]
 * @property {number} [maxWarnings]
 * @property {string} [syntax]
 * @property {string[]} [ignorePattern]
 * @property {boolean} [allowEmptyInput]
 * @property {string} [files]
 * @property {string} [code]
 */

//------------------------------------------------------------------------------
// Initialization and Public Interface
//------------------------------------------------------------------------------

const EXIT_CODE_ERROR = 2

export const translateOptions = async (command: string) => {
  const result = meow({
    autoHelp: false,
    autoVersion: false,
    importMeta: import.meta,
    help: `
    Usage: stylelint [input] [options]
    Input: Files(s), glob(s), or nothing to use stdin.
      If an input argument is wrapped in quotation marks, it will be passed to
      globby for cross-platform glob support. node_modules are always ignored.
      You can also pass no input and use stdin, instead.
    Options:
      --config
        Path to a specific configuration file (JSON, YAML, or CommonJS), or the
        name of a module in node_modules that points to one. If no --config
        argument is provided, stylelint will search for configuration files in
        the following places, in this order:
          - a stylelint property in package.json
          - a .stylelintrc file (with or without filename extension:
            .json, .yaml, .yml, and .js are available)
          - a stylelint.config.js file exporting a JS object
        The search will begin in the working directory and move up the directory
        tree until a configuration file is found.
      --config-basedir
        An absolute path to the directory that relative paths defining "extends"
        and "plugins" are *relative to*. Only necessary if these values are
        relative paths.
      --print-config
        Print the configuration for the given path.
      --ignore-path, -i
        Path to a file containing patterns that describe files to ignore. The
        path can be absolute or relative to process.cwd(). By default, stylelint
        looks for .stylelintignore in process.cwd().
      --ignore-pattern, --ip
        Pattern of files to ignore (in addition to those in .stylelintignore)
      --fix
        Automatically fix problems of certain rules.
      --custom-syntax
        Module name or path to a JS file exporting a PostCSS-compatible syntax.
      --stdin
        Accept stdin input even if it is empty.
      --stdin-filename
        A filename to assign stdin input.
      --ignore-disables, --id
        Ignore stylelint-disable comments.
      --disable-default-ignores, --di
        Allow linting of node_modules.
      --cache                       [default: false]
        Store the info about processed files in order to only operate on the
        changed ones the next time you run stylelint. By default, the cache
        is stored in "./.stylelintcache". To adjust this, use --cache-location.
      --cache-location              [default: '.stylelintcache']
        Path to a file or directory to be used for the cache location.
        Default is "./.stylelintcache". If a directory is specified, a cache
        file will be created inside the specified folder, with a name derived
        from a hash of the current working directory.
        If the directory for the cache does not exist, make sure you add a trailing "/"
        on *nix systems or "\\" on Windows. Otherwise the path will be assumed to be a file.
      --formatter, -f               [default: "string"]
        The output formatter: "compact", "json", "tap", "unix" or "verbose"
      --custom-formatter
        Path to a JS file exporting a custom formatting function.
      --quiet, -q
        Only register problems for rules with an "error"-level severity (ignore
        "warning"-level).
      --color
      --no-color
        Force enabling/disabling of color.
      --report-needless-disables, --rd
        Also report errors for stylelint-disable comments that are not blocking a lint warning.
        The process will exit with code ${EXIT_CODE_ERROR} if needless disables are found.
      --report-invalid-scope-disables, --risd
        Report stylelint-disable comments that used for rules that don't exist within the configuration object.
        The process will exit with code ${EXIT_CODE_ERROR} if invalid scope disables are found.
      --report-descriptionless-disables, --rdd
        Report stylelint-disable comments without a description.
        The process will exit with code ${EXIT_CODE_ERROR} if descriptionless disables are found.
      --max-warnings, --mw
        Number of warnings above which the process will exit with code ${EXIT_CODE_ERROR}.
        Useful when setting "defaultSeverity" to "warning" and expecting the
        process to fail on warnings (e.g. CI build).
      --output-file, -o
        Path of file to write report.
      --version, -v
        Show the currently installed version of stylelint.
      --allow-empty-input, --aei
        When glob pattern matches no files, the process will exit without throwing an error.
	`,
    flags: {
      allowEmptyInput: {
        shortFlag: 'aei',
        type: 'boolean',
      },
      cache: {
        type: 'boolean',
      },
      cacheLocation: {
        type: 'string',
      },
      cacheStrategy: {
        type: 'string',
      },
      color: {
        type: 'boolean',
      },
      config: {
        type: 'string',
      },
      configBasedir: {
        type: 'string',
      },
      customFormatter: {
        type: 'string',
      },
      customSyntax: {
        type: 'string',
      },
      disableDefaultIgnores: {
        shortFlag: 'di',
        type: 'boolean',
      },
      fix: {
        type: 'boolean',
      },
      formatter: {
        shortFlag: 'f',
        default: 'string',
        type: 'string',
      },
      help: {
        shortFlag: 'h',
        type: 'boolean',
      },
      ignoreDisables: {
        shortFlag: 'id',
        type: 'boolean',
      },
      ignorePath: {
        shortFlag: 'i',
        type: 'string',
        isMultiple: true,
      },
      ignorePattern: {
        shortFlag: 'ip',
        type: 'string',
        isMultiple: true,
      },
      maxWarnings: {
        shortFlag: 'mw',
        type: 'number',
      },
      outputFile: {
        shortFlag: 'o',
        type: 'string',
      },
      printConfig: {
        type: 'boolean',
      },
      quiet: {
        shortFlag: 'q',
        type: 'boolean',
      },
      reportDescriptionlessDisables: {
        shortFlag: 'rdd',
        type: 'boolean',
      },
      reportInvalidScopeDisables: {
        shortFlag: 'risd',
        type: 'boolean',
      },
      reportNeedlessDisables: {
        shortFlag: 'rd',
        type: 'boolean',
      },
      stdin: {
        type: 'boolean',
      },
      stdinFilename: {
        type: 'string',
      },
      version: {
        shortFlag: 'v',
        type: 'boolean',
      },
      globbyOptions: {
        shortFlag: 'go',
        type: 'string',
      },
    },
    argv: parseArgsStringToArgv(command),
  })

  const optionsBase = {
    ...Object.fromEntries(
      Object.entries(result.flags).filter(([key]) =>
        [
          'files',
          'globbyOptions',
          'cache',
          'cacheLocation',
          'code',
          'codeFilename',
          'config',
          'configFile',
          'configBasedir',
          'cwd',
          'ignoreDisables',
          'ignorePath',
          'ignorePattern',
          'reportDescriptionlessDisables',
          'reportNeedlessDisables',
          'reportInvalidScopeDisables',
          'maxWarnings',
          'customSyntax',
          'formatter',
          'disableDefaultIgnores',
          'fix',
          'allowEmptyInput',
          'quiet',
        ].includes(key)
      )
    ),
    formatter: result.flags.formatter === 'string' ? 'json' : result.flags.formatter,
    files: result.input[1],
  } as Stylelint.LinterOptions

  return optionsBase
}
