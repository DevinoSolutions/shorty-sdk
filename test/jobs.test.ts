import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'

import { APITimeoutError, JobFailedError } from '../src/core/errors'
import { Shorty } from '../src/index'
import { MockShortyServer } from './mockShortyServer'

const server = new MockShortyServer()
let baseUrl: string

before(async () => {
    baseUrl = await server.start()
})
after(async () => {
    await server.close()
})
beforeEach(() => {
    server.requests.length = 0
})

function client() {
    return new Shorty({ apiKey: 'shk_test_jobs', baseUrl })
}

test('jobs.get returns the nested camelCase shape', async () => {
    server.setHandler(() => ({
        status: 200,
        body: {
            jobId: 'j1',
            status: 'processing',
            progress: 42,
            step: 'transcribing',
            error: null,
            output: { jobType: 'SUBTITLES', transcriptionId: 't9' },
        },
    }))
    const job = await client().jobs.get('j1')
    assert.equal(job.jobId, 'j1')
    assert.equal(job.status, 'processing')
    assert.equal(job.progress, 42)
    assert.equal(job.step, 'transcribing')
    assert.equal(job.output?.transcriptionId, 't9')
})

test('waitFor succeeds after N polls', async () => {
    const statuses = ['queued', 'processing', 'processing', 'success']
    server.setHandler((_req, i) => ({
        status: 200,
        body: {
            jobId: 'j1',
            status: statuses[Math.min(i, statuses.length - 1)],
            output: { articleId: 'a1' },
        },
    }))
    const final = await client().jobs.waitFor('j1', { pollIntervalMs: 10 })
    assert.equal(final.status, 'success')
    assert.equal(final.output?.articleId, 'a1')
    assert.equal(server.requests.length, 4)
})

test('waitFor throws JobFailedError on an ERROR job (carries the error)', async () => {
    server.setHandler(() => ({
        status: 200,
        body: { jobId: 'j1', status: 'error', error: 'ffmpeg exploded' },
    }))
    await assert.rejects(
        () => client().jobs.waitFor('j1', { pollIntervalMs: 10 }),
        (err: unknown) => {
            assert.ok(err instanceof JobFailedError)
            assert.equal(err.jobId, 'j1')
            assert.equal(err.status, 'error')
            assert.equal(err.jobError, 'ffmpeg exploded')
            return true
        },
    )
})

test('waitFor throws JobFailedError on a CANCELLED job', async () => {
    server.setHandler(() => ({
        status: 200,
        body: { jobId: 'j1', status: 'cancelled', error: null },
    }))
    await assert.rejects(
        () => client().jobs.waitFor('j1', { pollIntervalMs: 10 }),
        JobFailedError,
    )
})

test('waitFor throws APITimeoutError when the deadline elapses', async () => {
    server.setHandler(() => ({
        status: 200,
        body: { jobId: 'j1', status: 'processing' },
    }))
    await assert.rejects(
        () =>
            client().jobs.waitFor('j1', {
                pollIntervalMs: 20,
                timeoutMs: 60,
            }),
        APITimeoutError,
    )
})
