// ============================================================================
// TEST FAKE — NOT part of the shipped SDK. This is a local `node:http` stand-in
// for the Shorty /v1 surface, used ONLY by the unit tests. It exists so retry,
// pagination, and timeout behavior is exercised against a REAL socket/transport
// (not just an injected fetch stub) — the P3 lesson: fetch-fake-only tests hid
// two production transport bugs. Nothing here mirrors production auth or logic;
// handlers are scripted per-test.
// ============================================================================

import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface MockRequest {
    method: string
    /** Pathname only (no query string). */
    path: string
    /** Parsed query parameters (last value wins). */
    query: Record<string, string>
    /** Lowercased request headers. */
    headers: Record<string, string>
    /** The raw request body string exactly as received. */
    rawBody: string
    /** JSON-parsed body, or undefined if empty / not JSON. */
    body: unknown
}

export interface MockResponse {
    status: number
    /** Object -> JSON-serialized; string -> sent verbatim (for non-JSON bodies). */
    body?: unknown
    headers?: Record<string, string>
    /** Delay before responding, in ms (to exercise timeouts). */
    delayMs?: number
}

export type MockHandler = (
    req: MockRequest,
    callIndex: number,
) => MockResponse | Promise<MockResponse>

export class MockShortyServer {
    private server: Server | undefined
    /** Every request the server has received, in order. */
    readonly requests: MockRequest[] = []
    private handler: MockHandler = () => ({ status: 404 })
    private callIndex = 0

    /** Replace the request handler (per-test scripting). Resets the call index
     * so `callIndex` is relative to THIS handler (attempt 0, 1, ...). */
    setHandler(handler: MockHandler): void {
        this.handler = handler
        this.callIndex = 0
    }

    /** Boot on an ephemeral port; returns the base URL. */
    async start(): Promise<string> {
        this.server = createServer((req, res) => {
            void this.handle(req, res)
        })
        await new Promise<void>(resolve => {
            this.server!.listen(0, '127.0.0.1', resolve)
        })
        const { port } = this.server!.address() as AddressInfo
        return `http://127.0.0.1:${port}`
    }

    async close(): Promise<void> {
        if (!this.server) return
        await new Promise<void>((resolve, reject) => {
            this.server!.close(err => (err ? reject(err) : resolve()))
        })
        this.server = undefined
    }

    private async handle(
        req: IncomingMessage,
        res: import('node:http').ServerResponse,
    ): Promise<void> {
        const rawBody = await readBody(req)
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const query: Record<string, string> = {}
        url.searchParams.forEach((value, key) => {
            query[key] = value
        })
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers[key.toLowerCase()] = value
            else if (Array.isArray(value))
                headers[key.toLowerCase()] = value[0] ?? ''
        }
        let body: unknown
        try {
            body = rawBody === '' ? undefined : JSON.parse(rawBody)
        } catch {
            body = undefined
        }

        const mockReq: MockRequest = {
            method: req.method ?? 'GET',
            path: url.pathname,
            query,
            headers,
            rawBody,
            body,
        }
        this.requests.push(mockReq)

        let result: MockResponse
        try {
            result = await this.handler(mockReq, this.callIndex)
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end(`mock handler threw: ${String(err)}`)
            return
        } finally {
            this.callIndex += 1
        }

        if (result.delayMs && result.delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, result.delayMs))
        }

        const outHeaders: Record<string, string> = { ...result.headers }
        let payload: string
        if (result.body === undefined) {
            payload = ''
        } else if (typeof result.body === 'string') {
            payload = result.body
            if (!outHeaders['Content-Type'] && !outHeaders['content-type']) {
                outHeaders['Content-Type'] = 'text/plain'
            }
        } else {
            payload = JSON.stringify(result.body)
            if (!outHeaders['Content-Type'] && !outHeaders['content-type']) {
                outHeaders['Content-Type'] = 'application/json'
            }
        }
        res.writeHead(result.status, outHeaders)
        res.end(payload)
    }
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', chunk => chunks.push(chunk as Buffer))
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
    })
}
