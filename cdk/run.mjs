// The cdk step on Lambda: deploy, diff or destroy the stacks this version's publish recorded, given as squidci.published.
import { appendFileSync, readFileSync } from "node:fs";

const POLL_MS = 5_000;
const THROTTLED_POLL_MS = 15_000;
const CAPABILITIES = ["CAPABILITY_IAM", "CAPABILITY_NAMED_IAM", "CAPABILITY_AUTO_EXPAND"];
const ENDS = new Set(["succeeded", "unchanged", "failed", "skipped"]);

/** $NAME and ${NAME} filled in from the environment, as an EC2 job's shell would. */
export const expand = (text, env = process.env) =>
  text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced, bare) => env[braced ?? bare] ?? "");

/** A stack pattern as the CLI takes one: * any run of characters, ? one. */
export const patternOf = (pattern) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\/]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")}$`);

/** The job's targets, from its AWS config: each profile's name and the ci role it assumes. */
export const targetsOf = (config) => {
  const targets = [];
  let name;

  for (const line of config.split("\n")) {
    const section = /^\s*\[profile ([^\]]+)\]\s*$/.exec(line);
    const role = /^\s*role_arn\s*=\s*(\S+)\s*$/.exec(line);

    if (section) {
      name = section[1];
    } else if (role && name !== undefined) {
      targets.push({ name, roleArn: role[1] });
    }
  }

  return targets;
};

export const partitionOf = (region) => (region.startsWith("cn-") ? "aws-cn" : region.startsWith("us-gov-") ? "aws-us-gov" : "aws");
export const accountOf = (roleArn) => /^arn:[^:]+:iam::(\d{12}):/.exec(roleArn)?.[1];

/** CloudFormation's ${AWS::...} placeholders, as the assembly writes them, filled in. */
export const fillPlaceholders = (text, env) =>
  text.replaceAll("${AWS::AccountId}", env.account).replaceAll("${AWS::Region}", env.region).replaceAll("${AWS::Partition}", env.partition);

/** s3://bucket/key as the HTTPS URL CloudFormation takes, as cdk deploy writes it. */
export const templateHttpsUrl = (s3Url, region) => {
  const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(s3Url);

  return match ? `https://s3.${region}.${region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com"}/${match[1]}/${match[2]}` : s3Url;
};

/** A stack output as an export's name: <STACK>_<OUTPUT>, upper-cased, anything else an underscore. */
export const outputName = (stackId, outputKey) =>
  `${stackId}_${outputKey}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^([0-9])/, "_$1");

export const isEmptyChangeSet = (reason) => reason !== undefined && /didn't contain changes|No updates are to be performed/i.test(reason);

/**
 * The recorded stacks the step names, by id or name, every one when it names none, in an account one of the
 * job's targets reaches. A name that matches nothing, or a choice that leaves nothing, is refused.
 */
export const select = (records, patterns, targets) => {
  const recorded = records.filter((record) => record.kind === "cdk-stack").map((record) => record.payload);

  if (recorded.length === 0) {
    return { refused: "this version's publish recorded no stacks: give its publish a cdk step with command: publish" };
  }

  const matches = (stack, pattern) => patternOf(pattern).test(stack.id) || patternOf(pattern).test(stack.stackName);
  const unmatched = patterns.filter((pattern) => !/[*?]/.test(pattern) && !recorded.some((stack) => matches(stack, pattern)));

  if (unmatched.length > 0) {
    return { refused: `its publish recorded no stack ${unmatched.join(", ")}: it recorded ${recorded.map((stack) => stack.id).join(", ")}` };
  }

  const chosen = recorded.filter((stack) => patterns.length === 0 || patterns.some((pattern) => matches(stack, pattern)));
  const accounts = targets.map((target) => accountOf(target.roleArn));
  const unreachable = chosen.find((stack) => !accounts.includes(stack.account));

  if (chosen.length === 0) {
    return { refused: `none of the stacks its publish recorded (${recorded.map((stack) => stack.id).join(", ")}) match ${patterns.join(", ")}` };
  }

  if (unreachable) {
    return { refused: `${unreachable.id} is in account ${unreachable.account}, which is not one of the job's aws.profiles` };
  }

  return { stacks: chosen };
};

