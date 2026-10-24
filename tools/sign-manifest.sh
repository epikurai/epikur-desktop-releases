#!/usr/bin/env bash
set -euo pipefail
umask 077
key_file="$RUNNER_TEMP/manifest-signing.pem"
trap 'rm -f "$key_file"' EXIT
test -n "$MANIFEST_KEY"
printf '%s\n' "$MANIFEST_KEY" > "$key_file"
unset MANIFEST_KEY
chmod 600 "$key_file"
filename="Epikur-$RELEASE_VERSION-darwin-arm64.zip"
if test "$RELEASE_CHANNEL" = qa; then filename="Epikur-QA-$RELEASE_VERSION-darwin-arm64.zip"; fi
artifact_url="https://github.com/epikurai/epikur-desktop-releases/releases/download/$RELEASE_TAG/$filename"
feed_url="https://raw.githubusercontent.com/epikurai/epikur-desktop-releases/feeds/channels/$RELEASE_CHANNEL.json"
node "$SIGNER_PATH/desktop-app/scripts/desktop-release-manifest.cjs" \
  --receipt "$RELEASE_DIRECTORY/desktop-release.json" --trust "$TRUST_FILE" \
  --artifact-url "$artifact_url" --feed-url "$feed_url" \
  --key-file "$key_file" --key-id "epikur-desktop-$RELEASE_CHANNEL" \
  --release-id "$RELEASE_ID" --output "$RELEASE_DIRECTORY/manifest.json"
