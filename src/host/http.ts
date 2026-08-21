/**
 * 宿主 HTTP 辅助：请求体读取 / JSON 响应 / API 凭据解析。
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { MAX_REQUEST_BODY_BYTES } from './config.js'

function readBody(req: any, maxBytes: number): Promise<Buffer> {
    return new Promise((resolveBody, reject) => {
        const chunks: Buffer[] = []
        let total = 0
        let aborted = false
        req.on('data', (chunk: Buffer) => {
            total += chunk.length
            if (total > maxBytes) {
                aborted = true
                req.destroy()
                reject(new Error('request body too large'))
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => {
            if (aborted) return
            try {
                resolveBody(Buffer.concat(chunks))
            } catch (error) {
                reject(error)
            }
        })
        req.on('error', reject)
    })
}

function writeJson(res: any, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
}

async function readJsonBody(req: any, maxBytes: number = MAX_REQUEST_BODY_BYTES): Promise<Record<string, any>> {
    const buf = await readBody(req, maxBytes)
    try {
        return buf.length === 0 ? {} : JSON.parse(buf.toString('utf8'))
    } catch {
        throw new Error('请求体不是有效 JSON')
    }
}

/** 通过凭据服务解析 API Key（解析不到返回空串，由调用方决定是否报错）。 */
async function resolveApiKey(ctx: any, credential: string): Promise<string> {
    try {
        const ref = credentialRef(String(credential || '').trim())
        const resolved = await ctx.credentials.resolve(ref)
        const key = resolved?.key
        return typeof key === 'string' ? key : ''
    } catch {
        return ''
    }
}

export { readBody, writeJson, readJsonBody, resolveApiKey }
