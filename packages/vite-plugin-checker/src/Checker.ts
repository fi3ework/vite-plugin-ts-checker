import invariant from 'tiny-invariant'
import { isInVitestEntryThread, isMainThread } from './utils.js'

import { type Script, createScript } from './worker.js'

import type {
  BuildInCheckerNames,
  BuildInCheckers,
  CreateDiagnostic,
  ServeAndBuildChecker,
} from './types.js'

if (!(isMainThread || isInVitestEntryThread)) {
  process.stdout.isTTY = true
}

interface CheckerMeta<T extends BuildInCheckerNames> {
  name: T
  absFilePath: string
  createDiagnostic: CreateDiagnostic<T>
  build: ServeAndBuildChecker['build']
  script?: Script<any>
}

export abstract class Checker<T extends BuildInCheckerNames>
  implements CheckerMeta<T>
{
  public static logger: ((...v: string[]) => unknown)[] = []

  public static log(...args: any[]) {
    for (const fn of Checker.logger) {
      fn(...args)
    }
  }

  public name: T
  public absFilePath: string
  public createDiagnostic: CreateDiagnostic<T>
  public build: ServeAndBuildChecker['build']
  public script?: Script<any>

  public constructor({
    name,
    absFilePath,
    createDiagnostic,
    build,
  }: CheckerMeta<T>) {
    this.name = name
    this.absFilePath = absFilePath
    this.build = build
    this.createDiagnostic = createDiagnostic
    this.build = build
  }

  public prepare() {
    const script = createScript<Pick<BuildInCheckers, T>>({
      absFilename: this.absFilePath,
      buildBin: this.build.buildBin,
      serverChecker: { createDiagnostic: this.createDiagnostic },
    })!

    this.script = script
    return script
  }

  public initMainThread() {
    invariant(
      this.script,
      `script should be created in 'prepare', but got ${this.script}`,
    )

    if (isMainThread || isInVitestEntryThread) {
      const createServeAndBuild = this.script.mainScript()
      return createServeAndBuild
    }

    return
  }

  public initWorkerThread() {
    invariant(
      this.script,
      `script should be created in 'prepare', but got ${this.script}`,
    )

    if (!(isMainThread || isInVitestEntryThread)) {
      this.script.workerScript()
    }
  }
}
