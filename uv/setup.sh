# The project's environment from its lockfile, with the Python it pins.
# --locked refuses a stale lockfile rather than resolving afresh.
squidci_step 'uv sync --locked'
uv sync --locked
