# Debian or Ubuntu packages, for what a stock image lacks.
squidci_docker_apt() {
  local id
  id=$(. /etc/os-release 2>/dev/null && echo "$ID")
  case "$id" in
    ubuntu|debian) ;;
    *) echo "squidci: a docker step needs $1 in the image, and SquidCI can only install it on Debian or Ubuntu (this image says ID=$id)" >&2; return 1 ;;
  esac
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "${@:2}"
}

# The AWS CLI v2, for ECR logins, installed when the image lacks it.
squidci_docker_aws() {
  command -v aws >/dev/null && return
  echo 'squidci: this image has no aws cli; installing it'
  local arch
  case "$(uname -m)" in
    x86_64) arch=x86_64 ;;
    aarch64|arm64) arch=aarch64 ;;
    *) echo "squidci: no aws cli build for $(uname -m)" >&2; return 1 ;;
  esac
  squidci_docker_apt 'the aws cli' ca-certificates curl unzip
  curl -fsSL --retry 5 --retry-delay 2 "https://awscli.amazonaws.com/awscli-exe-linux-$arch.zip" -o /tmp/squidci-awscli.zip
  unzip -q /tmp/squidci-awscli.zip -d /tmp/squidci-awscli
  /tmp/squidci-awscli/aws/install >/dev/null
  rm -rf /tmp/squidci-awscli /tmp/squidci-awscli.zip
}

# jq, for reading records, installed when the image lacks it.
squidci_docker_jq() {
  command -v jq >/dev/null && return
  echo 'squidci: this image has no jq; installing it'
  squidci_docker_apt jq jq
}

# squidci_docker_login <image>: ECR Public through us-east-1, a private ECR registry through its own region, anything else not at all.
squidci_docker_login() {
  case "$1" in
    public.ecr.aws/*)
      squidci_docker_aws
      aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws ;;
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].dkr.ecr*.amazonaws.com/*|[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].dkr.ecr*.amazonaws.com.cn/*)
      local host=${1%%/*} region
      region=$(printf '%s' "$host" | sed -E 's/^[0-9]{12}\.dkr\.ecr(-fips)?\.([a-z0-9-]+)\.amazonaws\.com(\.cn)?$/\2/')
      squidci_docker_aws
      aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$host" ;;
  esac
}

# The plane's staging repository, logged in to once, with the job's own credentials rather than a target's profile.
squidci_docker_staging_ready=
squidci_docker_staging_login() {
  [ -n "$squidci_docker_staging_ready" ] && return
  local host=${SQUIDCI_STAGING_REPOSITORY%%/*} region
  region=$(printf '%s' "$host" | sed -E 's/^[0-9]{12}\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com$/\1/')
  squidci_docker_aws
  env -u AWS_PROFILE aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$host"
  squidci_docker_staging_ready=1
}

# squidci_docker_field <json> <name>: a string or number field of one line of JSON, without jq.
squidci_docker_field() {
  printf '%s' "$1" | grep -oE "\"$2\": *(\"[^\"]*\"|[0-9]+)" | head -n 1 | sed -E 's/^"[^"]*": *//; s/^"//; s/"$//'
}

# squidci_docker_export <image> <tag> <digest> [architecture] [how]: the digest, media type, size and
# architecture as exports, and the image as published.
squidci_docker_export() {
  local digest="$3" arch="$4" how="${5:-pushed}" descriptor media size
  descriptor=$(docker buildx imagetools inspect "$1@$digest" --format '{{json .Manifest}}')
  media=$(squidci_docker_field "$descriptor" mediaType)
  size=$(squidci_docker_field "$descriptor" size)
  [ -n "$arch" ] || arch=$(docker version --format '{{.Server.Arch}}')
  echo "squidci: $how $1@$digest ($arch, $media, $size bytes)"
  if [ -n "$SQUIDCI_OUTPUT" ]; then
    printf 'digest=%s\nmediaType=%s\nsize=%s\narchitecture=%s\n' "$digest" "$media" "$size" "$arch" >> "$SQUIDCI_OUTPUT"
  fi
  if [ -n "$SQUIDCI_PUBLISHED" ]; then
    printf '{"kind":"docker-image","name":"%s:%s","payload":{"image":"%s","tag":"%s","digest":"%s","mediaType":"%s","size":%s,"architecture":"%s","how":"%s"}}\n' \
      "$1" "$2" "$1" "$2" "$digest" "$media" "${size:-null}" "$arch" "$how" >> "$SQUIDCI_PUBLISHED"
  fi
}

