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

/**
 * Logger type
 * @typedef {pino.Logger} Logger
 */
export type Logger = pino.Logger

// internal singleton logger instance
let logger_: Logger

/**
 * Builds a logger
 * @param stream destination stream
 * @param level log level
 * @returns logger
 */
function buildLogger(
  stream: pino.DestinationStream,
  level: string = process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL || 'info'
): Logger {
  const logger = pino(
    {
      level: level,
      formatters: {
        level: (label) => {
          return { level: label.toUpperCase() }
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    stream
  )

  logger.debug({
    fn: 'buildLogger',
    msg: 'logger built',
    level: level,
  })

  return logger
}

/**
 * Creates a file logger
 * @param logFilePath path to log file
 * @param level log level
 * @returns logger
 */
export function createSimpleFileLogger(
  logFilePath: string,
  level: string = process.env.OMEGA_EDIT_CLIENT_LOG_LEVEL || 'info'
): Logger {
  return pino(
    {
      level: level,
      formatters: {
        level: (label) => {
          return { level: label.toUpperCase() }
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    fs.createWriteStream(logFilePath)
  )
}

/**
 * Gets the logger, creating it if necessary
 * @returns logger
 */
export function getLogger(): Logger {
  if (!logger_) {
    setLogger(buildLogger(process.stderr))
    getLogger().debug({ fn: 'getLogger', msg: 'logger initialized' })
  }
  return logger_
}

/**
 * Evaluate debug log payloads only when debug logging is enabled.
 * @param logger logger instance
 * @param payloadFactory creates the debug payload
 */
export function debugLog(
  logger: Logger,
  payloadFactory: () => Record<string, unknown>
) {
  if (logger.isLevelEnabled('debug')) {
    logger.debug(payloadFactory())
  }
}

/**
 * Sets the logger
 * @param logger new logger instance
 */
export function setLogger(logger: Logger) {
  logger_ = logger
  getLogger().debug({ fn: 'setLogger', msg: 'logger set' })
}
