import { EncodedData, InputEncoding } from './types'

function normalizeHex(input: string): string {
  return input.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '')
}

export function parseInputData(
  value: string | Uint8Array,
  encoding: InputEncoding = 'utf8'
): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }

  if (encoding === 'utf8') {
    return Buffer.from(value, 'utf8')
  }

  if (encoding === 'base64') {
    return Buffer.from(value, 'base64')
  }

  const normalized = normalizeHex(value)
  if (normalized.length % 2 !== 0) {
    throw new Error('Hex input must contain an even number of nybbles')
  }

  return Buffer.from(normalized, 'hex')
}

export function encodeData(data: Uint8Array): EncodedData {
  const buffer = Buffer.from(data)
  return {
    byteLength: buffer.length,
    hex: buffer.toString('hex'),
    base64: buffer.toString('base64'),
    utf8: buffer.toString('utf8'),
  }
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const combined = new Uint8Array(total)
  let offset = 0

  for (const part of parts) {
    combined.set(part, offset)
    offset += part.length
  }

  return combined
}
