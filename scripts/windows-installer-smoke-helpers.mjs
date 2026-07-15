import path from 'node:path'
import { assertReleaseVersion, windowsInstallerArtifactName } from './release-version-contract.mjs'

export function installerForVersion(version, architecture = 'x64', repositoryRoot = process.cwd()) {
  assertReleaseVersion(version)
  if (architecture !== 'x64') throw new Error(`Unsupported Windows installer architecture: ${architecture}`)
  const tauriArchitecture = 'x64'
  return path.join(
    repositoryRoot,
    'src-tauri',
    'target',
    'release',
    'bundle',
    'nsis',
    windowsInstallerArtifactName(version, tauriArchitecture),
  )
}

export function installationLayout(installRoot) {
  const root = path.resolve(installRoot)
  const ocrRoot = path.join(root, 'ocr')
  return {
    root,
    executable: path.join(root, 'kakeflow.exe'),
    uninstaller: path.join(root, 'uninstall.exe'),
    ocrRoot,
    resources: [
      // Tauri's Windows resource directory is the application directory.
      // The configured map targets are therefore installed beside the binary.
      path.join(root, 'fonts', 'OFL.txt'),
      path.join(root, 'fonts', 'SOURCE.md'),
      path.join(ocrRoot, 'manifest.json'),
      path.join(ocrRoot, 'tesseract.exe'),
      path.join(ocrRoot, 'tessdata', 'eng.traineddata'),
      path.join(ocrRoot, 'tessdata', 'jpn.traineddata'),
      path.join(ocrRoot, 'tessdata', 'configs', 'tsv'),
      path.join(ocrRoot, 'notices', 'tesseract-Apache-2.0.txt'),
      path.join(ocrRoot, 'notices', 'THIRD_PARTY_NOTICES.txt'),
    ],
  }
}

export function silentInstallArguments(installRoot) {
  const root = path.resolve(installRoot)
  if (/[\0\r\n]/u.test(root)) throw new Error('Unsafe Windows installation path')
  return ['/S', `/D=${root}`]
}

export function silentUninstallArguments() {
  return ['/S']
}

export function productVersionMatches(actual, expected) {
  const normalized = String(actual).trim()
  return normalized === expected || normalized === `${expected}.0`
}

export function validateWindowsInstallerEvidence(evidence, expectedVersion) {
  const valid = evidence?.status === 'ok'
    && evidence.platform === 'win32'
    && evidence.version === expectedVersion
    && evidence.installScope === 'isolated-current-user'
    && Number.isInteger(evidence.installerBytes) && evidence.installerBytes > 0
    && Number.isInteger(evidence.executableBytes) && evidence.executableBytes > 0
    && evidence.uninstallerPresent === true
    && Array.isArray(evidence.resources) && evidence.resources.length >= 9
    && evidence.resources.every((resource) => typeof resource === 'string' && resource.length > 0)
    && evidence.ocr?.status === 'ok'
    && evidence.ocr.target === 'windows-x64'
    && evidence.ocr.manifestSchemaVersion === 2
    && evidence.ocr.tsvSmoke === true
    && evidence.packagedSmoke?.status === 'ok'
    && Number.isInteger(evidence.packagedSmoke.schemaVersion) && evidence.packagedSmoke.schemaVersion > 0
    && evidence.packagedSmoke.databaseHealthy === true
    && evidence.uninstallCompleted === true
    && evidence.installDirectoryRemoved === true
  if (!valid) throw new Error(`Invalid Windows installer smoke evidence: ${JSON.stringify(evidence)}`)
  return evidence
}
