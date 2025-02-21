const path = require('node:path')

const vueTscDir = path.dirname(require.resolve('vue-tsc/package.json'))
const vue = /** @type {typeof import('@vue/language-core')} */ (
  require(require.resolve('@vue/language-core', { paths: [vueTscDir] }))
)
const windowsPathReg = /\\/g

const removeEmitGlobalTypesRegexp =
  /^[^\n]*__VLS_globalTypesStart[\w\W]*__VLS_globalTypesEnd[^\n]*\n?$/gm

/**
 * @param dts {string}
 * @returns {string}
 */
function removeEmitGlobalTypes(dts) {
  return dts.replace(removeEmitGlobalTypesRegexp, '')
}

// #region copied from https://github.com/vuejs/language-tools/blob/0781998a29f176ad52c30d3139d5c78a5688bd5d/packages/tsc/index.ts
/**
 * @param {typeof import('typescript')} ts
 * @param {import('typescript').CreateProgramOptions} options
 */
exports.getLanguagePlugins = (ts, options) => {
  const { configFilePath } = options.options
  const vueOptions =
    typeof configFilePath === 'string'
      ? vue.createParsedCommandLine(
          ts,
          ts.sys,
          configFilePath.replace(windowsPathReg, '/'),
        ).vueOptions
      : vue.resolveVueCompilerOptions({})
  const host = /** @type {import('typescript').CompilerHost} */ (options.host)
  const writeFile = host.writeFile.bind(host)
  host.writeFile = (fileName, contents, ...args) => {
    return writeFile(fileName, removeEmitGlobalTypes(contents), ...args)
  }
  const vueLanguagePlugin = vue.createVueLanguagePlugin(
    ts,
    options.options,
    vueOptions,
    (id) => id,
  )
  return [vueLanguagePlugin]
}
// #endregion
