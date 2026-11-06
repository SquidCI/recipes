# docker

**`docker: {image, tag}`** builds the Dockerfile in the step's base as
`image:tag` and pushes it.

```yaml
components:
  web:
    base: web
    build:
      steps:
        - docker: {image: <registry>/web, tag: $SQUIDCI_FINGERPRINT, push: false}
    publish:
      steps:
        - docker: {image: <registry>/web, tag: $SQUIDCI_FINGERPRINT, from: build}
```

- `image` is a repository, `[registry/]name`, and `tag` its tag. The tag
  may name variables, `$NAME` or `${NAME}`, which the job's shell expands:
  `$SQUIDCI_FINGERPRINT` is the usual one. One that expands to no tag fails
  the step, saying what it became.
- `push: false` builds the image and pushes nothing. In a `build`, the
  image is also staged in the plane's own repository, and the build records
  where. A pull request's run stages nothing.
- `from: build` pushes the image a build staged, exactly as it was built,
  and builds nothing: the build of the component's own, for its `publish`,
  `run` or `deploy`, or of a component it `needs`, with the same
  `image:tag`. Two images in one component are each found by their own
  `image:tag`. With nothing recorded for it, the step fails. Without
  `from`, a push always builds. Not with `push: false`, `build`, `context`,
  `file`, `args` or `secrets`.
- `skip-existing: true` builds and pushes nothing when `image:tag` is
  already in the registry, and exports what is there. A push that fails
  looks again, so a tag another run pushed meanwhile counts as there. For
  tags that never move, such as `$SQUIDCI_FINGERPRINT`: on `latest` it keeps
  the first image for good. Not with `push: false`, and a tag that is an
  index of several images fails the step.
- A push to ECR Public or a private ECR registry logs in first with the
  job's AWS access, which its `aws` gives; anything else is logged into by a
  step before it. A push exports the image's `digest`, `mediaType`, `size`
  and `architecture`.
- Each build caches from the tag's current image, and from `latest`.

## Another Dockerfile, arguments and secrets

- `context` is the build context and `file` the Dockerfile, each written
  from the repository's root: `context: frontend`, `file:
  frontend/Dockerfile`. Docker finds `.dockerignore` beside the file, as
  `<file>.dockerignore`, or at the context's root. A Dockerfile outside the component's `base` belongs
  in its `sources`, or a change to it alone leaves the component unchanged.
- `args` is a map of build arguments, whose values may name variables as
  `tag` does. An argument is kept in the image's history: a secret goes in
  `secrets`.
- `secrets` names imported secrets the build may read with
  `RUN --mount=type=secret,id=NAME`. A pull request's job has none and
  passes none.

## A build command

`build` is a command run from the base in place of a Dockerfile:
`./gradlew bootBuildImage --imageName=$SQUIDCI_IMAGE`, `pack`, Jib, `ko`,
on one line, in a subshell, so its `cd` or `export` reaches no later step.
It must leave `$SQUIDCI_IMAGE`, `image:tag`, in the job's daemon, which it
finds at the default socket; the step then pushes or stages it as it would
a Dockerfile's. Not with `context`, `file`, `args` or `secrets`.

The runner image has Docker. A Debian or Ubuntu image without it gets it
installed, and the daemon started, before the first step. A Lambda job has
no Docker, so no docker step.
