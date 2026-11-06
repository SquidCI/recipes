# Node as the repository pins it, .nvmrc or .node-version, looked for from
# here up; the image's default when nothing pins one. Then the lockfile, exactly.
squidci_pnpm_dir=$PWD
while :; do
  if [ -f "$squidci_pnpm_dir/.nvmrc" ]; then
    squidci_step 'nvm install'
    nvm install
    break
  fi
  if [ -f "$squidci_pnpm_dir/.node-version" ]; then
    squidci_pnpm_version=$(tr -d '[:space:]' < "$squidci_pnpm_dir/.node-version")
    squidci_step "nvm install $squidci_pnpm_version"
    nvm install "$squidci_pnpm_version"
    break
  fi
  [ "$squidci_pnpm_dir" = / ] && break
  squidci_pnpm_dir=$(dirname "$squidci_pnpm_dir")
done
unset squidci_pnpm_dir squidci_pnpm_version
squidci_step 'pnpm install --frozen-lockfile'
pnpm install --frozen-lockfile
