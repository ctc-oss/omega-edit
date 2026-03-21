export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_PORT = 9000
export const DEFAULT_PROTOCOL_VERSION = '2025-11-25'
export const TOOLING_VERSION = process.env.npm_package_version || '1.0.1'

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback

  return parsed
}

export const DEFAULT_MAX_READ_BYTES = readPositiveIntegerEnv(
  'OMEGA_EDIT_AI_MAX_READ_BYTES',
  262144
)

export const DEFAULT_MAX_EDIT_BYTES = readPositiveIntegerEnv(
  'OMEGA_EDIT_AI_MAX_EDIT_BYTES',
  262144
)

export const DEFAULT_MAX_SEARCH_RESULTS = readPositiveIntegerEnv(
  'OMEGA_EDIT_AI_MAX_SEARCH_RESULTS',
  1000
)

export const DEFAULT_PREVIEW_CONTEXT_BYTES = readPositiveIntegerEnv(
  'OMEGA_EDIT_AI_PREVIEW_CONTEXT_BYTES',
  64
)
