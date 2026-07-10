const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  CheckpointTimelineStorageManager,
  TimelineStorageError,
} = require('../out/checkpointTimelineStorage.js')
const { writeChangeLogFileAtomic } = require('@omega-edit/client')

const before = {
  byteLength: '0',
  digest: { algorithm: 'sha256', value: 'a'.repeat(64) },
}
const after = {
  byteLength: '2',
  digest: { algorithm: 'sha256', value: 'b'.repeat(64) },
}

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'omega-edit-timeline-storage-')
  )
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return root
}

function archiveWriter({ optimized = false, payloadBytes = 2 } = {}) {
  return async (outputPath, maxBytes) => {
    const entries = optimized
      ? [
          {
            kind: 'INSERT',
            offset: '0',
            length: '0',
            data: 'ab'.repeat(payloadBytes),
          },
        ]
      : [
          {
            kind: 'INSERT',
            offset: '0',
            length: '0',
            data: 'aa'.repeat(Math.ceil(payloadBytes / 2)),
          },
          {
            kind: 'INSERT',
            offset: '1',
            length: '0',
            data: 'bb'.repeat(Math.floor(payloadBytes / 2)),
          },
        ]
    const result = await writeChangeLogFileAtomic(
      outputPath,
      {
        format: 'omega-edit.change-log',
        version: 2,
        complete: true,
        before,
        after,
        changeCount: String(entries.length),
        sourceChangeCount: '2',
        unavailableChangeCount: '0',
        unavailableChangeSerials: [],
      },
      async (sink) => {
        for (const entry of entries) await sink.writeEntry(entry)
      },
      { maxBytes }
    )
    return { byteLength: result.byteLength }
  }
}

async function sessionFor(t, options = {}) {
  const root = await temporaryRoot(t)
  const manager = new CheckpointTimelineStorageManager(root, options)
  await manager.initialize()
  const session = await manager.createSession(
    'file:///secret/example.bin',
    before,
    'example.bin'
  )
  return { root, manager, session }
}

test('validates production quota settings without an unlimited fallback', async () => {
  assert.throws(
    () =>
      new CheckpointTimelineStorageManager('/tmp/example', {
        limits: { maxBytesPerSession: 1024 },
      }),
    (error) =>
      error instanceof TimelineStorageError &&
      error.code === 'TIMELINE_INVALID_SETTINGS'
  )
  assert.throws(
    () =>
      new CheckpointTimelineStorageManager('/tmp/example', {
        limits: {
          maxBytesPerSession: 2 * 1024 * 1024,
          maxBytesTotal: 1024 * 1024,
        },
      }),
    /maxBytesTotal/
  )
})

test('commits only the smaller verified interval and retains no payload in the manifest', async (t) => {
  const { manager, session } = await sessionFor(t)
  const entry = await session.captureInterval({
    checkpoint: 1,
    expectedGeneration: 1,
    sourceChangeCount: '2',
    before,
    after,
    boundaryKind: 'plain',
    writeRaw: archiveWriter(),
    writeOptimized: archiveWriter({ optimized: true }),
  })
  assert.equal(entry.state, 'ready')
  assert.equal(entry.archive.optimized, true)
  assert.match(entry.archive.file, /^00000001\.json$/)
  const opened = await session.openInterval(1)
  assert.equal(opened.sha256, entry.archive.sha256)
  assert.equal(opened.changeCount, '1')
  const manifestText = await fs.readFile(
    path.join(session.root, 'manifest.json'),
    'utf8'
  )
  assert.equal(manifestText.includes('file:///secret'), false)
  assert.equal(manifestText.includes('"data"'), false)
  assert.equal(session.manifest.tip, 1)
  await session.close()
  await assert.rejects(fs.stat(session.root), { code: 'ENOENT' })
  const index = JSON.parse(
    await fs.readFile(path.join(manager.historyRoot, 'index.json'), 'utf8')
  )
  assert.deepEqual(index.sessions, {})
})

