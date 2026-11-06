// Runs run.mjs as a Lambda job's step is run, against a local server answering the status asked for.
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const module = await readFile(new URL("../run.mjs", import.meta.url), "utf8");
const dir = await mkdtemp(join(tmpdir(), "webhook-"));
const received = [];
const server = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    received.push(`${request.method} ${request.headers["content-type"]} ${body}`);
    response.writeHead(Number(new URL(request.url, "http://x").searchParams.get("status"))).end();
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/hook`;

const step = async (input) => {
  const path = join(dir, "step.mjs");
  await writeFile(path, `const squidci = Object.freeze({ input: Object.freeze(${JSON.stringify(input)}) });\n${module}`);
  received.length = 0;
  const run = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path]);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => resolve({ code, out }));
  });
  return { code: run.code, out: run.out.trim(), received: [...received] };
};

const failures = [];
const expect = (what, got, want) => {
  if (got !== want) failures.push(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

let result = await step({ url: `${base}?status=204`, body: { text: 'deployed "main"' } });
expect("posted", result.received[0], 'POST application/json {"text":"deployed \\"main\\""}');
expect("logged", result.out, `squidci: ${base}?status=204 answered 204`);
expect("succeeded", result.code, 0);

result = await step({ url: `${base}?status=200` });
expect("empty body", result.received[0], "POST application/json {}");

result = await step({ url: `${base}?status=400` });
expect("tried once", result.received.length, 1);
expect("failed", result.code, 1);
expect("said why", result.out.includes(`the webhook to ${base}?status=400 answered 400, not a success`), true);

server.close();
await rm(dir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
