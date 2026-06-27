import { vitestGlobalSetup, vitestGlobalTeardown } from './fixtures.js'

export async function setup(): Promise<() => Promise<void>> {
  await vitestGlobalSetup()

  return async () => {
    await vitestGlobalTeardown()
  }
}
