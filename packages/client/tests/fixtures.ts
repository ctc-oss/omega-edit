/*
 * Copyright (c) 2021 Concurrent Technologies Corporation.
 *
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  createSimpleFileLogger,
  getLogger,
  pidIsRunning,
  setLogger,
  startServer,
  stopProcessUsingPID,
  stopServiceOnPort,
} from '@omega-edit/client'
import * as fs from 'fs'
import { initChai, testHost, testPort } from './specs/common'

const path = require('path')
const rootPath = path.resolve(__dirname, '..')

/**
 * Gets the pid file for the given port
 * @param rootPath root path to use
 * @param port port to get the pid file for
 * @returns path to the pid file
 */
function getPidFile(rootPath: string, port: number): string {
  return path.join(rootPath, `.test-server-${port}.pid`)
}

/**
 * Mocha test fixture to set up the logger and start the server
 * @remarks used by mocha
 */
export async function mochaGlobalSetup(): Promise<number | undefined> {
  await initChai()
  const pidFile = getPidFile(rootPath, testPort)
  const logFile = path.join(rootPath, 'client-tests.log')
  const level = process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL || 'info'
  const logger = createSimpleFileLogger(logFile, level)

  logger.info({
    fn: 'mochaGlobalSetup',
    msg: 'logger built',
    level: level,
    logfile: logFile,
  })
  setLogger(logger)
  getLogger().debug({
    fn: 'mochaGlobalSetup',
    msg: 'starting server',
    port: testPort,
    pidfile: pidFile,
  })

  await mochaGlobalTeardown()

  const pid = await startServer(
    testPort,
    testHost,
    pidFile,
    path.join(rootPath, 'logconf.xml')
  )

  if (pid) {
    getLogger().debug({
      fn: 'mochaGlobalSetup',
      msg: 'server started',
      port: testPort,
      pid: pid,
      pidfile: pidFile,
    })
  } else {
    getLogger().error({
      fn: 'mochaGlobalSetup',
      msg: 'failed to start server',
      port: testPort,
      pidfile: pidFile,
    })
  }
  return pid
}

/**
 * Mocha test fixture to stop the server
 * @remarks used by mocha
 */
export async function mochaGlobalTeardown(): Promise<boolean> {
  const pidFile = getPidFile(rootPath, testPort)
  const logMetadata = {
    fn: 'mochaGlobalTeardown',
    port: testPort,
    pidFile,
  }
  getLogger().debug(logMetadata)

  // if the pid file exists, stop the server
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').toString())
    if (pidIsRunning(pid)) {
      getLogger().debug({
        ...logMetadata,
        msg: 'stopping server',
        pid,
      })

      // stop the server via the PID
      if (await stopProcessUsingPID(pid)) {
        getLogger().info({
          ...logMetadata,
          msg: 'server stopped via pid',
          pid,
          stopped: true,
        })
      } else {
        // if that fails, log an error and return false
        getLogger().error({
          ...logMetadata,
          msg: 'failed to stop server',
          pid,
          stopped: false,
        })
        if (await stopProcessUsingPID(pid, 'SIGKILL')) {
          getLogger().info({
            ...logMetadata,
            msg: 'server stopped via pid with SIGKILL',
            pid,
            stopped: true,
          })
        } else {
          getLogger().error({
            ...logMetadata,
            msg: 'failed to stop server with SIGKILL',
            pid,
            stopped: false,
          })
          return false
        }
      }
    } else {
      getLogger().debug({
        fn: 'mochaGlobalTeardown',
        msg: 'stale pid file found',
        port: testPort,
      })
    }
    try {
      fs.unlinkSync(pidFile)
    } catch (err) {
      if (err instanceof Error) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          getLogger().error({
            ...logMetadata,
            msg: 'failed to delete pid file',
            err: {
              name: err.name,
              msg: err.message,
              stack: err.stack,
              code: (err as NodeJS.ErrnoException).code,
            },
          })
          return false
        }
      } else {
        getLogger().error({
          ...logMetadata,
          msg: 'failed to delete pid file',
          err: {
            msg: String(err),
          },
        })
        return false
      }
    }
  } else {
    getLogger().debug({
      fn: 'mochaGlobalTeardown',
      msg: 'no pid file found',
      port: testPort,
      pidfile: pidFile,
    })
    // PID file doesn't exist, but make sure the port is clear
    await stopServiceOnPort(testPort)
  }

  // if the pid file doesn't exist, return true
  return true
}
