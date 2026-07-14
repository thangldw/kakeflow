import { createRelayServer } from './server.mjs'

function tokenMappings(raw) {
  const value = JSON.parse(raw)
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('KAKEFLOW_RELAY_TOKENS_JSON must be a JSON object')
  return new Map(Object.entries(value))
}

const server = await createRelayServer({
  dataDirectory: process.env.KAKEFLOW_RELAY_DATA_DIR ?? './relay-data',
  tokens: tokenMappings(process.env.KAKEFLOW_RELAY_TOKENS_JSON ?? ''),
})
const host = process.env.KAKEFLOW_RELAY_HOST ?? '127.0.0.1'
const port = Number(process.env.KAKEFLOW_RELAY_PORT ?? '8787')
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('KAKEFLOW_RELAY_PORT is invalid')
server.listen(port, host, () => process.stdout.write(`KakeFlow relay listening on http://${host}:${port}\n`))
