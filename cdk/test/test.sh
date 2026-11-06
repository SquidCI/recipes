# test/bin/cdk logs its arguments, and synth and list answer with one stack; test/bin/aws answers the account and region.
tmp=$(mktemp -d)
export SQUIDCI_PUBLISHED="$tmp/published"

# Map fields are associative arrays, which a job's bash has and macOS's own 3.2 has not.
if [ "${BASH_VERSINFO[0]}" -ge 4 ]; then
  eval 'declare -A squidci_input_context=([env]=dev); declare -A squidci_input_parameters=([Size]=2)'
  squidci_input_stacks=(web-dev api-dev)
  expect "$(cd "$tmp" && step command=deploy rollback=false args='--require-approval never' 2>&1)" \
    "cdk deploy --no-notices -c env=dev web-dev api-dev --parameters Size=2 --no-rollback --require-approval never"
  unset squidci_input_context squidci_input_parameters squidci_input_stacks squidci_input_rollback squidci_input_args
fi
squidci_input_stacks=(web-dev api-dev)
expect "$(cd "$tmp" && step command=deploy rollback=false args='--require-approval never' 2>&1)" \
  "cdk deploy --no-notices web-dev api-dev --no-rollback --require-approval never"
unset squidci_input_stacks squidci_input_rollback squidci_input_args

expect "$(cd "$tmp" && step command=deploy 2>&1)" "cdk deploy --no-notices --all"
expect "$(cd "$tmp" && step command=diff app='npx ts-node bin/app.ts' 2>&1)" "cdk diff --no-notices --app npx ts-node bin/app.ts"
expect "$(cd "$tmp" && step command=deploy profile=prod 2>&1 | head -1)" "squidci: as profile prod"

published=$(cd "$tmp" && step command=publish 2>&1)
contains() { printf '%s\n' "$1" | grep -qF -- "$2" || { printf 'expected a line:\n%s\nin:\n%s\n' "$2" "$1" >&2; return 1; }; }
contains "$published" "cdk synth --quiet --no-notices --output /tmp/squidci-cdk.out"
contains "$published" "cdk --app /tmp/squidci-cdk.out --no-notices --unstable=publish-assets publish-assets --all"
contains "$published" "squidci: recorded web-dev as published"
expect "$(cat "$SQUIDCI_PUBLISHED")" '{"kind":"cdk-stack","name":"111111111111/eu-west-1/web-dev","payload":{"id":"web","stackName":"web-dev","account":"111111111111","region":"eu-west-1","templateUrl":"s3://b/web.json","parameters":{},"tags":{},"terminationProtection":false,"dependencies":[]}}'

# The app's own CLI, installed from here up, wins over the one on the PATH.
mkdir -p "$tmp/node_modules/.bin" "$tmp/app"
printf '#!/usr/bin/env bash\necho "own cdk $*" >&2\n' > "$tmp/node_modules/.bin/cdk"
chmod +x "$tmp/node_modules/.bin/cdk"
expect "$(cd "$tmp/app" && step command=deploy 2>&1)" "own cdk deploy --no-notices --all"
rm -r "$tmp"

