# Runs run.mjs, the Lambda step, with this step's fields as its input.
export squidci_input_provider squidci_input_agent squidci_input_agent_environment squidci_input_prompt squidci_input_title \
  squidci_input_organization squidci_input_service_account squidci_input_federation_rule squidci_input_workspace
SQUIDCI_AGENT_VAULTS=$(printf '%s\n' "${squidci_input_vaults[@]}")
export SQUIDCI_AGENT_VAULTS
node "$SQUIDCI_RECIPE_DIR/ec2.mjs"
