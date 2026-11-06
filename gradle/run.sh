# ./gradlew from the build's root. A planner lists its Test tasks' classes through init.gradle and runs
# none; a parallel job runs only the Test tasks among its groups, on past a failed one and without the
# configuration cache, which cannot keep the listener that marks its units done.
cd "${squidci_input_dir:-.}"
squidci_gradlew || return 1
squidci_gradle_args=(--console=plain)
case "${SQUIDCI_SPLIT_ROLE:-}" in
  planner) squidci_gradle_args+=(--init-script "$SQUIDCI_RECIPE_DIR/init.gradle") ;;
  shard) squidci_gradle_args+=(--init-script "$SQUIDCI_RECIPE_DIR/init.gradle" --continue --no-configuration-cache) ;;
esac
# The live reporter's init script, where the agent mounted it: two words or none.
squidci_gradle_args+=(${squidci_gradle_tests:-})
if [ "${SQUIDCI_SPLIT_ROLE:-}" = shard ]; then
  ./gradlew "${squidci_gradle_args[@]}" $SQUIDCI_SPLIT_GROUPS
else
  eval "./gradlew \"\${squidci_gradle_args[@]}\" $squidci_input_run"
fi