test('optimizer failure falls back to the independently verified raw archive', async (t) => {
  const { session } = await sessionFor(t)
  const entry = await session.captureInterval({
    checkpoint: 1,
    expectedGeneration: 1,
    sourceChangeCount: 2,
    before,
    after,
    boundaryKind: 'transform',
    transformPluginIds: ['z.plugin', 'a.plugin', 'z.plugin'],
    writeRaw: archiveWriter(),
    writeOptimized: async () => {
      throw new Error('optimizer unavailable')
    },
  })
  assert.equal(entry.archive.optimized, false)
  assert.deepEqual(entry.transformPluginIds, ['a.plugin', 'z.plugin'])
  assert.equal((await session.openInterval(1)).changeCount, '2')
})

test('stale generations cannot publish and branch commit removes future archives', async (t) => {
  const { session } = await sessionFor(t)
  await session.captureInterval({
    checkpoint: 1,
    expectedGeneration: 1,
    sourceChangeCount: 2,
    before,
    after,
    boundaryKind: 'plain',
    writeRaw: archiveWriter(),
  })
  await assert.rejects(
    session.captureInterval({
      checkpoint: 2,
      expectedGeneration: 1,
      sourceChangeCount: 2,
      before: after,
      after,
      boundaryKind: 'plain',
      writeRaw: archiveWriter(),
    }),
    (error) => error.code === 'TIMELINE_STALE_GENERATION'
  )
  const removed = await session.truncateFuture(0)
  assert.deepEqual(removed, ['00000001.json'])
  assert.equal(session.manifest.tip, 0)
  await assert.rejects(session.openInterval(1), (error) => {
    assert.equal(error.code, 'TIMELINE_INTERVAL_UNAVAILABLE')
    return true
  })
})

test('saved fingerprints resolve to checkpoints and survive branch truncation as off-branch state', async (t) => {
  const { session } = await sessionFor(t)
  await session.setSavedFingerprint(after)
  assert.equal(session.manifest.saved.checkpoint, undefined)
  assert.equal(session.manifest.saved.offBranch, true)
  await session.captureInterval({
    checkpoint: 1,
    expectedGeneration: 1,
    sourceChangeCount: 2,
    before,
    after,
    boundaryKind: 'plain',
    writeRaw: archiveWriter(),
  })
  assert.deepEqual(session.manifest.saved, {
    fingerprint: after,
    checkpoint: 1,
    offBranch: false,
  })

  await session.truncateFuture(0)
  assert.equal(session.manifest.saved.checkpoint, undefined)
  assert.equal(session.manifest.saved.offBranch, true)
  assert.deepEqual(session.manifest.saved.fingerprint, after)

  await session.setSavedFingerprint(before)
  assert.equal(session.manifest.saved.checkpoint, 0)
  assert.equal(session.manifest.saved.offBranch, false)
})

test('archive corruption and symlink replacement are rejected before replay', async (t) => {
  const { session } = await sessionFor(t)
  const entry = await session.captureInterval({
    checkpoint: 1,
    expectedGeneration: 1,
    sourceChangeCount: 2,
    before,
    after,
    boundaryKind: 'plain',
    writeRaw: archiveWriter(),
  })
  const archive = path.join(session.root, 'intervals', entry.archive.file)
  await fs.appendFile(archive, 'x')
  await assert.rejects(session.openInterval(1), (error) => {
    assert.equal(error.code, 'TIMELINE_ARCHIVE_CHANGED')
    return true
  })

  await fs.rm(archive)
  const outside = path.join(path.dirname(session.root), 'outside.json')
  await fs.writeFile(outside, '{}')
  try {
    await fs.symlink(outside, archive)
    await assert.rejects(session.openInterval(1), (error) => {
      assert.equal(error.code, 'TIMELINE_ARCHIVE_CHANGED')
      return true
    })
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error
  }
})

