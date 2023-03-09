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

import { createSimpleFileLogger, getLogger, setLogger } from '../src/logger'
import {
  startServer,
  stopServerImmediate,
  stopServerUsingPID,
} from '../src/server'
import { getClientVersion } from '../src/version'
import { setAutoFixViewportDataLength } from '../src/viewport'
import * as fs from 'fs'

// prettier-ignore
// @ts-ignore
import { testPort } from './specs/common'
import { resetClient } from '../src/client'

const path = require('path')
const rootPath = path.resolve(__dirname, '..')

/**
 * Gets the pid file for the given port
 * @param port port to get the pid file for
 * @returns path to the pid file
 */
function getPidFile(port: number): string {
  return path.join(rootPath, `.test-server-${port}.pid`)
}

/**
 * Mocha test fixture to setup the logger and start the server
 * @remarks used by mocha
 */
export async function mochaGlobalSetup(): Promise<number | undefined> {
  const pidFile = getPidFile(testPort)
  const logFile = path.join(rootPath, 'test.log')
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
    pidfile: getPidFile(testPort),
  })

  // don't fix viewport data length in tests
  setAutoFixViewportDataLength(false)

  await mochaGlobalTeardown()

  const pid = await startServer(rootPath, getClientVersion(), testPort)
  if (pid) {
    fs.writeFileSync(pidFile, pid.toString(), 'utf8')
    getLogger().debug({
      fn: 'mochaGlobalSetup',
      msg: 'server started',
      port: testPort,
      pid: pid,
      pidfile: getPidFile(testPort),
    })
  } else {
    getLogger().error({
      fn: 'mochaGlobalSetup',
      msg: 'failed to start server',
      port: testPort,
      pidfile: getPidFile(testPort),
    })
  }
  return pid
}

/**
 * Mocha test fixture to stop the server
 * @remarks used by mocha
 */
export async function mochaGlobalTeardown(): Promise<boolean> {
  const pidFile = getPidFile(testPort)
  getLogger().debug({
    fn: 'mochaGlobalTeardown',
    msg: 'stopping server',
    port: testPort,
    pidfile: pidFile,
  })

  // if the pid file exists, stop the server
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').toString())

    // first try to stop the server via the api
    if ((await stopServerImmediate()) == 0) {
      fs.unlinkSync(pidFile)

      getLogger().debug({
        fn: 'mochaGlobalTeardown',
        msg: 'server stopped via api',
        port: testPort,
        pid: pid,
        stopped: true,
      })

      return true
    }

    // needed after api stop incase it initialized the client
    resetClient()

    getLogger().warn({
      fn: 'mochaGlobalTeardown',
      msg: 'api stop failed',
    })

    // if that fails, try to stop the server via the pid
    if (await stopServerUsingPID(pid)) {
      fs.unlinkSync(pidFile)

      getLogger().debug({
        fn: 'mochaGlobalTeardown',
        msg: 'server stopped via pid',
        port: testPort,
        pid: pid,
        stopped: true,
      })

      return true
    }

    // if that fails, log an error and return false
    getLogger().debug({
      fn: 'mochaGlobalTeardown',
      msg: 'failed to stop server',
      port: testPort,
      pidfile: pidFile,
      stopped: false,
    })
    return false
  }

  // if the pid file doesn't exist, return true
  return true
}
