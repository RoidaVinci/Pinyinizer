#!/usr/bin/env bash
# Syntax-check every first-party JS file (vendored code excluded).
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
while IFS= read -r f; do
  if ! node --check "$f" 2>/tmp/ct-check-err; then
    echo "SYNTAX ERROR: $f"
    cat /tmp/ct-check-err
    fail=1
  fi
done < <(find src tests -name '*.js' -not -path 'src/vendor/*')

if [ "$fail" -eq 0 ]; then
  echo "All files parse OK."
fi
exit "$fail"
