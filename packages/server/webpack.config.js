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

const path = require('path')
const unzip = require('unzip-stream')
const CopyPlugin = require('copy-webpack-plugin')
const fs = require('fs')

const pkg_version = JSON.parse(
  fs.readFileSync(path.resolve(path.join(__dirname, 'package.json'))).toString()
)['version']
const serverPackage = `omega-edit-grpc-server-${pkg_version}`
const zipFilePath = path.resolve(
  `../../server/scala/serv/target/universal/${serverPackage}.zip`
)

module.exports = {
  entry: './src/index.ts',
  devtool: 'source-map',
  target: 'node',
  output: {
    path: path.resolve(__dirname, 'out'),
    filename: 'index.js',
    libraryTarget: 'commonjs2',
    clean: true, // makes sure the output directory is remade
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules|test|omega-edit-grpc-server/,
        use: {
          loader: 'ts-loader',
        },
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: ['README.md'],
    }),
    {
      // unzip server package file
      apply: (compiler) => {
        compiler.hooks.done.tap('unzipServerPackageFile', async () => {
          await new Promise(async (resolve, reject) => {
            fs.createReadStream(zipFilePath)
              .pipe(unzip.Extract({ path: 'out' }))
              .on('close', async () => {
                try {
                  resolve(zipFilePath)
                } catch (err) {
                  reject(err)
                }
              })
          })

          // Move bin and lib folders out of omega-edit-grpc-server-${version} folder
          ;['bin', 'lib'].forEach((dir) => {
            fs.renameSync(`out/${serverPackage}/${dir}`, `out/${dir}`)
          })

          // Remove omega-edit-grpc-server-${version} folder
          fs.rmSync(`out/${serverPackage}`, {
            recursive: true,
            force: true,
          })
        })
      },
    },
  ],
}