/** A stack with its placeholders filled in and the target whose ci role reaches its account. */
export const resolveStack = (spec, targets) => {
  const target = targets.find((candidate) => accountOf(candidate.roleArn) === spec.account);
  const env = { account: spec.account, region: spec.region, partition: partitionOf(spec.region) };

  return {
    spec,
    ...env,
    target,
    ...(spec.assumeRoleArn === undefined ? {} : { deployRoleArn: fillPlaceholders(spec.assumeRoleArn, env) }),
    ...(spec.cloudFormationExecutionRoleArn === undefined ? {} : { executionRoleArn: fillPlaceholders(spec.cloudFormationExecutionRoleArn, env) }),
    templateUrl: templateHttpsUrl(fillPlaceholders(spec.templateUrl, env), spec.region),
  };
};

/** A stack's parameters with the step's over them: stack:Name for this stack, Name for any whose template declares it. */
export const withStepParameters = (spec, given, declared) => {
  const parameters = { ...spec.parameters };

  for (const [key, value] of Object.entries(given ?? {})) {
    const at = key.lastIndexOf(":");

    if (at === -1) {
      if (declared.includes(key)) {
        parameters[key] = value;
      }
    } else if (key.slice(0, at) === spec.id || key.slice(0, at) === spec.stackName) {
      parameters[key.slice(at + 1)] = value;
    }
  }

  return parameters;
};

export const eventLine = (stackName, event) =>
  `${stackName}  ${event.LogicalResourceId ?? ""}  ${event.ResourceType ?? ""}  ${event.ResourceStatus ?? ""}${event.ResourceStatusReason ? `  ${event.ResourceStatusReason}` : ""}`;

export const changeLines = (stackName, changes) =>
  (changes ?? []).flatMap((change) => {
    const resource = change.ResourceChange;

    if (!resource) {
      return [];
    }

    const replacement = resource.Replacement === "True" ? " (replacement)" : resource.Replacement === "Conditional" ? " (may replace)" : "";

    return [`  ${stackName}: ${resource.Action ?? "?"} ${resource.LogicalResourceId ?? ""} ${resource.ResourceType ?? ""}${replacement}`];
  });

const errorName = (error) => String(error?.name ?? "");
const errorMessage = (error) => (error instanceof Error ? error.message : String(error));
const isThrottling = (error) => /Throttl/.test(errorName(error)) || /Rate exceeded/.test(errorMessage(error));
const isMissingStack = (error) => /does not exist/.test(errorMessage(error));

/**
 * Runs the command over the stacks until each has stopped. `ctx` is what it touches: cf(command) and
 * bootstrapVersion(name) per stack through clientsFor, log, sleep, and the change set's name. Returns each stack's
 * end, and for a deploy the outputs to export.
 */
