// node records.mjs <cdk.out> <stacks.json> <account> <region>: a cdk-stack record per stack `cdk list` selected, to $SQUIDCI_PUBLISHED.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [out, listed, account, region] = process.argv.slice(2);
// "cdk list --long --json" names a stack "id (name)" when the two differ, so a stack is matched by its name and environment.
const keyOf = (name, environment) => `${name} ${environment}`;
const selected = new Set(JSON.parse(readFileSync(listed, "utf8")).map((stack) => keyOf(stack.name, stack.environment.name)));
const stacks = [];

const walk = (dir) => {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  for (const [id, artifact] of Object.entries(manifest.artifacts ?? {})) {
    if (artifact.type === "cdk:cloud-assembly") {
      walk(join(dir, artifact.properties.directoryName));
    } else if (artifact.type === "aws:cloudformation:stack") {
      stacks.push({ artifactId: id, artifact, dependencies: artifact.dependencies ?? [] });
    }
  }
};
walk(out);

const chosen = stacks.filter((stack) => selected.has(keyOf(stack.artifact.properties?.stackName ?? stack.artifactId, stack.artifact.environment)));
const ids = new Map(chosen.map((stack) => [stack.artifactId, stack.artifact.displayName ?? stack.artifactId]));

if (chosen.length === 0) {
  console.error("squidci: the cdk step selects no stacks");
  process.exit(1);
}

for (const { artifactId, artifact, dependencies } of chosen) {
  const id = ids.get(artifactId);
  const props = artifact.properties ?? {};
  const env = /^aws:\/\/([^/]+)\/(.+)$/.exec(artifact.environment ?? "") ?? [];

  if (!props.stackTemplateAssetObjectUrl) {
    console.error(`squidci: ${id} has no template asset: publish needs the default stack synthesizer`);
    process.exit(1);
  }

  const stack = {
    id,
    stackName: props.stackName ?? artifactId,
    // An environment-agnostic stack's assets went where the job's credentials put them.
    account: env[1] && env[1] !== "unknown-account" ? env[1] : account,
    region: env[2] && env[2] !== "unknown-region" ? env[2] : region,
    templateUrl: props.stackTemplateAssetObjectUrl,
    ...(props.assumeRoleArn ? { assumeRoleArn: props.assumeRoleArn } : {}),
    ...(props.cloudFormationExecutionRoleArn ? { cloudFormationExecutionRoleArn: props.cloudFormationExecutionRoleArn } : {}),
    ...(props.requiresBootstrapStackVersion ? { requiresBootstrapStackVersion: props.requiresBootstrapStackVersion } : {}),
    ...(props.bootstrapStackVersionSsmParameter ? { bootstrapStackVersionSsmParameter: props.bootstrapStackVersionSsmParameter } : {}),
    parameters: props.parameters ?? {},
    tags: props.tags ?? {},
    terminationProtection: props.terminationProtection === true,
    dependencies: dependencies.filter((dependency) => ids.has(dependency)).map((dependency) => ids.get(dependency)),
  };

  appendFileSync(process.env.SQUIDCI_PUBLISHED, `${JSON.stringify({ kind: "cdk-stack", name: `${stack.account}/${stack.region}/${stack.stackName}`, payload: stack })}\n`);
}

console.log(`squidci: recorded ${chosen.map((stack) => stack.artifact.properties?.stackName ?? stack.artifactId).join(", ")} as published`);
