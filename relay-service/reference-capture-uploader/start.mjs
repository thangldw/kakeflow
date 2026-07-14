import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/uploader.mjs', ['uploader.mjs', 'text/javascript; charset=utf-8']],
  ['/capsule.mjs', ['capsule.mjs', 'text/javascript; charset=utf-8']],
  ['/capture-queue.mjs', ['capture-queue.mjs', 'text/javascript; charset=utf-8']],
  ['/capture-queue-store.mjs', ['capture-queue-store.mjs', 'text/javascript; charset=utf-8']],
])
const host = '127.0.0.1'
const port = Number(process.env.KAKEFLOW_CAPTURE_UPLOADER_PORT ?? '8790')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('KAKEFLOW_CAPTURE_UPLOADER_PORT is invalid')

createServer(async (request, response) => {
  const route = files.get(new URL(request.url ?? '/', 'http://localhost').pathname)
  if (!route || request.method !== 'GET') { response.writeHead(404).end(); return }
  try {
    const bytes = await readFile(join(root, route[0]))
    response.writeHead(200, { 'content-type': route[1], 'content-length': bytes.length, 'cache-control': 'no-store' })
    response.end(bytes)
  } catch { response.writeHead(500).end() }
}).listen(port, host, () => process.stdout.write(`KakeFlow reference capture uploader: http://${host}:${port}\n`))