export const run = async (command, stacks, ctx) => {
  const states = stacks.map((stack) => ({ stack, name: stack.spec.stackName, id: stack.spec.id, status: "waiting", nested: new Set(), seen: new Set() }));
  const byId = new Map(states.map((state) => [state.id, state]));
  const since = ctx.now();
  const { cf: CF } = ctx;

  const end = (state, status, reason) => {
    state.status = status;
    state.reason = reason;
    ctx.log(`squidci: ${state.name}: ${status}${reason ? `: ${reason}` : ""}`);
  };

  const describeStack = async (state) => {
    try {
      return (await state.clients.send(new CF.DescribeStacksCommand({ StackName: state.name }))).Stacks?.[0] ?? null;
    } catch (error) {
      if (isMissingStack(error)) {
        return null;
      }

      throw error;
    }
  };

  const describeChangeSet = async (state) => {
    try {
      return await state.clients.send(new CF.DescribeChangeSetCommand({ StackName: state.name, ChangeSetName: ctx.changeSet }));
    } catch (error) {
      if (errorName(error) === "ChangeSetNotFoundException" || isMissingStack(error)) {
        return null;
      }

      throw error;
    }
  };

  // The stack's events since the step began, its nested stacks' too, oldest first.
  const follow = async (state) => {
    if (!state.arn) {
      return;
    }

    for (const arn of [state.arn, ...state.nested]) {
      const fresh = [];
      let token;

      pages: do {
        const page = await state.clients.send(new CF.DescribeStackEventsCommand({ StackName: arn, NextToken: token }));

        for (const event of page.StackEvents ?? []) {
          if (state.seen.has(event.EventId) || (event.Timestamp !== undefined && event.Timestamp < since)) {
            break pages;
          }

          fresh.push(event);
        }

        token = page.NextToken;
      } while (token !== undefined);

      for (const event of fresh.reverse()) {
        state.seen.add(event.EventId);
        ctx.log(eventLine(arn === state.arn ? state.name : (event.StackName ?? state.name), event));

        if (event.ResourceType === "AWS::CloudFormation::Stack" && event.PhysicalResourceId?.startsWith("arn:") && event.PhysicalResourceId !== state.arn) {
          state.nested.add(event.PhysicalResourceId);
        }
      }
    }
  };

  const dropPlan = async (state, current) => {
    await state.clients.send(new CF.DeleteChangeSetCommand({ StackName: state.name, ChangeSetName: ctx.changeSet })).catch(() => {});

    if (current?.StackStatus === "REVIEW_IN_PROGRESS" && state.arn) {
      await state.clients.send(new CF.DeleteStackCommand({ StackName: state.arn })).catch(() => {});
    }
  };

  const plan = async (state, current) => {
    const { stack } = state;
    const status = current?.StackStatus;

    if (status === "ROLLBACK_COMPLETE" && command === "diff") {
      end(state, "succeeded", "a create that failed (ROLLBACK_COMPLETE): a deploy deletes it and creates it again");

      return;
    }

    if (status === "ROLLBACK_COMPLETE") {
      ctx.log(`squidci: ${state.name}: deleting it, as a create that failed (ROLLBACK_COMPLETE) must be before it is created again`);
      await state.clients.send(new CF.DeleteStackCommand({ StackName: state.arn }));
      state.status = "planning";

      return;
    }

    if (status === "UPDATE_ROLLBACK_FAILED") {
      end(state, "failed", "It is UPDATE_ROLLBACK_FAILED: continue the rollback in CloudFormation before deploying it again");

      return;
    }

    if (status !== undefined && status.endsWith("_IN_PROGRESS") && status !== "REVIEW_IN_PROGRESS") {
      // Something else is changing it: wait for that to end.
      state.status = "waiting";

      return;
    }

    if (stack.spec.requiresBootstrapStackVersion !== undefined && stack.spec.bootstrapStackVersionSsmParameter !== undefined) {
      const version = await state.bootstrapVersion(fillPlaceholders(stack.spec.bootstrapStackVersionSsmParameter, stack));

      if (version === null || version < stack.spec.requiresBootstrapStackVersion) {
        end(state, "failed", `It needs CDK bootstrap version ${stack.spec.requiresBootstrapStackVersion} in ${stack.account}/${stack.region}, which has ${version ?? "none"}: run cdk bootstrap there`);

        return;
      }
    }

    const creating = current === null || status === "REVIEW_IN_PROGRESS" || status === "DELETE_COMPLETE";
    const declared = ctx.parameters === undefined ? [] : ((await state.clients.send(new CF.GetTemplateSummaryCommand({ TemplateURL: stack.templateUrl }))).Parameters ?? []).flatMap((p) => (p.ParameterKey ? [p.ParameterKey] : []));

    await state.clients.send(
      new CF.CreateChangeSetCommand({
        StackName: state.name,
        ChangeSetName: ctx.changeSet,
        ChangeSetType: creating ? "CREATE" : "UPDATE",
        TemplateURL: stack.templateUrl,
        Parameters: Object.entries(withStepParameters(stack.spec, ctx.parameters, declared)).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
        Capabilities: CAPABILITIES,
        ...(stack.executionRoleArn === undefined ? {} : { RoleARN: stack.executionRoleArn }),
        Tags: Object.entries(stack.spec.tags).map(([Key, Value]) => ({ Key, Value })),
        IncludeNestedStacks: true,
        Description: `SquidCI ${command} ${ctx.changeSet}`,
        ClientToken: ctx.changeSet,
      }),
    );
    ctx.log(`squidci: ${state.name}: planning (${creating ? "creating it" : "updating it"})`);
    state.status = "planning";
  };

  // One look at a stack, and whatever that calls for.
  const advance = async (state) => {
    const { stack } = state;

    state.clients ??= await ctx.clientsFor(stack);
    state.bootstrapVersion ??= state.clients.bootstrapVersion;

    const current = await describeStack(state);

    if (current?.StackId) {
      state.arn = current.StackId;
    }

    if (command === "destroy") {
      if (current === null || current.StackStatus === "DELETE_COMPLETE") {
        end(state, state.status === "executing" ? "succeeded" : "unchanged", state.status === "executing" ? undefined : "It was not there");

        return;
      }

      // Waits for the stacks that depend on it to go first.
      if (states.some((other) => other.stack.spec.dependencies.includes(state.id) && !ENDS.has(other.status))) {
        return;
      }

      if (state.status === "executing") {
        await follow(state);

        if (current.StackStatus === "DELETE_FAILED") {
          end(state, "failed", current.StackStatusReason ?? "Its delete failed");
        }

        return;
      }

      await state.clients.send(new CF.DeleteStackCommand({ StackName: state.arn, ...(stack.executionRoleArn === undefined ? {} : { RoleARN: stack.executionRoleArn }) }));
      ctx.log(`squidci: ${state.name}: deleting it`);
      state.status = "executing";

      return;
    }

    const changeSet = current ? await describeChangeSet(state) : null;
    const executed =
      (changeSet?.ExecutionStatus?.startsWith("EXECUTE_") ?? false) || (current?.ChangeSetId?.includes(`:changeSet/${ctx.changeSet}/`) ?? false);

    if (executed && current) {
      await follow(state);

      const status = current.StackStatus ?? "";

      if (status.endsWith("_IN_PROGRESS")) {
        state.status = "executing";

        return;
      }

      if (status === "CREATE_COMPLETE" || status === "UPDATE_COMPLETE" || status === "IMPORT_COMPLETE") {
        if (current.EnableTerminationProtection !== stack.spec.terminationProtection) {
          await state.clients.send(new CF.UpdateTerminationProtectionCommand({ StackName: state.arn, EnableTerminationProtection: stack.spec.terminationProtection }));
        }

        end(state, "succeeded");

        return;
      }

      end(
        state,
        "failed",
        status === "UPDATE_ROLLBACK_FAILED"
          ? "Its rollback failed, leaving it UPDATE_ROLLBACK_FAILED: continue the rollback in CloudFormation before deploying it again"
          : `It ended ${status}${current.StackStatusReason ? `: ${current.StackStatusReason}` : ""}`,
      );

      return;
    }

    // A deploy waits for the stacks it depends on, and is skipped once one of them will not be deployed.
    if (command === "deploy") {
      const blocking = stack.spec.dependencies.map((id) => byId.get(id)).filter((dependency) => dependency !== undefined);
      const lost = blocking.find((dependency) => ENDS.has(dependency.status) && dependency.status !== "succeeded" && dependency.status !== "unchanged");

      if (lost) {
        end(state, "skipped", `${lost.name} was not deployed`);

        return;
      }

      if (blocking.some((dependency) => dependency.status !== "succeeded" && dependency.status !== "unchanged")) {
        return;
      }
    }

    if (!changeSet) {
      await plan(state, current);

      return;
    }

    if (changeSet.Status === "CREATE_PENDING" || changeSet.Status === "CREATE_IN_PROGRESS" || (changeSet.Status !== "FAILED" && changeSet.ExecutionStatus !== "AVAILABLE" && changeSet.ExecutionStatus !== "OBSOLETE")) {
      return;
    }

    if (changeSet.Status === "FAILED") {
      const empty = isEmptyChangeSet(changeSet.StatusReason);

      await dropPlan(state, current);
      end(state, empty ? "unchanged" : "failed", empty ? undefined : (changeSet.StatusReason ?? "Its change set could not be made"));

      return;
    }

    if (changeSet.ExecutionStatus === "OBSOLETE") {
      end(state, "failed", "The stack changed after its change set was made");

      return;
    }

    for (const line of changeLines(state.name, changeSet.Changes)) {
      ctx.log(line);
    }

    // A diff shows the change set and goes no further.
    if (command === "diff") {
      await dropPlan(state, current);
      end(state, "succeeded", `${(changeSet.Changes ?? []).length} changes`);

      return;
    }

    await state.clients.send(
      new CF.ExecuteChangeSetCommand({ StackName: state.name, ChangeSetName: ctx.changeSet, ClientRequestToken: `${ctx.changeSet}-execute`, DisableRollback: ctx.rollback === false }),
    );
    ctx.log(`squidci: ${state.name}: executing its change set`);
    state.status = "executing";
  };

  for (;;) {
    let throttled = false;

    await Promise.all(
      states
        .filter((state) => !ENDS.has(state.status))
        .map(async (state) => {
          try {
            await advance(state);
          } catch (error) {
            if (isThrottling(error)) {
              throttled = true;

              return;
            }

            // Asking failed, not CloudFormation: asked again next look, unless it is a refusal, which will not change.
            ctx.log(`squidci: ${state.name}: ${errorMessage(error)}`);

            if (state.clients === undefined || /AccessDenied|not authorized/i.test(errorMessage(error))) {
              end(state, "failed", errorMessage(error).slice(0, 300));
            }
          }
        }),
    );

    if (states.every((state) => ENDS.has(state.status))) {
      break;
    }

    await ctx.sleep(throttled ? THROTTLED_POLL_MS : POLL_MS);
  }

  const outputs = {};

  if (command === "deploy") {
    for (const state of states.filter((one) => one.status === "succeeded" || one.status === "unchanged")) {
      try {
        const answer = await state.clients.send(new CF.DescribeStacksCommand({ StackName: state.name }));

        for (const output of answer.Stacks?.[0]?.Outputs ?? []) {
          const name = outputName(state.id, output.OutputKey ?? "");
          const value = output.OutputValue ?? "";

          if (value.length > 1024 || value.includes("\n") || Object.keys(outputs).length >= 50) {
            ctx.log(`squidci: ${name} was not exported: over a job's limits`);
          } else {
            outputs[name] = value;
          }
        }
      } catch (error) {
        ctx.log(`squidci: ${state.name}: could not read its outputs: ${errorMessage(error)}`);
      }
    }
  }

  return { stacks: states.map((state) => ({ name: state.name, status: state.status, reason: state.reason })), outputs };
};

