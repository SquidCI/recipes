# webhook

**`webhook: {url, body}`** POSTs `body` as JSON to `url`, with
`Content-Type: application/json`. Allowed in every section, and made for an
environment's `post-deploy`.

```yaml
environments:
  prod:
    post-deploy:
      steps:
        - webhook:
            url: https://hooks.example.com/deploys
            body: {text: "{{component}} {{deploy.outcome}} in {{environment}}"}
```

- `url` is `http` or `https`, written out in full, with no credentials in
  it. Redirects are not followed.
- `body` is any YAML value, sent as the JSON it is; `{}` when left out,
  at most 16 KB. An unquoted `true`, `3` or `null` is that JSON value, and
  so is a key left empty; quote one to send it as a string:
  `version: "1.10"`.
- A 2xx is success. Anything else fails the step; the log shows the status,
  never the response. A redirect is not followed. A timeout, a refused
  connection, or a 408, 429, 500, 502, 503 or 504 is tried three more
  times, waiting longer each time, and each try takes at most 30 seconds.
- Sending a header, a token, is not there yet.

The runner image has curl; a Debian or Ubuntu image without it gets it
installed before the first step. Under `runner.lambda` it posts with
Node's `fetch` instead, with the same tries.

## Placeholders

`{{name}}` may stand in the body's strings, but not in its keys or the
`url`. SquidCI fills them in as it makes the job, so the job shows what it
sent, and each value is escaped as a JSON string, so a commit message
cannot break the body. A name not below, or not known to the section, is
refused, as is a `{{` that opens none.

| placeholder | value | known to |
|---|---|---|
| `{{repository}}` | `owner/name` | every section |
| `{{branch}}` | the run's branch | every section |
| `{{commit}}`, `{{commit.short}}` | the run's commit, in full or its first 7 characters | every section |
| `{{commit.message}}` | the first line of its message | every section |
| `{{component}}` | the component | every section |
| `{{section}}` | `build`, `deploy`, `post-deploy`… | every section |
| `{{run.url}}`, `{{job.url}}` | the run's page, and the job's | every section |
| `{{environment}}` | the environment's name, as `$SQUIDCI_ENVIRONMENT` | `deploy`, `post-deploy` |
| `{{deploy.outcome}}` | `succeeded`, `failed` or `cancelled` | `post-deploy` |
| `{{deploy.previous}}`, `{{deploy.previous.short}}` | the commit the environment had before, empty for its first deploy | `post-deploy` |
| `{{deploy.url}}` | the deploy's page | `post-deploy` |
