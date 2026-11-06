# uv

**`uv: <args>`** runs `uv <args>`, on one line: `run pytest -q`, `run ruff
check`, `build`. Or `uv: {args: <args>}`.

```yaml
api:
  base: api
  test:
    steps:
      - uv: run pytest -q
  check:
    steps:
      - uv: run ruff check
      - uv: run mypy .
```

Before the job's first `uv` step, `uv sync --locked` is run from the
component's `base`: the project's environment as its lockfile has it, with
the Python it pins (`.python-version`, or its `requires-python`) installed
when the image lacks it. A lockfile that is out of date fails the step
rather than being resolved afresh. The sync shows in the log as a step of
its own, and a second `uv` step finds it done.

The pytest it runs reports each test live, as any pytest in the job does.
uv's downloads and wheels go in the job's build cache, `UV_CACHE_DIR`, so
they outlive the job's container.

The runner image has uv; an image of your own must bring it, or the first
`uv` step fails saying so.