/** AWS as the step reaches it: each stack's target's profile, which assumes its ci role, then the stack's deploy role. */
const realAws = async () => {
  const CF = await import("@aws-sdk/client-cloudformation");
  const { STSClient, AssumeRoleCommand } = await import("@aws-sdk/client-sts");
  const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
  const session = `squidci-${process.env.SQUIDCI_JOB_ID ?? "cdk"}`.slice(0, 64);

  return {
    cf: CF,
    async clientsFor(stack) {
      const sts = new STSClient({ region: stack.region, profile: stack.target.name });
      const ci = await sts.config.credentials();
      let credentials = ci;

      if (stack.deployRoleArn !== undefined) {
        const answer = await sts.send(new AssumeRoleCommand({ RoleArn: stack.deployRoleArn, RoleSessionName: session, DurationSeconds: 3600 }));

        credentials = { accessKeyId: answer.Credentials.AccessKeyId, secretAccessKey: answer.Credentials.SecretAccessKey, sessionToken: answer.Credentials.SessionToken };
      }

      const cfn = new CF.CloudFormationClient({ region: stack.region, credentials });
      const ssm = new SSMClient({ region: stack.region, credentials });

      return {
        send: (command) => cfn.send(command),
        async bootstrapVersion(name) {
          try {
            const value = (await ssm.send(new GetParameterCommand({ Name: name }))).Parameter?.Value;

            return value === undefined ? null : Number(value);
          } catch (error) {
            if (errorName(error) === "ParameterNotFound") {
              return null;
            }

            throw error;
          }
        },
      };
    },
  };
};

