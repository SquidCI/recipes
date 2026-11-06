# squidci_gradlew: the build's root has the wrapper and it runs, or the step fails saying what to commit.
squidci_gradlew() {
  if [ ! -f gradlew ]; then
    echo "squidci: there is no gradlew in $PWD: a gradle step runs the project's wrapper, so commit it (gradle wrapper), or set the step's dir to where it is" >&2
    return 1
  fi
  if [ ! -x gradlew ]; then
    echo "squidci: gradlew in $PWD is not executable: commit it as executable, with git update-index --chmod=+x gradlew" >&2
    return 1
  fi
}
