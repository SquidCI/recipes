# cdk

**`cdk: <command>`** or **`cdk: {command, dir, stacks, …}`** runs the AWS CDK
for the app in `dir`.

```yaml
components:
  web:
    aws: {profiles: [dev, prod]}
    publish:
      steps:
        - cdk: {command: publish, dir: infra}
    deploy:
      runner: {workflow: cdk-deploy}
      with: {stacks: [web-$SQUIDCI_ENVIRONMENT]}
```

On EC2 it is the CDK CLI, run from the checkout: any command it has, as
`cdk <command>` with the step's stacks, context and app. The CLI is the
app's own when its dependencies have `aws-cdk`, so it reads what the app's
library writes; otherwise the runner's. `deploy` waits in
the job for CloudFormation, for as long as that takes. And one of
SquidCI's own:

- **`publish`** synthesises the app, publishes the selected stacks' assets
  — templates, files and Docker images — to each stack's bootstrap
  bucket and repository, and records each stack as published, for a later
  deploy to use without the checkout. It changes no stack.

What a publish recorded is deployed by the `cdk-deploy` workflow, a runner
of its own rather than a step: it needs no checkout, holds no worker while
CloudFormation works, and follows each stack to its end for up to 24 hours.

- `dir` is the app's directory, from the repository's root; `app` the
  command that runs it, in place of `cdk.json`'s.
- `stacks` are names or patterns, `*` and `?`; `$SQUIDCI_ENVIRONMENT` and
  other variables expand. A `deploy` or `destroy` with none is `--all`.
- `context` is `cdk -c` key by key; `parameters` CloudFormation's, `Name`
  for every stack that declares it or `stack:Name` for one.
- `rollback: false` leaves a failed stack as it failed.
- `profile` is one of the job's AWS profiles to run as.
- `args` adds to the CLI's arguments: `--require-approval never`
  for a deploy that adds IAM, `--force` for a destroy, which otherwise ask.
- A `deploy` exports each stack's outputs as `<STACK>_<OUTPUT>`.

A `pnpm-lock.yaml` from `dir` up gets the app's dependencies installed
first, as a `pnpm` step would; another language's app installs its own in a
step before. Docker, which image assets and some bundling need, is started
when the image has it, and installed on Debian or Ubuntu when it has not.