const main = async () => {
  const { command } = squidci.input;
  const patterns = (squidci.input.stacks ?? []).map((pattern) => expand(pattern));
  const parameters = squidci.input.parameters === undefined ? undefined : Object.fromEntries(Object.entries(squidci.input.parameters).map(([key, value]) => [key, expand(value)]));
  const targets = process.env.AWS_CONFIG_FILE ? targetsOf(readFileSync(process.env.AWS_CONFIG_FILE, "utf8")) : [];
  const chosen = select(squidci.published, patterns, targets);

  if ("refused" in chosen) {
    throw new Error(`squidci: cannot ${command}: ${chosen.refused}`);
  }

  const aws = await realAws();
  const result = await run(
    command,
    chosen.stacks.map((spec) => resolveStack(spec, targets)),
    {
      ...aws,
      changeSet: `squidci-${process.env.SQUIDCI_JOB_ID ?? Date.now()}`,
      parameters,
      rollback: squidci.input.rollback,
      log: (line) => console.log(line),
      now: () => new Date(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
  );

  if (process.env.SQUIDCI_OUTPUT) {
    for (const [name, value] of Object.entries(result.outputs)) {
      appendFileSync(process.env.SQUIDCI_OUTPUT, `${name}=${value}\n`);
    }
  }

  const failed = result.stacks.filter((stack) => stack.status === "failed" || stack.status === "skipped");

  if (failed.length > 0) {
    throw new Error(`squidci: ${failed.length} of ${result.stacks.length} stacks ${command === "destroy" ? "were not deleted" : "failed"}: ${failed.map((stack) => `${stack.name} (${stack.reason ?? stack.status})`).join("; ")}`);
  }
};

// Run as a step, where the cell has defined squidci; imported by its tests, where it has not.
if (typeof squidci !== "undefined") {
  await main();
}
