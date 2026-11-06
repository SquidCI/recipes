// run.mjs on EC2, with the step's fields as squidci.input, as a Lambda job's step has them.
const env = process.env;
const fields = {
  provider: env.squidci_input_provider,
  agent: env.squidci_input_agent,
  "agent-environment": env.squidci_input_agent_environment,
  prompt: env.squidci_input_prompt,
  title: env.squidci_input_title,
  vaults: (env.SQUIDCI_AGENT_VAULTS ?? "").split("\n").filter(Boolean),
  organization: env.squidci_input_organization,
  "service-account": env.squidci_input_service_account,
  "federation-rule": env.squidci_input_federation_rule,
  workspace: env.squidci_input_workspace,
};
const input = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== "" && value.length !== 0));

globalThis.squidci = Object.freeze({ input: Object.freeze(input) });
await import("./run.mjs");
