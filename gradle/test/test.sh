# A project whose gradlew echoes where it ran, its arguments and what the split handed it.
. "$SQUIDCI_RECIPE_DIR/lib.sh"
tmp=$(mktemp -d)
mkdir -p "$tmp/services/api"
cat > "$tmp/services/gradlew" <<'GRADLEW'
#!/bin/sh
echo "gradlew in $(basename "$PWD"): $*"
[ -z "${SQUIDCI_SPLIT_PLAN:-}" ] || echo "plan: $SQUIDCI_SPLIT_PLAN"
[ -z "${SQUIDCI_SPLIT_SHARD:-}" ] || echo "shard: $SQUIDCI_SPLIT_SHARD"
GRADLEW
chmod +x "$tmp/services/gradlew"

expect "$(cd "$tmp/services/api" && step run='check -Pci="a b"' dir=.. 2>&1)" "gradlew in services: --console=plain check -Pci=a b"
expect "$(cd "$tmp/services" && step run=build 2>&1)" "gradlew in services: --console=plain build"
expect "$(cd "$tmp/services" && squidci_gradle_tests='--init-script /squidci/reporters/init.gradle' step run=test dir=. 2>&1)" "gradlew in services: --console=plain --init-script /squidci/reporters/init.gradle test"
expect "$(cd "$tmp/services" && SQUIDCI_SPLIT_ROLE=planner SQUIDCI_SPLIT_PLAN=/split/manifest.ndjson step run=check dir=. 2>&1)" "$(printf 'gradlew in services: --console=plain --init-script %s/init.gradle check\nplan: /split/manifest.ndjson' "$SQUIDCI_RECIPE_DIR")"
expect "$(cd "$tmp/services" && SQUIDCI_SPLIT_ROLE=shard SQUIDCI_SPLIT_SHARD=/split/units.ndjson SQUIDCI_SPLIT_GROUPS=':api:test :core:test' step run=check dir=. 2>&1)" "$(printf 'gradlew in services: --console=plain --init-script %s/init.gradle --continue --no-configuration-cache :api:test :core:test\nshard: /split/units.ndjson' "$SQUIDCI_RECIPE_DIR")"
expect "$(cd "$tmp" && step run=build dir=. 2>&1 || echo "exit $?")" "$(printf 'squidci: there is no gradlew in %s: a gradle step runs the project'"'"'s wrapper, so commit it (gradle wrapper), or set the step'"'"'s dir to where it is\nexit 1' "$tmp")"
rm -r "$tmp"
