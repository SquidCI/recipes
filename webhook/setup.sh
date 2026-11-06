# curl, installed when the image lacks it: Debian and Ubuntu only.
if ! command -v curl >/dev/null; then
  echo 'squidci: this image has no curl; installing it'
  squidci_webhook_os=$(. /etc/os-release 2>/dev/null && echo "$ID")
  case "$squidci_webhook_os" in
    ubuntu|debian) ;;
    *) echo "squidci: a webhook step needs curl in the image, and SquidCI can only install it on Debian or Ubuntu (this image says ID=$squidci_webhook_os)" >&2; return 1 ;;
  esac
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends ca-certificates curl
fi
unset squidci_webhook_os
