# test/bin/docker logs each call and answers as a daemon and registry would; test/bin/aws gives a password.
. "$SQUIDCI_RECIPE_DIR/lib.sh"
tmp=$(mktemp -d)

# contains "$(step …)" "a line it must print"
contains() {
  if ! printf '%s\n' "$1" | grep -qF -- "$2"; then
    printf 'expected a line:\n%s\nin:\n%s\n' "$2" "$1" >&2
    return 1
  fi
}

expect "$(setup 2>&1)" ""

# A build stages what it built and records it.
export SQUIDCI_STAGING_REPOSITORY=123456789012.dkr.ecr.eu-west-1.amazonaws.com/squidci-abc-staging SQUIDCI_STAGING_PREFIX=run1-
export SQUIDCI_RECORDS_DIR="$tmp/records" SQUIDCI_RECORDS="$tmp/records/web.jsonl" SQUIDCI_OUTPUT="$tmp/output" SQUIDCI_PUBLISHED="$tmp/published"
# Nothing restored: the build's own records directory is not there yet.
built=$(step image=public.ecr.aws/x/web tag=abc push=false 2>&1)
contains "$built" "docker buildx build --provenance=false --cache-from type=registry,ref=public.ecr.aws/x/web:abc --cache-from type=registry,ref=public.ecr.aws/x/web:latest --cache-to type=inline --tag public.ecr.aws/x/web:abc ."
contains "$built" "squidci: staged public.ecr.aws/x/web:abc as $SQUIDCI_STAGING_REPOSITORY@sha256:aaaa"
expect "$(cat "$SQUIDCI_RECORDS")" "{\"kind\":\"docker-image\",\"name\":\"public.ecr.aws/x/web:abc\",\"staged\":\"$SQUIDCI_STAGING_REPOSITORY@sha256:aaaa\"}"

# A later push from: build copies it, even where jq has to be installed first; one without builds, whatever was staged.
unset SQUIDCI_RECORDS
noisy=$(squidci_docker_jq() { echo "Setting up jq"; }; squidci_docker_staged public.ecr.aws/x/web:abc 2>/dev/null)
expect "$noisy" "$SQUIDCI_STAGING_REPOSITORY@sha256:aaaa"
copied=$(step image=public.ecr.aws/x/web tag=abc from=build 2>&1)
contains "$copied" "docker buildx imagetools create --prefer-index=false --tag public.ecr.aws/x/web:abc $SQUIDCI_STAGING_REPOSITORY@sha256:aaaa"
contains "$copied" "squidci: pushed public.ecr.aws/x/web@sha256:aaaa (amd64, application/vnd.oci.image.manifest.v1+json, 1234 bytes)"
expect "$(cat "$SQUIDCI_OUTPUT")" "$(printf 'digest=sha256:aaaa\nmediaType=application/vnd.oci.image.manifest.v1+json\nsize=1234\narchitecture=amd64')"
contains "$(cat "$SQUIDCI_PUBLISHED")" '{"kind":"docker-image","name":"public.ecr.aws/x/web:abc","payload":{"image":"public.ecr.aws/x/web","tag":"abc","digest":"sha256:aaaa"'
rebuilt=$(step image=public.ecr.aws/x/web tag=abc 2>&1)
contains "$rebuilt" "--tag public.ecr.aws/x/web:abc --push --metadata-file"
contains "$rebuilt" "squidci: pushed public.ecr.aws/x/web@sha256:bbbb"
if printf '%s' "$rebuilt" | grep -q "imagetools create"; then echo "copied without from: build" >&2; exit 1; fi

# from: build with nothing recorded fails rather than build.
expect "$(step image=public.ecr.aws/x/api tag=abc from=build 2>&1 || echo "exit $?")" "$(printf "squidci: no build recorded staging public.ecr.aws/x/api:abc: from: build needs a docker step with push: false and this image:tag in a build of this component, or of one it needs, on a run that is not a pull request's\nexit 1")"

# skip-existing finds it there, and builds nothing.
found=$(DOCKER_EXISTING=1 step image=public.ecr.aws/x/api tag=abc skip-existing=true 2>&1)
contains "$found" "squidci: public.ecr.aws/x/api:abc is already there, so it is neither built nor pushed"
if printf '%s' "$found" | grep -q "buildx build"; then echo "built what was there" >&2; exit 1; fi

# A build command's image, pushed from the daemon.
command=$(step image=public.ecr.aws/x/app tag=abc build='echo "making $SQUIDCI_IMAGE"' 2>&1)
contains "$command" "making public.ecr.aws/x/app:abc"
contains "$command" "squidci: pushed public.ecr.aws/x/app@sha256:aaaa"

# Refused when it runs.
expect "$(step image=x/web tag='' 2>&1 || echo "exit $?")" "$(printf "squidci: the tag is '' once expanded, which is not a tag\nexit 1")"
expect "$(step image=x/web tag=a push=false skip-existing=true 2>&1 || echo "exit $?")" "$(printf 'squidci: skip-existing looks for what a push would make, so it cannot be set with push: false\nexit 1')"
expect "$(step image=x/web tag=a from=build push=false 2>&1 || echo "exit $?")" "$(printf 'squidci: from: build pushes the image a build staged, so it cannot be set with push: false, build, context, file, args or secrets\nexit 1')"
expect "$(step image=x/web tag=a build=make file=Dockerfile 2>&1 || echo "exit $?")" "$(printf 'squidci: build runs a command in place of a Dockerfile, so it cannot be set with context, file, args or secrets\nexit 1')"
rm -r "$tmp"
