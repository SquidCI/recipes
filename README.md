# SquidCI recipes

SquidCI's recipes: the steps a pipeline file can use beyond its own
commands, one folder each. Every cell reads `main`, so a push here is live
on the next run everywhere. For the recipe format, see SquidCI's docs.

```
index.yaml          # the recipes this repo publishes
uv/
  recipe.yaml
  setup.sh
  run.sh
  README.md
  test/test.sh      # what its steps print, run by test/harness.sh
  test/bin/         # fakes of the tools, first on the PATH while tests run
```

## Tests

```bash
bash test/run.sh
```

Runs every recipe's `test/test.sh` and checks the index lists every folder
that has a `recipe.yaml`.
