import pino from 'pino'

export function overrideProperty(
  target: Record<string, any>,
  key: string,
  value: unknown
): () => void {
  const original = target[key]
  target[key] = value
  return () => {
    target[key] = original
  }
}

export async function withPlatform(
  platform: NodeJS.Platform,
  run: () => Promise<void>
): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  if (!descriptor || !descriptor.configurable) {
    throw new Error('process.platform cannot be overridden in this runtime')
  }

  const overrideDescriptor: PropertyDescriptor = {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    value: platform,
  }
  if ('writable' in descriptor) {
    overrideDescriptor.writable = descriptor.writable
  }

  Object.defineProperty(process, 'platform', {
    ...overrideDescriptor,
  })

  try {
    await run()
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
}

export function makeObjectIdResponse(id: string) {
  return {
    getId() {
      return id
    },
    toObject() {
      return { id }
    },
  }
}

export function expectErrorMessage(
  expect: Chai.ExpectStatic,
  err: unknown,
  message: string
) {
  expect(err).to.be.instanceOf(Error)
  expect((err as Error).message).to.equal(message)
}

export function silenceClientLogger(requireFn: NodeRequire): () => void {
  const loggerModule = requireFn(
    '../../dist/cjs/logger.js'
  ) as typeof import('../../src/logger')
  const originalLogger = loggerModule.getLogger()
  loggerModule.setLogger(
    pino(
      {
        level: 'silent',
      },
      pino.destination(2)
    )
  )
  return () => {
    loggerModule.setLogger(originalLogger)
  }
}
