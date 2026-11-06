# squidci_webhook <url> <body file>: a POST of the file as JSON. Three more
# tries on a timeout, a refused connection, 408, 429 or a 5xx, each try 30
# seconds at most; no redirect followed. The status is logged, the response
# is not.
squidci_webhook() {
  local status
  if ! status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 --retry 3 --retry-connrefused \
    -X POST -H 'Content-Type: application/json' --data-binary "@$2" "$1"); then
    echo "squidci: the webhook to $1 could not be sent" >&2
    return 1
  fi
  echo "squidci: $1 answered $status"
  if [[ "$status" != 2?? ]]; then
    echo "squidci: the webhook to $1 answered $status, not a success" >&2
    return 1
  fi
}
