#!/usr/bin/env bash
# Runs every recipe's tests, and checks the index lists every folder that has a recipe.yaml.
set -eo pipefail
cd "$(dirname "$0")/.."

failed=0

for descriptor in */recipe.yaml; do
  recipe=${descriptor%%/*}
  if ! grep -Eq "^  $recipe: \{folder: $recipe\}$" index.yaml; then
    echo "FAIL $recipe: not in index.yaml"
    failed=1
  fi
done

for test in */test/test.sh; do
  recipe=${test%%/*}
  if output=$(bash test/harness.sh "$recipe" 2>&1); then
    echo "ok   $recipe"
  else
    echo "FAIL $recipe"
    printf '%s\n' "$output" | sed 's/^/     /'
    failed=1
  fi
done

exit $failed
