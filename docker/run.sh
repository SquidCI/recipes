# One docker step: build image:tag and push it, or build it and stage it for a later section to push.
squidci_docker_image=$squidci_input_image
squidci_docker_tag=$squidci_input_tag
squidci_docker_push=${squidci_input_push:-true}
squidci_docker_skip=${squidci_input_skip_existing:-false}

if ! [[ "$squidci_docker_tag" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$ ]]; then
  echo "squidci: the tag is '$squidci_docker_tag' once expanded, which is not a tag" >&2
  return 1
fi
if [ "$squidci_docker_skip" = true ] && [ "$squidci_docker_push" = false ]; then
  echo 'squidci: skip-existing looks for what a push would make, so it cannot be set with push: false' >&2
  return 1
fi
if [ -n "${squidci_input_from+x}" ] && { [ "$squidci_docker_push" = false ] || [ -n "${squidci_input_build+x}" ] || [ -n "${squidci_input_context+x}" ] || [ -n "${squidci_input_file+x}" ] || [ -n "${squidci_input_args+x}" ] || [ -n "${squidci_input_secrets+x}" ]; }; then
  echo 'squidci: from: build pushes the image a build staged, so it cannot be set with push: false, build, context, file, args or secrets' >&2
  return 1
fi
if [ -n "${squidci_input_build+x}" ] && { [ -n "${squidci_input_context+x}" ] || [ -n "${squidci_input_file+x}" ] || [ -n "${squidci_input_args+x}" ] || [ -n "${squidci_input_secrets+x}" ]; }; then
  echo 'squidci: build runs a command in place of a Dockerfile, so it cannot be set with context, file, args or secrets' >&2
  return 1
fi

squidci_docker_ref="$squidci_docker_image:$squidci_docker_tag"

# What a Dockerfile build is handed: its file, arguments and secrets, and its context.
squidci_docker_options=()
if [ -z "${squidci_input_build+x}" ]; then
  [ -n "${squidci_input_file+x}" ] && squidci_docker_options+=(--file "$squidci_input_file")
  if [ -n "${squidci_input_args+x}" ]; then
    for squidci_docker_name in "${!squidci_input_args[@]}"; do
      squidci_docker_options+=(--build-arg "$squidci_docker_name=${squidci_input_args[$squidci_docker_name]}")
    done
  fi
  for squidci_docker_name in "${squidci_input_secrets[@]}"; do
    # A pull request's job gets no secrets, so passes none.
    [ -n "$SQUIDCI_SECRETS" ] || break
    if [ ! -f "$SQUIDCI_SECRETS/$squidci_docker_name" ]; then
      echo "squidci: the docker step's secret $squidci_docker_name is not imported: add it to the top-level secrets" >&2
      return 1
    fi
    squidci_docker_options+=(--secret "id=$squidci_docker_name,src=$SQUIDCI_SECRETS/$squidci_docker_name")
  done
fi
squidci_docker_context=${squidci_input_context:-.}

# The tag's current image is the cache, and latest's too for a new tag.
squidci_docker_cache=(--cache-from "type=registry,ref=$squidci_docker_ref")
[ "$squidci_docker_tag" = latest ] || squidci_docker_cache+=(--cache-from "type=registry,ref=$squidci_docker_image:latest")

# Builds image:tag into the daemon: the command, told what to make, or the Dockerfile.
squidci_docker_build() {
  if [ -n "${squidci_input_build+x}" ]; then
    ( export SQUIDCI_IMAGE="$squidci_docker_ref"; eval "$squidci_input_build" )
    if ! docker image inspect "$squidci_docker_ref" >/dev/null 2>&1; then
      echo "squidci: the build command left no $squidci_docker_ref in the daemon: it must build the image \$SQUIDCI_IMAGE names" >&2
      return 1
    fi
  elif docker buildx version >/dev/null 2>&1; then
    docker buildx build --provenance=false "${squidci_docker_cache[@]}" --cache-to type=inline "${squidci_docker_options[@]}" --tag "$squidci_docker_ref" "$squidci_docker_context"
  else
    BUILDX_NO_DEFAULT_ATTESTATIONS=1 docker build "${squidci_docker_options[@]}" --tag "$squidci_docker_ref" "$squidci_docker_context"
  fi
}