test('quota overflow leaves the manifest and temporary directory clean', async (t) => {
  const { session } = await sessionFor(t, {
    limits: {
      maxBytesPerSession: 1024 * 1024,
      maxBytesTotal: 1024 * 1024,
    },
  })
  await assert.rejects(
    session.captureInterval({
      checkpoint: 1,
      expectedGeneration: 1,
      sourceChangeCount: 2,
      before,
      after,
      boundaryKind: 'plain',
      writeRaw: archiveWriter({ payloadBytes: 700_000 }),
    }),
    /exceeds/
  )
  assert.equal(session.manifest.tip, 0)
  assert.deepEqual(await fs.readdir(path.join(session.root, 'temp')), [])
  assert.deepEqual(await fs.readdir(path.join(session.root, 'intervals')), [])
})

test('faults at raw and manifest commit boundaries never publish partial intervals', async (t) => {
  const points = [
    'rawFileCreate',
    'rawHeaderWrite',
    'rawEntryWrite',
    'rawFlushClose',
    'rawValidated',
    'winnerRename',
    'loserRemoval',
    'manifestTemporaryWrite',
    'manifestRename',
  ]
  for (const point of points) {
    let armed = false
    const { session } = await sessionFor(t, {
      faultInjector: {
        hit(candidate) {
          if (armed && candidate === point) throw new Error(`fault:${point}`)
        },
      },
    })
    armed = true
    await assert.rejects(
      session.captureInterval({
        checkpoint: 1,
        expectedGeneration: 1,
        sourceChangeCount: 2,
        before,
        after,
        boundaryKind: 'plain',
        writeRaw: archiveWriter(),
      }),
      new RegExp(`fault:${point}`)
    )
    assert.equal(session.manifest.tip, 0, point)
    assert.deepEqual(
      await fs.readdir(path.join(session.root, 'temp')),
      [],
      point
    )
    assert.deepEqual(
      (await fs.readdir(path.join(session.root, 'intervals'))).filter((file) =>
        file.endsWith('.json')
      ),
      [],
      point
    )
  }
})

test('optimizer commit faults deterministically retain the verified raw candidate', async (t) => {
  for (const point of [
    'optimizedFileCreate',
    'optimizedWritten',
    'optimizedValidated',
  ]) {
    let armed = false
    const { session } = await sessionFor(t, {
      faultInjector: {
        hit(candidate) {
          if (armed && candidate === point) throw new Error(`fault:${point}`)
        },
      },
    })
    armed = true
    const entry = await session.captureInterval({
      checkpoint: 1,
      expectedGeneration: 1,
      sourceChangeCount: 2,
      before,
      after,
      boundaryKind: 'plain',
      writeRaw: archiveWriter(),
      writeOptimized: archiveWriter({ optimized: true }),
    })
    assert.equal(entry.archive.optimized, false, point)
    assert.equal((await session.openInterval(1)).changeCount, '2', point)
  }
})

test('quota and every timeline metadata fault point preserve the last committed manifest', async (t) => {
  let armedPoint
  const { session } = await sessionFor(t, {
    faultInjector: {
      hit(point) {
        if (point === armedPoint) throw new Error(`fault:${point}`)
      },
    },
  })
  armedPoint = 'quotaReserved'
  await assert.rejects(
    session.captureInterval({
      checkpoint: 1,
      expectedGeneration: 1,
      sourceChangeCount: 2,
      before,
      after,
      boundaryKind: 'plain',
      writeRaw: archiveWriter(),
    }),
    /fault:quotaReserved/
  )
  assert.equal(session.manifest.tip, 0)

  armedPoint = undefined
  await session.captureInterval({
    checkpoint: 1,
    expectedGeneration: 1,
    sourceChangeCount: 2,
    before,
    after,
    boundaryKind: 'plain',
    writeRaw: archiveWriter(),
  })
  armedPoint = 'branchManifestCommit'
  await assert.rejects(session.truncateFuture(0), /fault:branchManifestCommit/)
  assert.equal(session.manifest.tip, 1)
  assert.equal((await session.openInterval(1)).complete, true)

  armedPoint = 'cursorManifestCommit'
  await assert.rejects(session.setCursor(0), /fault:cursorManifestCommit/)
  assert.equal(session.manifest.cursor, 1)

  armedPoint = 'savedManifestCommit'
  await assert.rejects(
    session.setSavedFingerprint(after),
    /fault:savedManifestCommit/
  )
  assert.equal(session.manifest.saved.checkpoint, 0)
  assert.equal(session.manifest.saved.offBranch, false)

  armedPoint = 'unavailableManifestCommit'
  await assert.rejects(
    session.markIntervalUnavailable(1, 'TEST', 'injected'),
    /fault:unavailableManifestCommit/
  )
  assert.equal(session.manifest.intervals[0].state, 'ready')
  assert.equal((await session.openInterval(1)).complete, true)

  armedPoint = 'heartbeatRefresh'
  await assert.rejects(session.heartbeat(true), /fault:heartbeatRefresh/)
  assert.equal(session.manifest.tip, 1)
})

