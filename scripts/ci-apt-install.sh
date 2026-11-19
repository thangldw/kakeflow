#!/usr/bin/env bash
# Install apt packages on a CI runner, tolerating transient Ubuntu mirror outages
# (503s, unreachable IPv6, "Could not wait for server fd"). Usage: ci-apt-install.sh pkg...
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 package..." >&2
  exit 2
fi

opts=(-o Acquire::Retries=5 -o Acquire::ForceIPv4=true -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
attempts=4
delay=15

for attempt in $(seq 1 "$attempts"); do
  if sudo apt-get "${opts[@]}" update \
    && sudo apt-get "${opts[@]}" install --no-install-recommends -y --fix-missing "$@"; then
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "apt attempt $attempt/$attempts failed; retrying in ${delay}s" >&2
    sleep "$delay"
    delay=$((delay * 2))
  fi
done

echo "apt install failed after $attempts attempts" >&2
exit 1
