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
