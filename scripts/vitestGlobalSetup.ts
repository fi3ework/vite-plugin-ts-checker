import { rmSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

const tempRuntimePath = path.resolve(
  __dirname,
  '../packages/vite-plugin-checker/src/@runtime',
)

export async function setup(): Promise<void> {
  await fs.rm(tempRuntimePath, { force: true, recursive: true })
  await fs.mkdir(tempRuntimePath, { recursive: true })
  await fs.cp(
    path.resolve(__dirname, '../packages/vite-plugin-checker/dist/@runtime'),
    tempRuntimePath,
    {
      recursive: true,
      dereference: false,
    },
  )
}

export async function teardown(): Promise<void> {
  rmSync(tempRuntimePath, { force: true, recursive: true })
}
