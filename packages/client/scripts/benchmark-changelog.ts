/*
 * Licensed under the Apache License, Version 2.0.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import {
  openChangeLogFile,
  writeChangeLogFileAtomic,
} from '../src/changeLog/node/index'

const entryCount = Number.parseInt(
  process.env.OMEGA_EDIT_BENCHMARK_ENTRIES ?? '1000000',
  10
)
const maxRssGrowthBytes = Number.parseInt(
  process.env.OMEGA_EDIT_BENCHMARK_MAX_RSS_GROWTH_BYTES ??
    String(256 * 1024 * 1024),
  10
)
if (
  !Number.isSafeInteger(entryCount) ||
  entryCount < 1 ||
  entryCount > 1_000_000
) {
  throw new Error(
    'OMEGA_EDIT_BENCHMARK_ENTRIES must be an integer from 1 through 1000000'
  )
}
if (!Number.isSafeInteger(maxRssGrowthBytes) || maxRssGrowthBytes < 1) {
  throw new Error(
    'OMEGA_EDIT_BENCHMARK_MAX_RSS_GROWTH_BYTES must be a positive integer'
  )
}

async function main(): Promise<void> {
  const artifactDirectory = path.resolve('artifacts/checkpoint-timeline')
  await fs.mkdir(artifactDirectory, { recursive: true })
  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'omega-edit-codec-benchmark-')
  )
  const outputPath = path.join(temporaryDirectory, 'million-entry.json')
  const fingerprint = {
    byteLength: '1',
    digest: { algorithm: 'sha256', value: '0'.repeat(64) },
  }
  const baselineRss = process.memoryUsage.rss()
  let peakRss = baselineRss
  const started = performance.now()

  try {
    const written = await writeChangeLogFileAtomic(
      outputPath,
      {
        format: 'omega-edit.change-log',
        version: 2,
        complete: true,
        before: fingerprint,
        after: fingerprint,
        changeCount: String(entryCount),
        sourceChangeCount: String(entryCount),
        unavailableChangeCount: '0',
        unavailableChangeSerials: [],
      },
      async (sink) => {
        for (let index = 0; index < entryCount; index += 1) {
          await sink.writeEntry({
            serial: String(index + 1),
            kind: 'OVERWRITE',
            offset: '0',
            length: '1',
            data: '00',
          })
          if (index % 10_000 === 0)
            peakRss = Math.max(peakRss, process.memoryUsage.rss())
        }
      },
      { limits: { maxEntryCount: entryCount } }
    )

    const opened = await openChangeLogFile(outputPath, {
      limits: { maxEntryCount: entryCount },
    })
    let readCount = 0
    for await (const _entry of opened.entries()) {
      readCount += 1
      if (readCount % 10_000 === 0)
        peakRss = Math.max(peakRss, process.memoryUsage.rss())
    }
    if (readCount !== entryCount)
      throw new Error(`Read ${readCount} entries, expected ${entryCount}`)

    const report = {
      scenario: 'streaming-change-log-codec',
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      entries: entryCount,
      encodedBytes: written.byteLength,
      durationMilliseconds: Math.round(performance.now() - started),
      baselineRssBytes: baselineRss,
      peakRssBytes: peakRss,
      rssGrowthBytes: peakRss - baselineRss,
      maxRssGrowthBytes,
    }
    if (report.rssGrowthBytes > maxRssGrowthBytes) {
      throw new Error(
        `Streaming codec RSS grew by ${report.rssGrowthBytes} bytes`
      )
    }
    await fs.writeFile(
      path.join(artifactDirectory, 'codec-benchmark.json'),
      `${JSON.stringify(report, null, 2)}\n`
    )
    console.log(JSON.stringify(report))
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
