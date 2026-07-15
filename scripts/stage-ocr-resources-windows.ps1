$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$VcpkgCommit = 'b5229343b4b80264ed51e89c6a7dcd0cbe85e9cc'
$TesseractVersion = '5.5.2'
$TessdataVersion = '4.1.0'
$Triplet = 'x64-windows-static-kakeflow'
$CacheRoot = if ($env:KAKEFLOW_OCR_BUILD_CACHE) { $env:KAKEFLOW_OCR_BUILD_CACHE } else { Join-Path $env:LOCALAPPDATA 'KakeFlow\ocr-build' }
$VcpkgRoot = Join-Path $CacheRoot 'vcpkg'
$InstallRoot = Join-Path $CacheRoot 'installed'
$StageRoot = Join-Path $Root 'src-tauri\generated-resources\ocr'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
  throw 'Packaged OCR staging supports only native x64 Windows. Run it on the Windows release host.'
}

foreach ($Command in @('git', 'node')) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "Missing required command: $Command" }
}

New-Item -ItemType Directory -Force -Path $CacheRoot | Out-Null
if (-not (Test-Path (Join-Path $VcpkgRoot '.git'))) {
  & git clone --filter=blob:none --no-checkout https://github.com/microsoft/vcpkg.git $VcpkgRoot
  if ($LASTEXITCODE -ne 0) { throw 'Unable to clone the pinned vcpkg source.' }
}
& git -C $VcpkgRoot fetch --depth 1 origin $VcpkgCommit
if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch the pinned vcpkg commit.' }
& git -C $VcpkgRoot checkout --detach --force $VcpkgCommit
if ($LASTEXITCODE -ne 0) { throw 'Unable to check out the pinned vcpkg commit.' }
& git -C $VcpkgRoot clean -ffd
if ($LASTEXITCODE -ne 0) { throw 'Unable to clean the pinned vcpkg worktree.' }
& (Join-Path $VcpkgRoot 'bootstrap-vcpkg.bat') -disableMetrics
if ($LASTEXITCODE -ne 0) { throw 'Unable to bootstrap vcpkg.' }

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallRoot
& (Join-Path $VcpkgRoot 'vcpkg.exe') install `
  "--x-manifest-root=$Root\packaging\ocr" `
  "--x-install-root=$InstallRoot" `
  "--overlay-triplets=$Root\packaging\ocr\triplets" `
  "--triplet=$Triplet" `
  --clean-after-build `
  --disable-metrics
if ($LASTEXITCODE -ne 0) { throw 'The pinned static Tesseract build failed.' }

$Tesseract = Join-Path $InstallRoot "$Triplet\tools\tesseract\tesseract.exe"
if (-not (Test-Path -PathType Leaf $Tesseract)) { throw "vcpkg did not produce $Tesseract" }

function Receive-CheckedFile([string]$Url, [string]$Destination, [string]$ExpectedSha256) {
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
  $Actual = (Get-FileHash -Algorithm SHA256 -Path $Destination).Hash.ToLowerInvariant()
  if ($Actual -ne $ExpectedSha256) { throw "Checksum mismatch for $Url`: expected $ExpectedSha256, got $Actual" }
}

if (Test-Path $StageRoot) {
  Get-ChildItem -Force $StageRoot | Where-Object Name -ne '.gitkeep' | Remove-Item -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $StageRoot 'tessdata\configs'), (Join-Path $StageRoot 'notices') | Out-Null
Copy-Item $Tesseract (Join-Path $StageRoot 'tesseract.exe')
Receive-CheckedFile `
  "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/$TessdataVersion/eng.traineddata" `
  (Join-Path $StageRoot 'tessdata\eng.traineddata') `
  '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2'
Receive-CheckedFile `
  "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/$TessdataVersion/jpn.traineddata" `
  (Join-Path $StageRoot 'tessdata\jpn.traineddata') `
  '1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d'
Receive-CheckedFile `
  "https://raw.githubusercontent.com/tesseract-ocr/tesseract/$TesseractVersion/tessdata/configs/tsv" `
  (Join-Path $StageRoot 'tessdata\configs\tsv') `
  '59d079bb75d8b3d7c839a3564580cb559e362c93a9d70f234e421c0c3e767e04'
Receive-CheckedFile `
  "https://raw.githubusercontent.com/tesseract-ocr/tesseract/$TesseractVersion/LICENSE" `
  (Join-Path $StageRoot 'notices\tesseract-Apache-2.0.txt') `
  'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'

$Notice = [System.Text.StringBuilder]::new()
[void]$Notice.AppendLine('KakeFlow packaged OCR third-party notices')
[void]$Notice.AppendLine()
[void]$Notice.AppendLine("Tesseract $TesseractVersion and tessdata_fast $TessdataVersion`: Apache License 2.0")
[void]$Notice.AppendLine('Dependency notices below are copied from the pinned vcpkg installation.')
[void]$Notice.AppendLine()
Get-ChildItem -Path (Join-Path $InstallRoot "$Triplet\share") -Filter copyright -File -Recurse | Sort-Object FullName | ForEach-Object {
  [void]$Notice.AppendLine("===== $($_.Directory.Name) =====")
  [void]$Notice.AppendLine((Get-Content -Raw -Path $_.FullName))
  [void]$Notice.AppendLine()
}
[IO.File]::WriteAllText((Join-Path $StageRoot 'notices\THIRD_PARTY_NOTICES.txt'), $Notice.ToString(), [Text.UTF8Encoding]::new($false))

& node (Join-Path $Root 'scripts\write-ocr-resource-manifest.mjs') $StageRoot 'windows-x64'
if ($LASTEXITCODE -ne 0) { throw 'Unable to write the OCR resource manifest.' }
$env:KAKEFLOW_OCR_TARGET = 'windows-x64'
& node (Join-Path $Root 'scripts\verify-ocr-resources.mjs')
if ($LASTEXITCODE -ne 0) { throw 'The staged Windows OCR runtime failed verification.' }
Write-Host "Packaged Windows OCR resources staged at $StageRoot"