# Pushes what the daemon holds, exporting the digest the push reports.
squidci_docker_push_built() {
  local digest
  if ! docker push "$squidci_docker_ref" | tee /tmp/squidci-docker-push.log; then
    [ "$squidci_docker_skip" = true ] && squidci_docker_pushed_meanwhile "$squidci_docker_image" "$squidci_docker_tag" && return
    return 1
  fi
  digest=$(grep -o 'digest: sha256:[0-9a-f]*' /tmp/squidci-docker-push.log | tail -n 1 | sed 's/digest: //')
  if [ -z "$digest" ]; then
    echo 'squidci: the push reported no digest for what it pushed' >&2
    return 1
  fi
  squidci_docker_export "$squidci_docker_image" "$squidci_docker_tag" "$digest"
}

if [ "$squidci_docker_push" = false ]; then
  squidci_docker_build
  # In a build of a run that has staging, staged and recorded for a later section to push.
  if [ -n "$SQUIDCI_RECORDS" ] && [ -n "$SQUIDCI_STAGING_REPOSITORY" ]; then
    squidci_docker_stage "$squidci_docker_ref"
  fi
else
  squidci_docker_login "$squidci_docker_image"
  if [ "$squidci_docker_skip" = true ] && squidci_docker_existing "$squidci_docker_image" "$squidci_docker_tag"; then
    :
  elif [ -n "${squidci_input_from+x}" ]; then
    # The image a build of this component, or of one it needs, staged and recorded: never built here.
    squidci_docker_staged_as=$(squidci_docker_staged "$squidci_docker_ref")
    if [ -z "$squidci_docker_staged_as" ]; then
      echo "squidci: no build recorded staging $squidci_docker_ref: from: build needs a docker step with push: false and this image:tag in a build of this component, or of one it needs, on a run that is not a pull request's" >&2
      return 1
    fi
    squidci_docker_copy "$squidci_docker_staged_as" "$squidci_docker_image" "$squidci_docker_tag" "$([ "$squidci_docker_skip" = true ] && echo skip-existing)"
  elif [ -z "${squidci_input_build+x}" ] && docker buildx version >/dev/null 2>&1; then
    # The build is the push.
    squidci_docker_metadata=$(mktemp)
    if docker buildx build --provenance=false "${squidci_docker_cache[@]}" --cache-to type=inline "${squidci_docker_options[@]}" \
      --tag "$squidci_docker_ref" --push --metadata-file "$squidci_docker_metadata" "$squidci_docker_context"; then
      squidci_docker_digest=$(squidci_docker_field "$(cat "$squidci_docker_metadata")" containerimage.digest)
      if [ -z "$squidci_docker_digest" ]; then
        echo 'squidci: the build reported no digest for what it pushed' >&2
        return 1
      fi
      squidci_docker_export "$squidci_docker_image" "$squidci_docker_tag" "$squidci_docker_digest"
    elif ! { [ "$squidci_docker_skip" = true ] && squidci_docker_pushed_meanwhile "$squidci_docker_image" "$squidci_docker_tag"; }; then
      return 1
    fi
    rm -f "$squidci_docker_metadata"
  else
    squidci_docker_build
    squidci_docker_push_built
  fi
fi

unset squidci_docker_image squidci_docker_tag squidci_docker_push squidci_docker_skip squidci_docker_ref squidci_docker_options \
  squidci_docker_name squidci_docker_context squidci_docker_cache squidci_docker_staged_as squidci_docker_metadata squidci_docker_digest
