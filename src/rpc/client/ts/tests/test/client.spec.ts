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

import {expect} from 'chai'
import {getVersion} from '../src/version'
import {createSession, destroySession, getComputedFileSize, getSegment} from '../src/session'
import {del, ins, ovr} from '../src/change'

describe('Version', () => {
    it('Should return version v0.9.3', async () => {
        const result = await getVersion()
        expect(result).to.equal('v0.9.3')
    })
})

describe('Editing', () => {
    let session_id = ""

    beforeEach('create a new session', async () => {
        session_id = await createSession(undefined, undefined)
        expect(session_id).to.be.a('string').with.length(36)
    })

    afterEach('destroy session', async () => {
        const destroyed_session_id = await destroySession(session_id)
        expect(destroyed_session_id).to.equal(session_id)
    })

    describe('Insert', () => {
        it('Should insert a string', async () => {
            const data = new TextEncoder().encode("abcghijklmnopqrstuvwxyz")
            let change_id = await ins(session_id, 0, data)
            expect(change_id).to.be.a('number').that.equals(1)
            change_id = await ins(session_id, 3, new TextEncoder().encode("def"))
            expect(change_id).to.be.a('number').that.equals(2)
            let file_size = await getComputedFileSize(session_id)
            expect(data.length + 3).equals(file_size)
            let segment = await getSegment(session_id, 0, file_size)
            expect(new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz")).deep.equals(segment)
        })
    })

    describe('Delete', () => {
        it('Should delete some data', async () => {
            const data = new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz")
            let change_id = await ins(session_id, 0, data)
            expect(change_id).to.be.a('number').that.equals(1)
            let segment = await getSegment(session_id, 0, data.length)
            expect(data).deep.equals(segment)
            let file_size = await getComputedFileSize(session_id)
            expect(data.length).equals(file_size)
            let del_change_id = await del(session_id, 13, 10) // deleting: nopqrstuvw (len: 10)
            expect(del_change_id).to.be.a('number').that.equals(change_id + 1)
            file_size = await getComputedFileSize(session_id)
            expect(data.length - 10).equals(file_size)
            segment = await getSegment(session_id, 0, file_size)
            expect(segment).deep.equals(new TextEncoder().encode("abcdefghijklmxyz"))
        })
    })

    describe('Overwrite', () => {
        it('Should overwrite some data', async () => {
            const data = new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz")
            let change_id = await ins(session_id, 0, data)
            expect(change_id).to.be.a('number').that.equals(1)
            let segment = await getSegment(session_id, 0, data.length)
            expect(data).deep.equals(segment)
            let file_size = await getComputedFileSize(session_id)
            expect(data.length).equals(file_size)
            let ovr_change_id = await ovr(session_id, 13, new TextEncoder().encode("NOPQRSTUVW")) // overwriting: nopqrstuvw (len: 10)
            expect(ovr_change_id).to.be.a('number').that.equals(change_id + 1)
            file_size = await getComputedFileSize(session_id)
            expect(data.length).equals(file_size)
            segment = await getSegment(session_id, 0, file_size)
            expect(segment).deep.equals(new TextEncoder().encode("abcdefghijklmNOPQRSTUVWxyz"))
        })
    })
})

