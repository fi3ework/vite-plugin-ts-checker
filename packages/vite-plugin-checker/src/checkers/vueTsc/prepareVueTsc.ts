import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path, { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const _require = createRequire(import.meta.url)

// isomorphic __dirname https://antfu.me/posts/isomorphic-dirname
const _filename = fileURLToPath(import.meta.url)
const _dirname = dirname(_filename)
const vueTscDir = dirname(_require.resolve('vue-tsc/package.json'))
const proxyApiPath = _require.resolve(
  '@volar/typescript/lib/node/proxyCreateProgram',
  {
    paths: [vueTscDir],
  },
)
const extraSupportedExtensions = ['.vue']

export async function prepareVueTsc() {
  // 1. copy typescript to folder
  const targetTsDir = path.resolve(_dirname, 'typescript-vue-tsc')
  const vueTscFlagFile = path.resolve(targetTsDir, 'vue-tsc-resolve-path')
  const currTsVersion = _require('typescript/package.json').version

  const tsMajorVersion = Number(currTsVersion.split('.')[0])
  if (tsMajorVersion < 5) {
    throw new Error(
      "\x1b[35m[vite-plugin-checker] Since 0.7.0, vue-tsc checkers requires TypeScript 5.0.0 or newer version.\nPlease upgrade TypeScript, or use v0.6.4 which works with vue-tsc^1 if you can't upgrade. Check the pull request https://github.com/fi3ework/vite-plugin-checker/pull/327 for detail.\x1b[39m\n",
    )
  }

  let shouldBuildFixture = true
  try {
    await access(targetTsDir)
    const targetTsVersion = _require(
      path.resolve(targetTsDir, 'package.json'),
    ).version
    // check fixture versions before re-use
    await access(vueTscFlagFile)
    const fixtureFlagContent = await readFile(vueTscFlagFile, 'utf8')
    if (
      targetTsVersion === currTsVersion &&
      fixtureFlagContent === proxyApiPath
    ) {
      shouldBuildFixture = false
    }
  } catch (e) {
    // no matter what error, we should rebuild the fixture
    shouldBuildFixture = true
  }

  if (shouldBuildFixture) {
    await rm(targetTsDir, { force: true, recursive: true })
    await mkdir(targetTsDir, { recursive: true })
    const sourceTsDir = path.resolve(_require.resolve('typescript'), '../..')
    await cp(sourceTsDir, targetTsDir, { recursive: true })
    await writeFile(vueTscFlagFile, proxyApiPath)

    // 2. sync modification of lib/tsc.js with vue-tsc
    await overrideTscJs(
      _require.resolve(path.resolve(targetTsDir, 'lib/typescript.js')),
    )
  }

  return { targetTsDir }
}

async function overrideTscJs(tscJsPath: string) {
  const languagePluginsFile = path.resolve(_dirname, 'languagePlugins.cjs')
  let tsc = await readFile(tscJsPath, 'utf8')
  // #region copied from https://github.com/volarjs/volar.js/blob/630f31118d3986c00cc730eb83cd896709fd547e/packages/typescript/lib/quickstart/runTsc.ts
  // add *.vue files to allow extensions
  const extsText = extraSupportedExtensions.map((ext) => `"${ext}"`).join(', ')
  // tsc = replace(tsc, /supportedTSExtensions = .*(?=;)/, (s) => `${s}.concat([[${extsText}]])`)
  tsc = replace(
    tsc,
    /supportedTSExtensions = .*(?=;)/,
    (s) =>
      // biome-ignore lint/style/useTemplate: <explanation>
      s +
      `.map((group, i) => i === 0 ? group.splice(0, 0, ${extsText}) && group : group)`,
  )
  tsc = replace(
    tsc,
    /supportedJSExtensions = .*(?=;)/,
    (s) =>
      // biome-ignore lint/style/useTemplate: <explanation>
      s +
      `.map((group, i) => i === 0 ? group.splice(0, 0, ${extsText}) && group : group)`,
  )
  tsc = replace(
    tsc,
    /allSupportedExtensions = .*(?=;)/,
    (s) =>
      // biome-ignore lint/style/useTemplate: <explanation>
      s +
      `.map((group, i) => i === 0 ? group.splice(0, 0, ${extsText}) && group : group)`,
  )

  const extsText2 = extraSupportedExtensions.map((ext) => `"${ext}"`).join(', ')
  tsc = replace(
    tsc,
    /function changeExtension\(/,
    (s) =>
      // biome-ignore lint/style/useTemplate: <explanation>
      `function changeExtension(path, newExtension) {
					return [${extsText2}].some(ext => path.endsWith(ext))
						? path + newExtension
						: _changeExtension(path, newExtension)
					}\n` + s.replace('changeExtension', '_changeExtension'),
  )

  // proxy createProgram
  tsc = replace(
    tsc,
    /function createProgram\(.+\) {/,
    (s) =>
      `var createProgram = require(${JSON.stringify(
        proxyApiPath,
      )}).proxyCreateProgram(${[
        'new Proxy({}, { get(_target, p, _receiver) { return eval(p); } } )',
        '_createProgram',
        `require(${JSON.stringify(languagePluginsFile)}).getLanguagePlugins`,
      ].join(', ')});\n${s.replace('createProgram', '_createProgram')}`,
  )

  function replace(
    _text: string,
    ...[search, replace]: Parameters<string['replace']>
  ) {
    const before = _text
    const text = _text.replace(search, replace)
    const after = text
    if (after === before) {
      throw `Search string not found: ${JSON.stringify(search.toString())}`
    }
    return after
  }
  // #endregion

  await writeFile(tscJsPath, tsc)
}
