#!/usr/bin/env bash
set -euo pipefail
umask 077
key_file="$(mktemp "$RUNNER_TEMP/epikur-source-key.XXXXXX")"
known_hosts="$(mktemp "$RUNNER_TEMP/epikur-known-hosts.XXXXXX")"
trap 'rm -f "$key_file" "$known_hosts"' EXIT
test -n "$SOURCE_DEPLOY_KEY"
printf '%s\n' "$SOURCE_DEPLOY_KEY" > "$key_file"
unset SOURCE_DEPLOY_KEY
test -n "$GH_TOKEN"
curl --fail --silent --show-error --retry 3 --connect-timeout 15 --max-time 60 --header "Authorization: Bearer $GH_TOKEN" https://api.github.com/meta | jq -er '.ssh_keys[] | "github.com " + .' > "$known_hosts"
unset GH_TOKEN
printf -v key_argument '%q' "$key_file"
printf -v hosts_argument '%q' "$known_hosts"
export GIT_SSH_COMMAND="ssh -i $key_argument -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$hosts_argument"
log_file="$RUNNER_TEMP/private-source-checkout.log"
if test "${FETCH_MODE:-checkout}" = history; then
  git clone --bare --filter=blob:none git@github.com:epikurai/epikur_2.0.git "$SOURCE_PATH" > "$log_file" 2>&1
  printf 'Private source ancestry metadata fetched.\n'
  exit 0
fi
git clone --filter=blob:none --no-checkout git@github.com:epikurai/epikur_2.0.git "$SOURCE_PATH" > "$log_file" 2>&1
git -C "$SOURCE_PATH" fetch origin "$SOURCE_SHA" >> "$log_file" 2>&1
git -C "$SOURCE_PATH" merge-base --is-ancestor "$SOURCE_SHA" origin/main
test "$(git -C "$SOURCE_PATH" rev-parse "$SOURCE_SHA^{tree}")" = "$SOURCE_TREE"
if test "${REQUIRE_SOURCE_MAIN_HEAD:-false}" = true; then
  test "$(git -C "$SOURCE_PATH" rev-parse origin/main)" = "$SOURCE_SHA"
fi
if test "${FETCH_MODE:-checkout}" = inspect; then
  printf 'Private source commit, Git tree and main ancestry verified.\n'
  exit 0
fi
git -C "$SOURCE_PATH" checkout --detach "$SOURCE_SHA" >> "$log_file" 2>&1
test "$(git -C "$SOURCE_PATH" rev-parse HEAD)" = "$SOURCE_SHA"
test -z "$(git -C "$SOURCE_PATH" status --porcelain)"
git -C "$SOURCE_PATH" fetch origin "$TRUSTED_SIGNER_SHA" >> "$log_file" 2>&1
git -C "$SOURCE_PATH" worktree add --detach "$SIGNER_PATH" "$TRUSTED_SIGNER_SHA" >> "$log_file" 2>&1
test "$(git -C "$SIGNER_PATH" rev-parse HEAD)" = "$TRUSTED_SIGNER_SHA"
printf 'Candidate data and pinned signer fetched; read-only key removed before subsequent steps.\n'
