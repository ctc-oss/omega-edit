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

import pino from 'pino'
import * as fs from 'fs'

// internal singleton logger instance
let logger_: pino.Logger

/**
 * Builds a pino logger
 * @param transports array of transports to log to
 * @param level log level
 * @returns pino logger
 */
function buildLogger(
  transports: any[],
  level: string = process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL || 'info'
): pino.Logger {
  const logger = pino({ level: level, transports: transports })
  logger.debug({
    fn: 'buildLogger',
    msg: 'logger built',
    level: level,
    transports: transports,
  })
  return logger
}

/**
 * Creates a pino file logger
 * @param logFilePath path to log file
 * @param level log level
 * @returns pino logger
 */
export function createSimpleFileLogger(
  logFilePath: string,
  level: string = process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL || 'info'
): pino.Logger {
  return pino({ level: level }, fs.createWriteStream(logFilePath))
}

/**
 * Gets the logger, creating it if necessary
 * @returns pino logger
 */
export function getLogger(): pino.Logger {
  if (!logger_) {
    setLogger(
      buildLogger([
        {
          target: 'pino/file',
          options: { destination: 2 }, // use 1 for stdout and 2 for stderr
        },
      ])
    )
    getLogger().debug({ fn: 'getLogger', msg: 'logger initialized' })
  }
  return logger_
}

/**
 * Sets the logger
 * @param logger new logger instance
 */
export function setLogger(logger: pino.Logger) {
  logger_ = logger
  getLogger().info({ fn: 'setLogger', msg: 'logger set' })
}
