# agent

**`agent: {agent, agent-environment, prompt}`** starts a session of an AI
agent with `prompt`, and the step ends: it does not wait for the session,
and what the agent finds is the agent's to act on. Allowed in every section,
and made for an environment's `post-deploy`: a check after a rollout, a
look at an environment's health.

```yaml
environments:
  prod:
    env:
      ANTHROPIC_ORGANIZATION_ID: 00000000-0000-0000-0000-000000000000
      ANTHROPIC_SERVICE_ACCOUNT_ID: svac_01HXYZ
      ANTHROPIC_FEDERATION_RULE_ID: fdrl_01HXYZ
    post-deploy:
      runner: {lambda: nodejs26.x}
      steps:
        - agent:
            agent: agent_01HXYZ
            agent-environment: env_01HXYZ
            title: "{{component}} {{commit.short}} to {{environment}}"
            prompt: |
              {{component}} {{commit.short}} was just deployed to {{environment}}: {{deploy.outcome}}.
              The commits it brought: {{deploy.previous.short}}..{{commit.short}} in {{repository}}.
              Check the environment is healthy. Its run: {{run.url}}
```

- `provider` is `anthropic`, the only one so far: a [Claude Managed
  Agent](https://platform.claude.com/docs/en/managed-agents/overview).
  `agent` and `agent-environment` are its agent's and environment's ids.
- `prompt` and `title` take the placeholders of the [webhook
  recipe](/docs/recipes/webhook/#placeholders), filled in as the job is made.
- `vaults` lists the vaults the session gets, for the MCP servers and tools
  the agent needs.
- The step logs the session's id and its page in the Claude Console, and
  exports them as `session_id` and `session_url`.
- Signing in is tried four times on a timeout, a refused connection, 408,
  429 or a 5xx. Starting the session is tried again only on 429, 503 or
  529, which Anthropic answers having started nothing: anything else could
  start two.
- It runs under `runner.lambda` and on EC2, where the image needs `node`;
  the runner image has it.

## Signing in, with no key

The step signs in to Anthropic with its job's OpenID Connect token, for
audience `https://api.anthropic.com`, exchanged by [workload identity
federation](https://platform.claude.com/docs/en/manage-claude/workload-identity-federation).
No API key is stored anywhere. Once, in the Claude Console:

1. **An issuer**: your execution plane's,
   `https://jobs.<region>.squidci.cloud/<organization>/<plane>`, with JWKS
   discovery: see [Job tokens](/docs/pipelines/job-tokens/).
2. **A service account**, a member of the workspace sessions start in.
3. **A rule** for that issuer and service account, with scope
   `workspace:developer`, matching the jobs that may start sessions by their
   subject: `repo:acme/shop:environment:prod:*` for any job deploying
   `acme/shop` to `prod`.

Then give the step the rule's ids, as `organization`, `service-account`
and `federation-rule`, or in the job's env under Anthropic's names, as
above; and `workspace` when the rule names more than one.
