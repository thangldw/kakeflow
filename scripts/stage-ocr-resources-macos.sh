#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VCPKG_COMMIT="b5229343b4b80264ed51e89c6a7dcd0cbe85e9cc"
TESSERACT_VERSION="5.5.2"
TESSDATA_VERSION="4.1.0"
TRIPLET="arm64-osx-kakeflow"
NEUTRAL_TEMP_ROOT="${TMPDIR:-/tmp}"
CACHE_ROOT="${KAKEFLOW_OCR_BUILD_CACHE:-${NEUTRAL_TEMP_ROOT%/}/kakeflow-ocr-build-${TRIPLET}}"
CACHE_ROOT="$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "${CACHE_ROOT}")"
PORTABLE_CACHE_ROOT="${CACHE_ROOT//\\//}"
PORTABLE_HOME="${HOME//\\//}"
case "${PORTABLE_CACHE_ROOT}/" in
  "${PORTABLE_HOME}/"*|/Users/*|[A-Za-z]:/Users/*)
    echo "KAKEFLOW_OCR_BUILD_CACHE must use a neutral non-personal build root." >&2
    exit 1
    ;;
esac
VCPKG_ROOT="${CACHE_ROOT}/vcpkg"
INSTALL_ROOT="${CACHE_ROOT}/installed"
STAGE_ROOT="${ROOT}/src-tauri/generated-resources/ocr"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "Packaged OCR staging currently supports only native arm64 macOS builds." >&2
  echo "A Windows resource must be built and verified on a Windows runner; it is not produced here." >&2
  exit 1
fi

for command in git curl shasum xcrun otool; do
  command -v "${command}" >/dev/null || { echo "Missing required command: ${command}" >&2; exit 1; }
done
xcrun --find clang >/dev/null
mkdir -p "${CACHE_ROOT}"

if [[ ! -d "${VCPKG_ROOT}/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/microsoft/vcpkg.git "${VCPKG_ROOT}"
fi
git -C "${VCPKG_ROOT}" fetch --depth 1 origin "${VCPKG_COMMIT}"
git -C "${VCPKG_ROOT}" checkout --detach --force "${VCPKG_COMMIT}"
git -C "${VCPKG_ROOT}" clean -ffd
"${VCPKG_ROOT}/bootstrap-vcpkg.sh" -disableMetrics

rm -rf "${INSTALL_ROOT}"
"${VCPKG_ROOT}/vcpkg" install \
  --x-manifest-root="${ROOT}/packaging/ocr" \
  --x-install-root="${INSTALL_ROOT}" \
  --overlay-triplets="${ROOT}/packaging/ocr/triplets" \
  --triplet="${TRIPLET}" \
  --binarysource=clear \
  --clean-after-build \
  --disable-metrics

TESSERACT_BIN="${INSTALL_ROOT}/${TRIPLET}/tools/tesseract/tesseract"
if [[ ! -x "${TESSERACT_BIN}" ]]; then
  echo "vcpkg did not produce an executable Tesseract binary at ${TESSERACT_BIN}" >&2
  exit 1
fi

NON_SYSTEM_LINKS="$(otool -L "${TESSERACT_BIN}" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/|@executable_path/|@loader_path/)' || true)"
if [[ -n "${NON_SYSTEM_LINKS}" ]]; then
  echo "Packaged Tesseract has non-system dynamic dependencies:" >&2
  echo "${NON_SYSTEM_LINKS}" >&2
  exit 1
fi

download_checked() {
  local url="$1" destination="$2" expected="$3"
  curl --fail --location --retry 3 --silent --show-error "${url}" --output "${destination}"
  local actual
  actual="$(shasum -a 256 "${destination}" | awk '{print $1}')"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Checksum mismatch for ${url}: expected ${expected}, got ${actual}" >&2
    exit 1
  fi
}

find "${STAGE_ROOT}" -mindepth 1 ! -name .gitkeep -delete
mkdir -p "${STAGE_ROOT}/tessdata/configs" "${STAGE_ROOT}/notices"
install -m 755 "${TESSERACT_BIN}" "${STAGE_ROOT}/tesseract"
download_checked \
  "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${TESSDATA_VERSION}/eng.traineddata" \
  "${STAGE_ROOT}/tessdata/eng.traineddata" \
  "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"
download_checked \
  "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${TESSDATA_VERSION}/jpn.traineddata" \
  "${STAGE_ROOT}/tessdata/jpn.traineddata" \
  "1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d"
download_checked \
  "https://raw.githubusercontent.com/tesseract-ocr/tesseract/${TESSERACT_VERSION}/tessdata/configs/tsv" \
  "${STAGE_ROOT}/tessdata/configs/tsv" \
  "59d079bb75d8b3d7c839a3564580cb559e362c93a9d70f234e421c0c3e767e04"
download_checked \
  "https://raw.githubusercontent.com/tesseract-ocr/tesseract/${TESSERACT_VERSION}/LICENSE" \
  "${STAGE_ROOT}/notices/tesseract-Apache-2.0.txt" \
  "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"

{
  echo "KakeFlow packaged OCR third-party notices"
  echo
  echo "Tesseract ${TESSERACT_VERSION} and tessdata_fast ${TESSDATA_VERSION}: Apache License 2.0"
  echo "Dependency notices below are copied from the pinned vcpkg installation."
  echo
  while IFS= read -r notice; do
    package="$(basename "$(dirname "${notice}")")"
    echo "===== ${package} ====="
    cat "${notice}"
    echo
  done < <(find "${INSTALL_ROOT}/${TRIPLET}/share" -mindepth 2 -maxdepth 2 -name copyright -type f | LC_ALL=C sort)
} > "${STAGE_ROOT}/notices/THIRD_PARTY_NOTICES.txt"

node "${ROOT}/scripts/write-ocr-resource-manifest.mjs" \
  "${STAGE_ROOT}" "macos-arm64"
KAKEFLOW_OCR_TARGET="macos-arm64" node "${ROOT}/scripts/verify-ocr-resources.mjs"
echo "Packaged OCR resources staged at ${STAGE_ROOT}"
