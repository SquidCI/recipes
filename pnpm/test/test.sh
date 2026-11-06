# test/bin/nvm echoes its arguments; test/bin/pnpm its argument count and arguments.
tmp=$(mktemp -d)
mkdir "$tmp/app"
expect "$(cd "$tmp/app" && setup 2>&1)" "$(printf '\n$ pnpm install --frozen-lockfile\npnpm 2 install --frozen-lockfile')"

echo 22 > "$tmp/.nvmrc"
expect "$(cd "$tmp/app" && setup 2>&1)" "$(printf '\n$ nvm install\nnvm install\n\n$ pnpm install --frozen-lockfile\npnpm 2 install --frozen-lockfile')"

rm "$tmp/.nvmrc"
echo '20.1.0 ' > "$tmp/.node-version"
expect "$(cd "$tmp/app" && setup 2>&1)" "$(printf '\n$ nvm install 20.1.0\nnvm install 20.1.0\n\n$ pnpm install --frozen-lockfile\npnpm 2 install --frozen-lockfile')"

expect "$(step args='run build -- --mode "a b"' 2>&1)" "pnpm 5 run build -- --mode a b"
rm -r "$tmp"
