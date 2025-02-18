import { type Stats, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import picomatch from 'picomatch'

export function createIgnore(_root: string, pattern: string | string[] = []) {
  const paths = Array.isArray(pattern) ? pattern : [pattern]
  const root = _root.replace(/\\/g, '/')

  const globs = paths.flatMap((f) => {
    const resolvedPath = resolve(root, f).replace(/\\/g, '/')
    const relativePath = relative(root, resolvedPath).replace(/\\/g, '/')
    try {
      const isDirectory =
        !relativePath.includes('*') && statSync(resolvedPath).isDirectory()
      if (isDirectory) {
        return [relativePath, join(relativePath, '**/*')]
      }
    } catch {}
    return [relativePath]
  })

  const matcher = picomatch(globs, { cwd: root })

  return (path: string, _stats?: Stats) => {
    return (
      path.includes('node_modules') ||
      (path !== root &&
        !matcher(relative(root, path).replace(/\\/g, '/')) &&
        !(_stats ?? statSync(path)).isDirectory())
    )
  }
}
