const MAGIC = new TextEncoder().encode('KAKEFLOW_MOBILE_RECEIPT_CAPTURE_V1\n')
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const CAPSULE_SCHEMA = 'MOBILE_RECEIPT_CAPTURE_V1'
const MAX_EDGE = 20_000
const MAX_PIXELS = 80_000_000

function imageDimensions(bytes, mediaType) {
  if (mediaType === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)
      || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new Error('PNG データが壊れています。')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return [view.getUint32(16, false), view.getUint32(20, false)]
  }
  if (mediaType !== 'image/jpeg' || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('JPEG データが壊れています。')
  let offset = 2
  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break
    const code = bytes[offset]; offset += 1
    if (code === 0xd8 || code === 0xd9 || (code >= 0xd0 && code <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) break
    const frame = (code >= 0xc0 && code <= 0xc3) || (code >= 0xc5 && code <= 0xc7)
      || (code >= 0xc9 && code <= 0xcb) || (code >= 0xcd && code <= 0xcf)
    if (frame && length >= 7) return [(bytes[offset + 5] << 8) | bytes[offset + 6], (bytes[offset + 3] << 8) | bytes[offset + 4]]
    offset += length
  }
  throw new Error('JPEG の画像サイズを確認できません。')
}

export async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function normalizedEndpoint(value) {
  const url = new URL(value)
  const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !loopback) throw new Error('HTTPS またはローカル relay を指定してください。')
  return url.toString().replace(/\/$/, '')
}

export async function buildCaptureCapsule({ captureId, householdId, originDeviceId, capturedAt, originalFilename, mediaType, audienceVisibility, audienceMemberId, imageBytes }) {
  if (!['image/jpeg', 'image/png'].includes(mediaType) || imageBytes.byteLength < 1 || imageBytes.byteLength > MAX_IMAGE_BYTES) throw new Error('JPEG/PNG（20 MiB 以下）を選択してください。')
  const [width, height] = imageDimensions(imageBytes, mediaType)
  if (width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE || width * height > MAX_PIXELS) throw new Error('画像サイズが対応範囲を超えています。')
  const manifest = {
    format: 'KAKEFLOW_MOBILE_RECEIPT_CAPTURE', schemaVersion: 1,
    captureId, householdId, originDeviceId, capturedAt, originalFilename, mediaType,
    imageByteSize: imageBytes.byteLength, imageSha256: await sha256(imageBytes),
    audience: { visibility: audienceVisibility, memberId: audienceMemberId },
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  const capsule = new Uint8Array(MAGIC.length + 4 + manifestBytes.length + imageBytes.byteLength)
  capsule.set(MAGIC)
  new DataView(capsule.buffer).setUint32(MAGIC.length, manifestBytes.length, false)
  capsule.set(manifestBytes, MAGIC.length + 4)
  capsule.set(imageBytes, MAGIC.length + 4 + manifestBytes.length)
  return { bytes: capsule, digest: await sha256(capsule), manifest }
}
