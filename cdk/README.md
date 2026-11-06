# cdk

**`cdk: <command>`** or **`cdk: {command, dir, stacks, …}`** runs the AWS CDK
for the app in `dir`.

```yaml
web:
  aws: {profiles: [dev, prod]}
  publish:
    steps:
      - cdk: {command: publish, dir: infra}
  deploy:
    runner: {lambda: nodejs26.x}
    steps:
      - cdk: {command: deploy, stacks: [web-$SQUIDCI_ENVIRONMENT]}
```

On EC2 it is the CDK CLI, run from the checkout: any command it has, as
`cdk <command>` with the step's stacks, context and app. `deploy` waits in
the job for CloudFormation, for as long as that takes. And one of
SquidCI's own:

- **`publish`** synthesises the app, publishes the selected stacks' assets
  — templates, files and Docker images — to each stack's bootstrap
  bucket and repository, and records each stack as published, for a later
  deploy to use without the checkout. It changes no stack.

On Lambda, where there is no checkout, it deploys what the version's
publish recorded: **`deploy`**, **`diff`** or **`destroy`**, of the stacks
it names, every one the publish recorded when it names none. Anything else
is refused as the file is read. A Lambda job runs for at most 15 minutes,
and a deploy that takes longer fails: CloudFormation carries on by itself,
and the next deploy waits for a stack still changing.

- `dir` is the app's directory, from the repository's root; `app` the
  command that runs it, in place of `cdk.json`'s.
- `stacks` are names or patterns, `*` and `?`; `$SQUIDCI_ENVIRONMENT` and
  other variables expand. On EC2 a `deploy` or `destroy` with none is
  `--all`.
- `context` is `cdk -c` key by key; `parameters` CloudFormation's, `Name`
  for every stack that declares it or `stack:Name` for one.
- `rollback: false` leaves a failed stack as it failed.
- `profile` is one of the job's AWS profiles to run as, on EC2.
- `args` adds to the CLI's arguments on EC2: `--require-approval never`
  for a deploy that adds IAM, `--force` for a destroy, which otherwise ask.
- A `deploy` exports each stack's outputs as `<STACK>_<OUTPUT>`.

A `pnpm-lock.yaml` from `dir` up gets the app's dependencies installed
first, as a `pnpm` step would; another language's app installs its own in a
step before. Docker, which image assets and some bundling need, is started
when the image has it, and installed on Debian or Ubuntu when it has not.
