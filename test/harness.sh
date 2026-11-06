#!/usr/bin/env bash
# Runs one recipe's test/test.sh with what a job gives a recipe: squidci_step,
# squidci_require, SQUIDCI_RECIPE_DIR, and <recipe>/test/bin first on the PATH.
# Usage: bash test/harness.sh <recipe>
set -eo pipefail

recipe=$1
root=$(pwd)
export SQUIDCI_RECIPE_DIR="$root/$recipe"
export PATH="$root/$recipe/test/bin:$PATH"

squidci_step() {
  printf '\n$ %s\n' "$1"
}

squidci_require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "squidci: the image has no $1, which a $2 step needs" >&2
    return 1
  fi
}

# Sources setup.sh, as the job does once.
setup() {
  . "$SQUIDCI_RECIPE_DIR/setup.sh"
}

# Sets the fields given as field=value and sources run.sh.
step() {
  local pair name
  for pair in "$@"; do
    name=${pair%%=*}
    printf -v "squidci_input_${name//-/_}" '%s' "${pair#*=}"
  done
  . "$SQUIDCI_RECIPE_DIR/run.sh"
}

# expect "$(step …)" "what it must print"
expect() {
  if [ "$1" != "$2" ]; then
    printf 'expected:\n%s\ngot:\n%s\n' "$2" "$1" >&2
    return 1
  fi
}

. "$root/$recipe/test/test.sh"