# squidci_docker_existing <image> <tag> [said]: whether image:tag is already in the registry, exported when it is.
# Any failure to look reads as not there. Run as a condition, so it ends the job itself with exit.
squidci_docker_existing() {
  local descriptor media digest arch said="${3:-so it is neither built nor pushed}"
  descriptor=$(docker buildx imagetools inspect "$1:$2" --format '{{json .Manifest}}' 2>/dev/null) || return 1
  media=$(squidci_docker_field "$descriptor" mediaType)
  digest=$(squidci_docker_field "$descriptor" digest)
  [ -n "$digest" ] || return 1
  case "$media" in
    *index*|*manifest.list*)
      echo "squidci: $1:$2 is already there as an index of several images ($media); skip-existing exports one image, so it cannot skip to an index" >&2
      exit 1 ;;
  esac
  arch=$(squidci_docker_field "$(docker buildx imagetools inspect "$1@$digest" --format '{{json .Image}}' 2>/dev/null)" architecture)
  echo "squidci: $1:$2 is already there, $said"
  squidci_docker_export "$1" "$2" "$digest" "$arch" found || exit 1
}

# After a failed push: another job may have pushed the same tag meanwhile.
squidci_docker_pushed_meanwhile() {
  echo "squidci: the push to $1:$2 failed; looking again, in case another job pushed it meanwhile" >&2
  squidci_docker_existing "$1" "$2" 'pushed meanwhile by another job, so it stands for this one'
}

# squidci_docker_staged <image:tag>: the staged image a build recorded for image:tag, as repository@digest, or nothing.
squidci_docker_staged() {
  [ -n "$SQUIDCI_RECORDS_DIR" ] && [ -d "$SQUIDCI_RECORDS_DIR" ] || return 0
  local files=("$SQUIDCI_RECORDS_DIR"/*.jsonl)
  [ -e "${files[0]}" ] || return 0
  # Its output is the address alone: installing jq says so on stderr.
  squidci_docker_jq >&2
  cat "${files[@]}" | jq -r --arg ref "$1" 'select(.kind == "docker-image" and .name == $ref) | .staged' | tail -n 1
}

# squidci_docker_record <image:tag> <repository@digest>: the build's record of where it staged image:tag.
squidci_docker_record() {
  mkdir -p "$(dirname "$SQUIDCI_RECORDS")"
  printf '{"kind":"docker-image","name":"%s","staged":"%s"}\n' "$1" "$2" >> "$SQUIDCI_RECORDS"
}

# squidci_docker_stage <image:tag>: the built image pushed to the run's staging, and recorded.
squidci_docker_stage() {
  squidci_docker_staging_login
  local staged digest
  staged="$SQUIDCI_STAGING_REPOSITORY:$SQUIDCI_STAGING_PREFIX$(printf '%s' "$1" | sha256sum | cut -c1-16)"
  docker tag "$1" "$staged"
  docker push "$staged" | tee /tmp/squidci-docker-push.log >/dev/null
  digest=$(grep -o 'digest: sha256:[0-9a-f]*' /tmp/squidci-docker-push.log | tail -n 1 | sed 's/digest: //')
  if [ -z "$digest" ]; then
    echo "squidci: staging $1 reported no digest" >&2
    return 1
  fi
  squidci_docker_record "$1" "$SQUIDCI_STAGING_REPOSITORY@$digest"
  echo "squidci: staged $1 as $SQUIDCI_STAGING_REPOSITORY@$digest"
}

# squidci_docker_copy <repository@digest> <image> <tag> [skip-existing]: the staged manifest pushed as image:tag,
# as it is, so what is published is what was tested. Tried three times: a registry can take a push and not
# serve it back at once.
squidci_docker_copy() {
  squidci_docker_staging_login
  local attempt
  for attempt in 1 2 3; do
    if docker buildx imagetools create --prefer-index=false --tag "$2:$3" "$1"; then
      squidci_docker_export "$2" "$3" "${1#*@}"
      return
    fi
    if [ "$4" = skip-existing ] && squidci_docker_pushed_meanwhile "$2" "$3"; then
      return
    fi
    [ "$attempt" = 3 ] && return 1
    echo "squidci: $2 did not take the copy yet; trying again in $((attempt * 10))s" >&2
    sleep $((attempt * 10))
  done
}