test('long writers extend persisted reservations at each 16 MiB boundary', async (t) => {
  let reservations = 0
  const { manager, session } = await sessionFor(t, {
    faultInjector: {
      hit(point) {
        if (point === 'quotaReserved') reservations += 1
      },
    },
  })
  const writer = archiveWriter()
  await session.captureInterval({
    checkpoint: 1,
    expectedGeneration: 1,
    sourceChangeCount: 2,
    before,
    after,
    boundaryKind: 'plain',
    writeRaw: async (outputPath, maxBytes, onBytesWritten) => {
      assert.ok(maxBytes > 32 * 1024 * 1024)
      await onBytesWritten(16 * 1024 * 1024 - 1)
      await onBytesWritten(16 * 1024 * 1024 + 1)
      return await writer(outputPath, maxBytes, onBytesWritten)
    },
  })
  assert.ok(reservations >= 3)
  const index = JSON.parse(
    await fs.readFile(path.join(manager.historyRoot, 'index.json'), 'utf8')
  )
  assert.equal(index.sessions[session.sessionKey].reservedBytes, '0')
})

test('stale lock recovery is single-winner and never steals a fresh owner lock', async (t) => {
  const root = await temporaryRoot(t)
  let now = Date.parse('2026-01-01T00:00:00.000Z')
  const manager = new CheckpointTimelineStorageManager(root, {
    now: () => now,
    lockWaitMs: 40,
    sleep: async () => {
      now += 10
    },
  })
  await fs.mkdir(manager.historyRoot, { recursive: true })
  await fs.writeFile(
    path.join(manager.historyRoot, '.lock'),
    JSON.stringify({ token: 'fresh', acquiredAt: new Date(now).toISOString() })
  )
  await assert.rejects(manager.initialize(), (error) => {
    assert.equal(error.code, 'TIMELINE_STORAGE_BUSY')
    return true
  })
  assert.equal(
    JSON.parse(await fs.readFile(path.join(manager.historyRoot, '.lock')))
      .token,
    'fresh'
  )

  now += 2 * 60 * 1000 + 1
  const firstContender = new CheckpointTimelineStorageManager(root, {
    now: () => now,
    lockWaitMs: 1000,
  })
  const [first, second] = await Promise.all([
    firstContender.initialize(),
    new CheckpointTimelineStorageManager(root, {
      now: () => now,
      lockWaitMs: 1000,
    }).initialize(),
  ])
  assert.equal(first.failed + second.failed, 0)
  assert.equal(
    (await fs.readdir(manager.historyRoot)).some((name) =>
      name.startsWith('.stale-lock.')
    ),
    false
  )
})

