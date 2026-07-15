const DESCRIPTOR_FIELDS = ['channel', 'endpoint', 'publicKey', 'reason', 'schemaVersion', 'status']
const SUPPORTED_ENDPOINT_VARIABLES = ['{{target}}', '{{arch}}', '{{current_version}}']
const UPDATER_NPM_PACKAGE = '@tauri-apps/plugin-updater'
const DISABLED_REASON = 'PRODUCTION_SIGNING_KEY_AND_ENDPOINT_NOT_CONFIGURED'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record ?? {}, key)
}

function cargoHasUpdater(cargoToml) {
  return /^(?:tauri-plugin-updater|"tauri-plugin-updater"|'tauri-plugin-updater')\s*=\s*/mu.test(cargoToml)
}

function npmHasUpdater(packageJson) {
  return hasOwn(packageJson?.dependencies, UPDATER_NPM_PACKAGE)
    || hasOwn(packageJson?.devDependencies, UPDATER_NPM_PACKAGE)
    || hasOwn(packageJson?.optionalDependencies, UPDATER_NPM_PACKAGE)
}

function capabilityPermissions(capabilities) {
  return capabilities.flatMap((capability) => Array.isArray(capability?.permissions) ? capability.permissions : [])
    .map((permission) => typeof permission === 'string' ? permission : permission?.identifier)
    .filter((permission) => typeof permission === 'string')
}

function updaterPermissions(capabilities) {
  return capabilityPermissions(capabilities).filter((permission) => permission === 'updater:default' || permission.startsWith('updater:'))
}

function assertDescriptorShape(descriptor) {
  assert(descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor), 'Update channel descriptor must be an object')
  assert(descriptor.schemaVersion === 1, 'Unsupported update channel schema')
  assert(JSON.stringify(Object.keys(descriptor).sort()) === JSON.stringify(DESCRIPTOR_FIELDS), 'Update channel descriptor fields differ from schema v1')
  assert(descriptor.channel === 'stable', 'Schema v1 supports only the stable update channel')
}

function validInlinePublicKey(publicKey) {
  if (typeof publicKey !== 'string' || publicKey.trim().length < 64) return false
  const normalized = publicKey.trim()
  if (/(?:TODO|PLACEHOLDER|YOUR[_ -]?PUBLIC[_ -]?KEY|<[^>]+>)/iu.test(normalized)) return false
  if (/^(?:\.{0,2}[\\/]|[A-Za-z]:[\\/])/u.test(normalized) || /\.(?:pub|pem|key)$/iu.test(normalized)) return false
  return !normalized.includes('\0')
}

function validateEndpoint(endpoint) {
  assert(typeof endpoint === 'string' && endpoint.startsWith('https://'), 'Enabled update endpoint must use HTTPS')
  assert(!/[\s\0]/u.test(endpoint), 'Enabled update endpoint contains whitespace or NUL')
  const variables = endpoint.match(/\{\{[^{}]+\}\}/gu) ?? []
  if (variables.length === 0) {
    assert(endpoint.endsWith('/latest.json'), 'Static update endpoint must end with /latest.json')
    return
  }
  assert(variables.every((variable) => SUPPORTED_ENDPOINT_VARIABLES.includes(variable)), `Enabled update endpoint contains an unsupported variable: ${variables.join(', ')}`)
  for (const variable of SUPPORTED_ENDPOINT_VARIABLES) {
    assert(variables.filter((candidate) => candidate === variable).length === 1, `Templated update endpoint must contain ${variable} exactly once`)
  }
  assert(variables.length === SUPPORTED_ENDPOINT_VARIABLES.length, 'Templated update endpoint contains duplicate or unexpected variables')
}

function validateDisabled({ descriptor, tauriConfig, packageJson, cargoToml, capabilities }) {
  assert(descriptor.reason === DISABLED_REASON, 'Disabled update channel reason is missing or unexpected')
  assert(descriptor.endpoint === null && descriptor.publicKey === null, 'Disabled update channel must not contain an endpoint or public key')
  assert(tauriConfig?.bundle?.createUpdaterArtifacts === false, 'Disabled update channel requires createUpdaterArtifacts=false explicitly')
  assert(tauriConfig?.plugins?.updater === undefined, 'Disabled update channel must not configure the Tauri updater plugin')
  assert(!npmHasUpdater(packageJson), 'Disabled update channel must not install the updater JavaScript dependency')
  assert(!cargoHasUpdater(cargoToml), 'Disabled update channel must not install the updater Rust dependency')
  assert(updaterPermissions(capabilities).length === 0, 'Disabled update channel must not grant updater capabilities')
}

function validateEnabled({ descriptor, tauriConfig, packageJson, cargoToml, capabilities }) {
  assert(descriptor.reason === null, 'Enabled update channel must clear its disabled reason')
  validateEndpoint(descriptor.endpoint)
  assert(validInlinePublicKey(descriptor.publicKey), 'Enabled update channel requires a non-placeholder inline public key, not a path')
  assert(tauriConfig?.bundle?.createUpdaterArtifacts === true, 'Enabled update channel requires createUpdaterArtifacts=true')
  assert(npmHasUpdater(packageJson), 'Enabled update channel requires the updater JavaScript dependency')
  assert(cargoHasUpdater(cargoToml), 'Enabled update channel requires the updater Rust dependency')
  assert(updaterPermissions(capabilities).includes('updater:default'), 'Enabled update channel requires updater:default capability')

  const updater = tauriConfig?.plugins?.updater
  assert(updater && typeof updater === 'object', 'Enabled update channel requires Tauri updater plugin configuration')
  assert(updater.pubkey === descriptor.publicKey, 'Tauri updater public key differs from the channel descriptor')
  assert(Array.isArray(updater.endpoints) && updater.endpoints.length === 1 && updater.endpoints[0] === descriptor.endpoint, 'Tauri updater endpoint differs from the channel descriptor')
  assert(updater.dangerousInsecureTransportProtocol !== true, 'Enabled update channel must not allow insecure transport')
}

export function validateUpdateChannelContract(input) {
  const capabilities = input.capabilities ?? []
  assert(Array.isArray(capabilities), 'Tauri capabilities must be an array')
  assertDescriptorShape(input.descriptor)
  if (input.descriptor.status === 'DISABLED_UNCONFIGURED') {
    validateDisabled({ ...input, capabilities })
  } else if (input.descriptor.status === 'ENABLED') {
    validateEnabled({ ...input, capabilities })
  } else {
    throw new Error(`Unsupported update channel status: ${input.descriptor.status}`)
  }
  return { channel: input.descriptor.channel, status: input.descriptor.status }
}
