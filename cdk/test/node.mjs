// Tests run.mjs against a fake CloudFormation, and records.mjs against a small cloud assembly.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = process.env.SQUIDCI_RECIPE_DIR;
const { expand, run, select, targetsOf, resolveStack } = await import(join(dir, "run.mjs"));

const CI = "arn:aws:iam::111111111111:role/ci";
const targets = [{ name: "dev", roleArn: CI }];
const spec = (id, extra = {}) => ({
  id,
  stackName: id,
  account: "111111111111",
  region: "eu-west-1",
  templateUrl: "s3://cdk-${AWS::AccountId}/t.json",
  parameters: {},
  tags: {},
  terminationProtection: false,
  dependencies: [],
  ...extra,
});
const record = (stack) => ({ kind: "cdk-stack", name: `111111111111/eu-west-1/${stack.id}`, payload: stack });

assert.equal(expand("web-$SQUIDCI_ENVIRONMENT-${X}", { SQUIDCI_ENVIRONMENT: "dev", X: "1" }), "web-dev-1");
assert.deepEqual(targetsOf("[profile squidci_job]\nregion = eu-west-1\n[profile dev]\nrole_arn = arn:aws:iam::111111111111:role/ci\nsource_profile = squidci_job\n"), targets);
assert.deepEqual(select([record(spec("web-dev")), record(spec("web-prod"))], ["web-dev"], targets).stacks.map((stack) => stack.id), ["web-dev"]);
assert.deepEqual(select([record(spec("web-dev")), record(spec("api"))], [], targets).stacks.map((stack) => stack.id), ["web-dev", "api"]);
assert.match(select([record(spec("web-dev"))], ["web-qa"], targets).refused, /recorded no stack web-qa: it recorded web-dev/);
assert.match(select([], [], targets).refused, /recorded no stacks/);
assert.match(select([record(spec("web-dev", { account: "222222222222" }))], [], targets).refused, /account 222222222222, which is not one of the job's aws.profiles/);
assert.equal(resolveStack(spec("a"), targets).templateUrl, "https://s3.eu-west-1.amazonaws.com/cdk-111111111111/t.json");

// A fake CloudFormation, one stack each: a script of what DescribeStacks and DescribeChangeSet say, look by look.
class Command {
  constructor(input) {
    this.input = input;
  }
}
const CF = Object.fromEntries(
  ["DescribeStacks", "DescribeChangeSet", "DescribeStackEvents", "CreateChangeSet", "ExecuteChangeSet", "DeleteChangeSet", "DeleteStack", "GetTemplateSummary", "UpdateTerminationProtection"].map((name) => [
    `${name}Command`,
    class extends Command {
      name = name;
    },
  ]),
);

const fake = (plans) => {
  const calls = [];
  const clientsFor = async (stack) => {
    const plan = plans[stack.spec.id];

    return {
      bootstrapVersion: async () => 99,
      send: async (command) => {
        calls.push(`${stack.spec.id} ${command.name}`);
        const answer = plan[command.name]?.(command.input);

        if (answer instanceof Error) {
          throw answer;
        }

        return answer ?? {};
      },
    };
  };

  return { calls, ctx: { cf: CF, clientsFor, changeSet: "squidci-job1", log: () => {}, now: () => new Date(0), sleep: async () => {} } };
};
const notFound = () => Object.assign(new Error("Stack with id x does not exist"), { name: "ValidationError" });

// An update: planned, executed, followed to UPDATE_COMPLETE, its output exported.
{
  let looks = 0;
  let executed = false;
  const { calls, ctx } = fake({
    web: {
      DescribeStacks: () => {
        looks += 1;
        const status = !executed ? "UPDATE_COMPLETE" : looks < 6 ? "UPDATE_IN_PROGRESS" : "UPDATE_COMPLETE";

        return { Stacks: [{ StackId: "arn:web", StackStatus: status, EnableTerminationProtection: false, ...(executed ? { ChangeSetId: "arn:changeSet/squidci-job1/x" } : {}), Outputs: [{ OutputKey: "Url", OutputValue: "https://web" }] }] };
      },
      DescribeChangeSet: () => (calls.includes("web CreateChangeSet") ? { Status: "CREATE_COMPLETE", ExecutionStatus: executed ? "EXECUTE_COMPLETE" : "AVAILABLE", Changes: [] } : Object.assign(new Error("no"), { name: "ChangeSetNotFoundException" })),
      ExecuteChangeSet: () => {
        executed = true;
      },
      DescribeStackEvents: () => ({ StackEvents: [] }),
    },
  });
  const result = await run("deploy", [resolveStack(spec("web"), targets)], ctx);

  assert.deepEqual(result.stacks, [{ name: "web", status: "succeeded", reason: undefined }]);
  assert.deepEqual(result.outputs, { WEB_URL: "https://web" });
  assert.ok(calls.includes("web CreateChangeSet") && calls.includes("web ExecuteChangeSet"));
}

// Nothing to change: the empty change set is unchanged, and deleted.
{
  const { calls, ctx } = fake({
    web: {
      DescribeStacks: () => ({ Stacks: [{ StackId: "arn:web", StackStatus: "UPDATE_COMPLETE" }] }),
      DescribeChangeSet: () => (calls.includes("web CreateChangeSet") ? { Status: "FAILED", StatusReason: "The submitted information didn't contain changes." } : Object.assign(new Error("no"), { name: "ChangeSetNotFoundException" })),
    },
  });
  const result = await run("deploy", [resolveStack(spec("web"), targets)], ctx);

  assert.equal(result.stacks[0].status, "unchanged");
  assert.ok(calls.includes("web DeleteChangeSet") && !calls.includes("web ExecuteChangeSet"));
}

// A diff shows the changes and executes nothing; a new stack's REVIEW_IN_PROGRESS shell goes with its change set.
{
  const { calls, ctx } = fake({
    web: {
      DescribeStacks: () => (calls.includes("web CreateChangeSet") ? { Stacks: [{ StackId: "arn:web", StackStatus: "REVIEW_IN_PROGRESS" }] } : notFound()),
      DescribeChangeSet: () => ({ Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Changes: [{ ResourceChange: { Action: "Add", LogicalResourceId: "Bucket", ResourceType: "AWS::S3::Bucket" } }] }),
    },
  });
  const result = await run("diff", [resolveStack(spec("web"), targets)], ctx);

  assert.deepEqual(result.stacks[0], { name: "web", status: "succeeded", reason: "1 changes" });
  assert.ok(calls.includes("web DeleteChangeSet") && calls.includes("web DeleteStack") && !calls.includes("web ExecuteChangeSet"));
}

// A destroy deletes what depends on a stack first.
{
  const deleted = new Set();
  const plan = (id) => ({
    DescribeStacks: () => (deleted.has(id) ? notFound() : { Stacks: [{ StackId: `arn:${id}`, StackStatus: "UPDATE_COMPLETE" }] }),
    DeleteStack: () => {
      deleted.add(id);
    },
    DescribeStackEvents: () => ({ StackEvents: [] }),
  });
  const { calls, ctx } = fake({ base: plan("base"), app: plan("app") });
  const result = await run("destroy", [resolveStack(spec("base"), targets), resolveStack(spec("app", { dependencies: ["base"] }), targets)], ctx);

  assert.deepEqual(result.stacks.map((stack) => stack.status), ["succeeded", "succeeded"]);
  assert.ok(calls.indexOf("app DeleteStack") < calls.indexOf("base DeleteStack"));
}

// A deploy whose dependency fails skips the stack that needs it.
{
  const { ctx } = fake({
    base: {
      DescribeStacks: () => ({ Stacks: [{ StackId: "arn:base", StackStatus: "UPDATE_ROLLBACK_FAILED" }] }),
      DescribeChangeSet: () => Object.assign(new Error("no"), { name: "ChangeSetNotFoundException" }),
    },
    app: { DescribeStacks: () => ({ Stacks: [{ StackId: "arn:app", StackStatus: "UPDATE_COMPLETE" }] }) },
  });
  const result = await run("deploy", [resolveStack(spec("base"), targets), resolveStack(spec("app", { dependencies: ["base"] }), targets)], ctx);

  assert.deepEqual(result.stacks.map((stack) => stack.status), ["failed", "skipped"]);
}

// records.mjs: a stack per one cdk list selected, nested assemblies included, the job's account and region for one that names none.
{
  const out = mkdtempSync(join(tmpdir(), "squidci-cdk-"));
  const published = join(out, "published");

  mkdirSync(join(out, "stage"));
  writeFileSync(
    join(out, "manifest.json"),
    JSON.stringify({
      artifacts: {
        web: { type: "aws:cloudformation:stack", environment: "aws://unknown-account/unknown-region", displayName: "web", properties: { stackTemplateAssetObjectUrl: "s3://b/web.json", stackName: "web-dev" } },
        Stage: { type: "cdk:cloud-assembly", properties: { directoryName: "stage" } },
      },
    }),
  );
  writeFileSync(
    join(out, "stage", "manifest.json"),
    JSON.stringify({ artifacts: { api: { type: "aws:cloudformation:stack", environment: "aws://333333333333/us-east-1", displayName: "Stage/api", dependencies: ["web"], properties: { stackTemplateAssetObjectUrl: "s3://b/api.json", terminationProtection: true } } } }),
  );
  writeFileSync(join(out, "list.json"), JSON.stringify([{ name: "web-dev", environment: { name: "aws://unknown-account/unknown-region" } }, { name: "api", environment: { name: "aws://333333333333/us-east-1" } }]));
  execFileSync("node", [join(dir, "records.mjs"), out, join(out, "list.json"), "111111111111", "eu-west-1"], { env: { ...process.env, SQUIDCI_PUBLISHED: published } });

  const records = readFileSync(published, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  assert.deepEqual(records.map((one) => one.name), ["111111111111/eu-west-1/web-dev", "333333333333/us-east-1/api"]);
  assert.deepEqual(records[1].payload.dependencies, ["web"], "the other selected stacks it depends on, by id");
  assert.equal(records[1].payload.terminationProtection, true);
}
