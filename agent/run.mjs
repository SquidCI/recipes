// Starts a Claude Managed Agent's session with the prompt, signed in with this job's token, and exports its id.
const input = squidci.input;
const env = process.env;
const API = env.SQUIDCI_AGENT_ANTHROPIC_URL || "https://api.anthropic.com";
const AUDIENCE = "https://api.anthropic.com";
const HEADERS = { "content-type": "application/json", "anthropic-version": "2026-10-21" };
const BETA = "managed-agents-2026-04-01,oauth-2025-04-20";

const setting = (field, variable) => {
  const value = input[field] ?? env[variable];

  if (!value) {
    throw new Error(`the agent step needs ${field}, or ${variable} in the job's env: see the agent recipe's README`);
  }

  return value;
};

const TRIES = 4;
const pause = (attempt) => new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));

// A request's failure, and whether it may be tried again.
class Failed extends Error {
  constructor(message, retried) {
    super(message);
    this.retried = retried;
  }
}

// One request; `again` says which statuses may be tried again, and whether an unreached one may.
const call = async (what, url, init, again) => {
  let response;

  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new Failed(`${what}: ${url} could not be reached (${error?.message ?? error})`, again.unreached);
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Failed(`${what}: ${response.status} ${text.slice(0, 300)}`, again.statuses.includes(response.status));
  }

  return JSON.parse(text);
};

// Tries `attempt` up to TRIES times while its failure may be tried again, waiting longer each time.
const tried = async (attempt) => {
  for (let n = 1; ; n += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof Failed) || !error.retried || n === TRIES) {
        throw error;
      }

      console.log(`squidci: ${error.message}; trying again`);
      await pause(n);
    }
  }
};

// Anything not done, and a token or exchange done twice costs nothing.
const TRANSIENT = { statuses: [408, 429, 500, 502, 503, 504, 529], unreached: true };
// Only what Anthropic says it did not start: a session started twice is two sessions.
const NOT_STARTED = { statuses: [429, 503, 529], unreached: false };

if ((input.provider ?? "anthropic") !== "anthropic") {
  throw new Error(`the agent step has no provider ${input.provider}`);
}

if (!env.SQUIDCI_ID_TOKEN_URL) {
  throw new Error("this job has no job token to sign in with: its plane's code or agent predates job tokens");
}

const organization = setting("organization", "ANTHROPIC_ORGANIZATION_ID");
const serviceAccount = setting("service-account", "ANTHROPIC_SERVICE_ACCOUNT_ID");
const rule = setting("federation-rule", "ANTHROPIC_FEDERATION_RULE_ID");
const workspace = input.workspace ?? env.ANTHROPIC_WORKSPACE_ID;

// A fresh job token for every exchange: Anthropic takes each once.
const { access_token: accessToken } = await tried(async () => {
  const { token: assertion } = await call(
    "the job token",
    `${env.SQUIDCI_ID_TOKEN_URL}?audience=${encodeURIComponent(AUDIENCE)}`,
    { headers: { authorization: `Bearer ${env.SQUIDCI_ID_TOKEN_REQUEST_TOKEN}` } },
    TRANSIENT,
  );

  return call(
    "Anthropic's token exchange",
    `${API}/v1/oauth/token`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
        federation_rule_id: rule,
        organization_id: organization,
        service_account_id: serviceAccount,
        ...(workspace ? { workspace_id: workspace } : {}),
      }),
    },
    TRANSIENT,
  );
});

const session = await tried(() => call("starting the session", `${API}/v1/sessions`, {
  method: "POST",
  headers: { ...HEADERS, authorization: `Bearer ${accessToken}`, "anthropic-beta": BETA },
  body: JSON.stringify({
    agent: input.agent,
    environment_id: input["agent-environment"],
    ...(input.title ? { title: input.title } : {}),
    ...(input.vaults?.length ? { vault_ids: input.vaults } : {}),
    metadata: {
      squidci_job: env.SQUIDCI_JOB_ID ?? "",
      ...(env.SQUIDCI_ENVIRONMENT ? { squidci_environment: env.SQUIDCI_ENVIRONMENT } : {}),
    },
    initial_events: [{ type: "user.message", content: [{ type: "text", text: input.prompt }] }],
  }),
}, NOT_STARTED));

const url = `https://platform.claude.com/workspaces/${workspace ?? "default"}/sessions/${session.id}`;

console.log(`squidci: started session ${session.id} of ${input.agent}: ${url}`);

if (env.SQUIDCI_OUTPUT) {
  const { appendFileSync } = await import("node:fs");

  appendFileSync(env.SQUIDCI_OUTPUT, `session_id=${session.id}\nsession_url=${url}\n`);
}
