# One cdk step: the CLI from the app's directory, or publish, which synthesises, publishes the stacks' assets and records them.
squidci_cdk_version=2.1142.0
squidci_cdk() {
  if command -v cdk >/dev/null; then
    cdk "$@"
  else
    npx --yes "aws-cdk@$squidci_cdk_version" "$@"
  fi
}

cd "${squidci_input_dir:-.}"
[ -n "${squidci_input_profile+x}" ] && export AWS_PROFILE="$squidci_input_profile" && echo "squidci: as profile $squidci_input_profile"

# The app's dependencies, through the pnpm recipe's setup, when a pnpm lockfile is found from here up.
squidci_cdk_up=$PWD
while [ "$squidci_cdk_up" != / ] && [ ! -f "$squidci_cdk_up/pnpm-lock.yaml" ]; do squidci_cdk_up=$(dirname "$squidci_cdk_up"); done
if [ -f "$squidci_cdk_up/pnpm-lock.yaml" ] && [ -f "$SQUIDCI_RECIPE_DIR/../pnpm/setup.sh" ]; then
  . "$SQUIDCI_RECIPE_DIR/../pnpm/setup.sh"
fi

# Docker, for image assets and bundling, through the docker recipe's setup.
if ! docker info >/dev/null 2>&1 && [ -f "$SQUIDCI_RECIPE_DIR/../docker/setup.sh" ]; then
  . "$SQUIDCI_RECIPE_DIR/../docker/lib.sh"
  . "$SQUIDCI_RECIPE_DIR/../docker/setup.sh"
fi

squidci_cdk_options=()
[ -n "${squidci_input_app+x}" ] && squidci_cdk_options+=(--app "$squidci_input_app")
if [ -n "${squidci_input_context+x}" ]; then
  for squidci_cdk_key in "${!squidci_input_context[@]}"; do
    squidci_cdk_options+=(-c "$squidci_cdk_key=${squidci_input_context[$squidci_cdk_key]}")
  done
fi
squidci_cdk_stacks=("${squidci_input_stacks[@]}")
squidci_cdk_selected=("${squidci_cdk_stacks[@]}")
[ "${#squidci_cdk_selected[@]}" -gt 0 ] || squidci_cdk_selected=(--all)
squidci_cdk_extra=()
[ -n "${squidci_input_args+x}" ] && eval "squidci_cdk_extra=($squidci_input_args)"

if [ "$squidci_input_command" = publish ]; then
  rm -rf /tmp/squidci-cdk.out
  squidci_cdk synth --quiet --no-notices "${squidci_cdk_options[@]}" "${squidci_cdk_stacks[@]}" --output /tmp/squidci-cdk.out >/dev/null
  squidci_cdk --app /tmp/squidci-cdk.out --no-notices --unstable=publish-assets publish-assets "${squidci_cdk_selected[@]}"
  squidci_cdk --app /tmp/squidci-cdk.out --no-notices list --long --json "${squidci_cdk_stacks[@]}" > /tmp/squidci-cdk-stacks.json
  command -v aws >/dev/null || { . "$SQUIDCI_RECIPE_DIR/../docker/lib.sh" && squidci_docker_aws; }
  node "$SQUIDCI_RECIPE_DIR/records.mjs" /tmp/squidci-cdk.out /tmp/squidci-cdk-stacks.json \
    "$(aws sts get-caller-identity --query Account --output text)" "${AWS_REGION:-$(aws configure get region)}"
else
  case "$squidci_input_command" in
    deploy|destroy) squidci_cdk_targets=("${squidci_cdk_selected[@]}") ;;
    *) squidci_cdk_targets=("${squidci_cdk_stacks[@]}") ;;
  esac
  squidci_cdk_more=()
  if [ "$squidci_input_command" = deploy ]; then
    if [ -n "${squidci_input_parameters+x}" ]; then
      for squidci_cdk_key in "${!squidci_input_parameters[@]}"; do
        squidci_cdk_more+=(--parameters "$squidci_cdk_key=${squidci_input_parameters[$squidci_cdk_key]}")
      done
    fi
    [ "${squidci_input_rollback:-true}" = false ] && squidci_cdk_more+=(--no-rollback)
  fi
  squidci_cdk "$squidci_input_command" --no-notices "${squidci_cdk_options[@]}" "${squidci_cdk_targets[@]}" "${squidci_cdk_more[@]}" "${squidci_cdk_extra[@]}"
fi
