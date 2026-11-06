// Runs run.mjs as a Lambda job's step is run, against a local job token endpoint and a local Anthropic.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const module = await readFile(new URL("../run.mjs", import.meta.url), "utf8");
const dir = await mkdtemp(join(tmpdir(), "agent-"));
const received = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    received.push({ method: request.method, url: request.url, auth: request.headers.authorization, beta: request.headers["anthropic-beta"], body });
    const answer = request.url.startsWith("/token")
      ? { token: "job.jwt.sig", expires: "2026-11-09T12:00:00Z" }
      : request.url === "/v1/oauth/token"
        ? { access_token: "sk-ant-oat01-x", token_type: "Bearer", expires_in: 600 }
        : { id: "sesn_01ABC", status: "running" };
    const busy = request.url === "/v1/sessions" && body.includes("busy") && !received.some((r, i) => i < received.length - 1 && r.url === "/v1/sessions");
    response.writeHead(request.url === "/v1/sessions" && body.includes("refuse") ? 400 : busy ? 529 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify(answer));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const step = async (input, env = {}) => {
  const path = join(dir, "step.mjs");
  const output = join(dir, "output");
  await writeFile(path, `const squidci = Object.freeze({ input: Object.freeze(${JSON.stringify(input)}) });\n${module}`);
  await writeFile(output, "");
  received.length = 0;
  const run = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path], {
      env: {
        PATH: process.env.PATH,
        SQUIDCI_ID_TOKEN_URL: `${base}/token/1`,
        SQUIDCI_ID_TOKEN_REQUEST_TOKEN: "bearer",
        SQUIDCI_AGENT_ANTHROPIC_URL: base,
        SQUIDCI_OUTPUT: output,
        SQUIDCI_JOB_ID: "job-1",
        ANTHROPIC_ORGANIZATION_ID: "00000000-0000-0000-0000-000000000000",
        ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_1",
        ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1",
        ...env,
      },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve({ code, out }));
  });
  return { code: run.code, out: run.out.trim(), received: [...received], output: await readFile(output, "utf8") };
};

const failures = [];
const expect = (what, got, want) => {
  if (got !== want) failures.push(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

const started = await step({ agent: "agent_1", "agent-environment": "env_1", prompt: "Check prod", vaults: ["vlt_1"] });
expect("started", started.code, 0);
expect("asked for a token", started.received[0]?.url, "/token/1?audience=https%3A%2F%2Fapi.anthropic.com");
expect("with the bearer", started.received[0]?.auth, "Bearer bearer");
expect("exchanged it", JSON.parse(started.received[1]?.body ?? "{}").assertion, "job.jwt.sig");
expect("for the rule", JSON.parse(started.received[1]?.body ?? "{}").federation_rule_id, "fdrl_1");
const session = JSON.parse(started.received[2]?.body ?? "{}");
expect("started the agent", session.agent, "agent_1");
expect("with the prompt", session.initial_events?.[0]?.content?.[0]?.text, "Check prod");
expect("and the vaults", session.vault_ids?.[0], "vlt_1");
expect("as the service account", started.received[2]?.auth, "Bearer sk-ant-oat01-x");
expect("exported", started.output.split("\n")[0], "session_id=sesn_01ABC");

const missing = await step({ agent: "agent_1", "agent-environment": "env_1", prompt: "x" }, { ANTHROPIC_FEDERATION_RULE_ID: "" });
expect("no rule fails", missing.code, 1);
expect("saying which", missing.out.includes("needs federation-rule"), true);

const refused = await step({ agent: "agent_1", "agent-environment": "env_1", prompt: "refuse" });
expect("a refusal fails", refused.code, 1);
expect("saying so", refused.out.includes("starting the session: 400"), true);

const busy = await step({ agent: "agent_1", "agent-environment": "env_1", prompt: "busy" });
expect("a 529 is tried again", busy.code, 0);
expect("once", busy.received.filter((r) => r.url === "/v1/sessions").length, 2);
expect("a 400 is not", refused.received.filter((r) => r.url === "/v1/sessions").length, 1);

const untokened = await step({ agent: "agent_1", "agent-environment": "env_1", prompt: "x" }, { SQUIDCI_ID_TOKEN_URL: "" });
expect("no token fails", untokened.out.includes("no job token"), true);

// EC2: run.sh's variables, through ec2.mjs, reach run.mjs as the same input.
const ec2 = await new Promise((resolve) => {
  received.length = 0;
  const child = spawn(process.execPath, [new URL("../ec2.mjs", import.meta.url).pathname], {
    env: {
      PATH: process.env.PATH,
      SQUIDCI_ID_TOKEN_URL: `${base}/token/1`,
      SQUIDCI_ID_TOKEN_REQUEST_TOKEN: "bearer",
      SQUIDCI_AGENT_ANTHROPIC_URL: base,
      squidci_input_agent: "agent_2",
      squidci_input_agent_environment: "env_2",
      squidci_input_prompt: "On EC2",
      squidci_input_organization: "00000000-0000-0000-0000-000000000000",
      squidci_input_service_account: "svac_2",
      squidci_input_federation_rule: "fdrl_2",
      SQUIDCI_AGENT_VAULTS: "vlt_a\nvlt_b\n",
    },
  });
  child.on("close", (code) => resolve({ code, received: [...received] }));
});
expect("EC2 started", ec2.code, 0);
expect("EC2 rule", JSON.parse(ec2.received[1]?.body ?? "{}").federation_rule_id, "fdrl_2");
expect("EC2 vaults", JSON.stringify(JSON.parse(ec2.received[2]?.body ?? "{}").vault_ids), '["vlt_a","vlt_b"]');
expect("EC2 environment", JSON.parse(ec2.received[2]?.body ?? "{}").environment_id, "env_2");

server.close();

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
