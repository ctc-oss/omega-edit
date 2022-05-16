import {expect} from 'chai'
import {getVersion} from '../src/version'

describe('Client', () => {
    describe('Version', () => {
        it('Should return version v0.9.3', () => {
            const result = getVersion()
            expect(result).to.equal('v0.9.3')
        })
    })
})
