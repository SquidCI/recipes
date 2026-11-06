# test/bin/curl prints the request it would send and answers the status in CURL_STATUS.
. "$SQUIDCI_RECIPE_DIR/lib.sh"
expect "$(setup 2>&1)" ""
expect "$(CURL_STATUS=204 step url=https://example.com/hook body='{"text":"deployed \"main\""}' 2>&1)" "$(printf 'POST https://example.com/hook {"text":"deployed \\"main\\""}\nsquidci: https://example.com/hook answered 204')"
expect "$(CURL_STATUS=200 step url=https://example.com/hook 2>&1)" "$(printf 'POST https://example.com/hook {}\nsquidci: https://example.com/hook answered 200')"
expect "$(CURL_STATUS=500 step url=https://example.com/hook body='{}' 2>&1 || echo "exit $?")" "$(printf 'POST https://example.com/hook {}\nsquidci: https://example.com/hook answered 500\nsquidci: the webhook to https://example.com/hook answered 500, not a success\nexit 1')"
node "$SQUIDCI_RECIPE_DIR/test/node.mjs"
