# test/bin/uv echoes its argument count and arguments.
expect "$(setup 2>&1)" "$(printf '\n$ uv sync --locked\nuv 2 sync --locked')"
expect "$(step args='run pytest -q' 2>&1)" "uv 3 run pytest -q"
expect "$(step args='run pytest -k "a b"' 2>&1)" "uv 4 run pytest -k a b"
expect "$(step args="run python -c 'print(1)'" 2>&1)" "uv 4 run python -c print(1)"
