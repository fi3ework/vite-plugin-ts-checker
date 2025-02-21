import fs from 'node:fs'
import { createRequire } from 'node:module'
import type { SharedConfig } from '../types'
const _require = createRequire(import.meta.url)

export const RUNTIME_CLIENT_RUNTIME_PATH = '/@vite-plugin-checker-runtime'
export const RUNTIME_CLIENT_ENTRY_PATH = '/@vite-plugin-checker-runtime-entry'

export const wrapVirtualPrefix = (id: `/${string}`): `virtual:${string}` =>
  `virtual:${id.slice('/'.length)}`
export const composePreambleCode = ({
  baseWithOrigin = '/',
  overlayConfig,
}: {
  baseWithOrigin: string
  overlayConfig: SharedConfig['overlay']
}) => `
import { inject } from "${baseWithOrigin}${RUNTIME_CLIENT_RUNTIME_PATH.slice(1)}";
inject({
  overlayConfig: ${JSON.stringify(overlayConfig)},
  base: "${baseWithOrigin}",
});
`

// #region
// NOTE: sync modification with packages/runtime/src/ws.js
export const WS_CHECKER_ERROR_EVENT = 'vite-plugin-checker:error'
export const WS_CHECKER_RECONNECT_EVENT = 'vite-plugin-checker:reconnect'
// #endregion

export const runtimeSourceFilePath = _require.resolve('../@runtime/main.js')
export const runtimeCode = `${fs.readFileSync(runtimeSourceFilePath, 'utf-8')};`
