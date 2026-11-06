# The body, {} when the step has none, written to a file so the shell expands nothing in it.
[ -n "${squidci_input_body+x}" ] || squidci_input_body='{}'
squidci_webhook_body=$(mktemp)
printf '%s' "$squidci_input_body" > "$squidci_webhook_body"
if squidci_webhook "$squidci_input_url" "$squidci_webhook_body"; then
  squidci_webhook_status=0
else
  squidci_webhook_status=$?
fi
rm -f "$squidci_webhook_body"
unset squidci_webhook_body
return $squidci_webhook_status
