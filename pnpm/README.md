# pnpm

**`pnpm: <args>`** runs `pnpm <args>`, on one line: `test`, `run build
--filter web`, `cdk synth`. Or `pnpm: {args: <args>}`.

```yaml
components:
  web:
    check:
      steps:
        - pnpm: check
    test:
      steps:
        - pnpm: test
    build:
      steps:
        - pnpm: build
```

Before the job's first `pnpm` step, Node is installed as the repository
pins it — `.nvmrc`, or `.node-version`, looked for from the component's
`base` up, the image's default when nothing pins one — and then
`pnpm install --frozen-lockfile`. Both show in the log as steps of their
own, and a second `pnpm` step finds them done. A `cdk` step installs its
app's dependencies the same way when it finds a `pnpm-lock.yaml`.

pnpm's store goes in the job's build cache, so a job's packages outlive its
container. The runner image has nvm and pnpm; an image of your own must
bring them, or the first `pnpm` step fails saying so.