test('stale locks are recovered and failed clean-close deletion becomes pendingDelete', async (t) => {
  let now = Date.parse('2026-01-01T00:00:00.000Z')
  let failClose = false
  const { manager, session } = await sessionFor(t, {
    now: () => now,
    lockWaitMs: 100,
    sleep: async () => {
      now += 10
    },
    faultInjector: {
      hit(point) {
        if (point === 'cleanCloseDelete' && failClose) {
          throw new Error('delete blocked')
        }
      },
    },
  })
  failClose = true
  await assert.rejects(session.close(), /delete blocked/)
  const indexPath = path.join(manager.historyRoot, 'index.json')
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'))
  assert.equal(index.sessions[session.sessionKey].state, 'pendingDelete')

  now += 8 * 86_400_000
  const recovering = new CheckpointTimelineStorageManager(
    path.dirname(manager.historyRoot),
    { now: () => now }
  )
  const report = await recovering.initialize()
  assert.equal(report.removed, 1)
  await assert.rejects(fs.stat(session.root), { code: 'ENOENT' })
})

test('expired invalid manifests are quarantined without following manifest paths', async (t) => {
  let now = Date.parse('2026-01-01T00:00:00.000Z')
  let blockClose = false
  const { root, session } = await sessionFor(t, {
    now: () => now,
    faultInjector: {
      hit(point) {
        if (point === 'cleanCloseDelete' && blockClose) {
          throw new Error('retain for recovery')
        }
      },
    },
  })
  blockClose = true
  await assert.rejects(session.close(), /retain for recovery/)
  await fs.writeFile(
    path.join(session.root, 'manifest.json'),
    JSON.stringify({ format: 'hostile', archive: '../../user-file' })
  )
  now += 8 * 86_400_000
  const recovering = new CheckpointTimelineStorageManager(root, {
    now: () => now,
  })
  const report = await recovering.initialize()
  assert.equal(report.quarantined, 1)
  assert.equal(report.removed, 0)
  const entries = await fs.readdir(recovering.historyRoot)
  assert.ok(
    entries.some((name) => name.startsWith(`${session.sessionKey}.quarantine.`))
  )
})

test('lock and orphan-cleanup fault injection remains recoverable', async (t) => {
  const root = await temporaryRoot(t)
  let now = Date.parse('2026-01-01T00:00:00.000Z')
  let point = 'lockAcquired'
  const faulted = new CheckpointTimelineStorageManager(root, {
    now: () => now,
    lockWaitMs: 100,
    sleep: async () => {
      now += 10
    },
    faultInjector: {
      hit(candidate) {
        if (candidate === point) throw new Error(`fault:${point}`)
      },
    },
  })
  await assert.rejects(faulted.initialize(), /fault:lockAcquired/)
  await assert.rejects(fs.stat(path.join(faulted.historyRoot, '.lock')), {
    code: 'ENOENT',
  })

  point = 'lockRelease'
  await assert.rejects(faulted.initialize(), /fault:lockRelease/)
  assert.equal(
    (await fs.stat(path.join(faulted.historyRoot, '.lock'))).isFile(),
    true
  )
  point = undefined
  now += 2 * 60 * 1000 + 1
  await faulted.initialize()

  let blockClose = true
  const owner = new CheckpointTimelineStorageManager(root, {
    now: () => now,
    faultInjector: {
      hit(candidate) {
        if (candidate === 'cleanCloseDelete' && blockClose) {
          throw new Error('pending delete')
        }
      },
    },
  })
  await owner.initialize()
  const session = await owner.createSession('file:///orphan.bin', before)
  await assert.rejects(session.close(), /pending delete/)
  blockClose = false
  now += 8 * 86_400_000
  const cleanupFault = new CheckpointTimelineStorageManager(root, {
    now: () => now,
    faultInjector: {
      hit(candidate) {
        if (candidate === 'orphanCleanup') throw new Error('cleanup fault')
      },
    },
  })
  const failed = await cleanupFault.initialize()
  assert.equal(failed.failed, 1)
  assert.equal((await fs.stat(session.root)).isDirectory(), true)
  const recovered = await new CheckpointTimelineStorageManager(root, {
    now: () => now,
  }).initialize()
  assert.equal(recovered.removed, 1)
  await assert.rejects(fs.stat(session.root), { code: 'ENOENT' })
})
