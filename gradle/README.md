# gradle

**`gradle: <args>`** runs `./gradlew <args>` from the component's `base`:
`build`, `check -Pci`, `:app:test`. Or `gradle: {run, dir, split}`.

```yaml
components:
  services:
    base: services/api
    test:
      steps:
        - gradle:
            dir: services        # where settings.gradle and gradlew are
            run: check -Pci
            split: 8             # its tests across at most 8 parallel jobs
```

- `dir` is the build's root, where `settings.gradle` and the wrapper are,
  from the repository's root. The base when left out.
- Always the wrapper, never a `gradle` on the image's `PATH`: it pins the
  project's version, and its distribution lands in the job's build cache,
  `GRADLE_USER_HOME`, with everything else Gradle downloads. A `dir` with no
  `gradlew`, or one that is not executable, fails the step saying so.
- `split` runs the step's tests across parallel jobs: see below.
- `--console=plain` is added, so the log is lines. Its tests are reported
  live.

The runner image has a JDK; an image of your own must bring one.

## split

This job builds everything the command would and runs no tests: every Test
task lists its test classes and stops. SquidCI shares the classes out among
at most `jobs` parallel jobs, each starting from this job's workspace, its
checkout, what it compiled and the dependencies it downloaded, so none
builds again, on pull requests as on the default branch. Each runs only the
Test tasks its classes belong to, filtered to those classes, with
`--continue`. Fewer classes than `jobs` make one parallel job per class,
and none make none.

```yaml
components:
  api:
    base: services/api
    test:
      runner: {vcpus: 4}          # this job, which compiles
      steps:
        - gradle:
            run: build
            dir: services
            split:
              jobs: 8
              runner: {vcpus: 2}  # each parallel job
```

`split: 8` is short for `split: {jobs: 8}`.

| key      | value                                                                             | default                |
|----------|-----------------------------------------------------------------------------------|------------------------|
| `jobs`   | at most this many parallel jobs, 2 to 50                                          | —                      |
| `runner` | what each parallel job reserves where it is not the section's: `vcpus` and `spot` | the section's `runner` |

- **What a parallel job may set.** `vcpus` and `spot`, merged over the
  section's `runner`: `spot: false` keeps them off spot instances, and
  `vcpus` is what each reserves, with the same share of its instance's
  memory, so fewer vCPUs is less memory, which a suite of integration tests
  may need. Not their image or architecture, which are this job's, since
  they start from its workspace.
- **How the classes are shared out.** Longest first, each to the parallel
  job with the least time so far, by how long each class took on the
  default branch over the last two weeks; at random until there is that
  history.
- **One job.** The section is one job on SquidCI and one check on GitHub:
  in progress until every parallel job has ended, failed if one failed,
  naming it, its tests merged from all of them. Its parallel jobs are in a
  tab of its own, each with its own log. Whatever waits for the section,
  `needs`, the component's `publish`, every deploy, waits for every one.
- **Spot instances.** A parallel job whose spot instance is reclaimed hands
  back the classes it finished, and the job that replaces it runs only the
  rest.
- **Where it goes.** A step of a `build`, `check` or `test`, and the only
  `split` of its job.
- **What runs in this job.** The steps before it, and everything the
  command runs but tests: compiling, linting, packaging. A task that reads
  test output, such as JaCoCo's report, finds none here and skips itself.
- **The steps after it** run once every parallel job has succeeded, on the
  workspace this job left, with every parallel job's JUnit XML and JaCoCo
  execution data merged in where Gradle wrote them, so a coverage report or
  Sonar's scanner sees the whole suite. A new shell: a `cd` or `export`
  before the split does not reach them. Ask for a report, not for `test`
  again, which would run those tests in one job. The section's `artifacts`
  are kept from there.
- **Not yet tried with Develocity's test distribution**, which replaces how
  a Test task runs.
