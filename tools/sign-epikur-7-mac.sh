#!/usr/bin/env bash
# Signs the unsigned Epikur 7.0 app as data: Developer ID with hardened runtime, notarization and a
# stapled ticket on both the app and the DMG, then a Gatekeeper check of each.
#
#   tools/sign-epikur-7-mac.sh <unsigned Epikur.app.zip> <output directory>
#
# Needs CSC_LINK (base64 .p12 or a path), CSC_KEY_PASSWORD, APPLE_API_KEY (.p8 content, base64 or a
# path), APPLE_API_KEY_ID, APPLE_API_ISSUER, RELEASE_VERSION and SOURCE_SHA. No candidate code runs here.
set -euo pipefail
umask 077

input_zip="$1"
output_dir="$2"
bundle_id="dk.epikur.desktop70"
work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/epikur7-signing.XXXXXX")"
keychain="$work/signing.keychain-db"
keychain_password="$(openssl rand -hex 24)"
original_keychains="$(security list-keychains -d user | tr -d '"' | xargs)"
cleanup() {
  # shellcheck disable=SC2086
  security list-keychains -d user -s $original_keychains 2>/dev/null || true
  security delete-keychain "$keychain" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

for name in CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER RELEASE_VERSION SOURCE_SHA; do
  test -n "${!name:-}" || { printf '%s is missing.\n' "$name"; exit 1; }
done
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'RELEASE_VERSION is not x.y.z.\n'; exit 1; }

# ---------------------------------------------------------------- the app, strictly as data

mkdir "$work/in"
ditto -x -k "$input_zip" "$work/in"
test "$(find "$work/in" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" = 1 || { printf 'The archive must hold only Epikur.app.\n'; exit 1; }
app="$work/in/Epikur.app"
test -d "$app" && test ! -L "$app"
plist="$app/Contents/Info.plist"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")" = "$bundle_id"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")" = "$RELEASE_VERSION"
app_real="$(realpath "$app")"
if find "$app" -type l | while IFS= read -r link; do
  target="$(cd "$(dirname "$link")" && realpath "$(readlink "$link")" 2> /dev/null || true)"
  case "$target" in "$app_real"/*) ;; *) printf 'outside\n' ;; esac
done | grep -q .; then
  printf 'The app holds a link that points outside the bundle.\n'; exit 1
fi
printf 'Unsigned app %s checked.\n' "$RELEASE_VERSION"

# ---------------------------------------------------------------- credentials

p12="$work/identity.p12"
if test -f "$CSC_LINK"; then cp "$CSC_LINK" "$p12"; else printf '%s' "$CSC_LINK" | base64 --decode > "$p12"; fi
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 7200 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$p12" -k "$keychain" -P "$CSC_KEY_PASSWORD" -T /usr/bin/codesign > /dev/null
rm -f "$p12"
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" > /dev/null
# shellcheck disable=SC2086
security list-keychains -d user -s "$keychain" $original_keychains
identity="$(security find-identity -v -p codesigning "$keychain" | awk '/Developer ID Application/ {print $2; exit}')"
test -n "$identity" || { printf 'No Developer ID Application identity in CSC_LINK.\n'; exit 1; }
team="$(security find-certificate -c "Developer ID Application" -p "$keychain" | openssl x509 -noout -subject | sed -n 's/.*OU *= *\([A-Z0-9]*\).*/\1/p')"

api_key="$work/AuthKey.p8"
if test -f "$APPLE_API_KEY"; then cp "$APPLE_API_KEY" "$api_key"
elif [[ "$APPLE_API_KEY" == *"BEGIN PRIVATE KEY"* ]]; then printf '%s\n' "$APPLE_API_KEY" > "$api_key"
else printf '%s' "$APPLE_API_KEY" | base64 --decode > "$api_key"; fi
grep -q "BEGIN PRIVATE KEY" "$api_key" || { printf 'APPLE_API_KEY is not a .p8 key.\n'; exit 1; }
printf 'Developer ID identity for team %s imported into a temporary keychain.\n' "$team"

notarize() {
  local file="$1" result="$work/notarization.json" id
  xcrun notarytool submit "$file" --key "$api_key" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" \
    --wait --timeout 45m --output-format json > "$result"
  id="$(jq -r '.id' "$result")"
  if ! jq -e '.status == "Accepted"' "$result" > /dev/null; then
    printf 'Apple rejected %s (%s, %s).\n' "$(basename "$file")" "$id" "$(jq -r '.status' "$result")" >&2
    xcrun notarytool log "$id" --key "$api_key" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" \
      | jq -r '.issues[]? | "\(.severity): \(.message) \(.path // "")"' | head -20 >&2 || true
    exit 1
  fi
  printf '%s' "$id"
}

# ---------------------------------------------------------------- sign the app inside out

entitlements="$work/entitlements.plist"
cat > "$entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict>
</plist>
PLIST

sign() {
  codesign --force --timestamp --options runtime --entitlements "$entitlements" --keychain "$keychain" --sign "$identity" "$1" > /dev/null 2>&1 \
    || { printf 'codesign failed on %s\n' "${1#"$work/in/"}" >&2; exit 1; }
}
# A bundle's own executable is signed with the bundle, never alone: codesign checks what is nested inside it.
bundles="$work/bundles.txt"
find "$app/Contents" -type d \( -name '*.framework' -o -name '*.app' -o -name '*.xpc' \) -print > "$bundles"
is_bundle_executable() {
  local file="$1" bundle
  test "$file" = "$app/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")" && return 0
  while IFS= read -r bundle; do
    case "$bundle" in
      *.framework) test "$file" = "$bundle/Versions/A/$(basename "$bundle" .framework)" && return 0 ;;
      *) test -f "$bundle/Contents/Info.plist" \
           && test "$file" = "$bundle/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$bundle/Contents/Info.plist")" && return 0 ;;
    esac
  done < "$bundles"
  return 1
}
# Every loose Mach-O file and every nested bundle, deepest first, so nothing is signed before what it contains.
targets="$work/targets.txt"
: > "$targets"
while IFS= read -r -d '' file; do
  file -b "$file" | grep -q 'Mach-O' || continue
  is_bundle_executable "$file" || printf '%s\n' "$file" >> "$targets"
done < <(find "$app/Contents" -type f -print0)
cat "$bundles" >> "$targets"
awk -F/ '{print NF "\t" $0}' "$targets" | sort -rn | cut -f2- | while IFS= read -r target; do sign "$target"; done
sign "$app"
codesign --verify --deep --strict "$app"
printf 'App signed with hardened runtime.\n'

ditto -c -k --keepParent "$app" "$work/app-notarize.zip"
app_ticket="$(notarize "$work/app-notarize.zip")"
xcrun stapler staple -q "$app"
xcrun stapler validate -q "$app"
spctl --assess --type execute "$app"
printf 'App notarized (%s), stapled and accepted by Gatekeeper.\n' "$app_ticket"

# ---------------------------------------------------------------- the DMG

stage="$work/dmg"
mkdir "$stage"
ditto "$app" "$stage/Epikur.app"
ln -s /Applications "$stage/Programmer"
chmod 755 "$stage"
mkdir -p "$output_dir"
dmg="$output_dir/Epikur.dmg"
rw="$work/rw.dmg"
hdiutil create -quiet -volname Epikur -srcfolder "$stage" -fs HFS+ -format UDRW -ov "$rw"
# Finder layout: the app on the left, the Programmer folder on the right. Cosmetic, so it may fail.
mount_dir="$(hdiutil attach -readwrite -noverify -noautoopen "$rw" | awk -F'\t' '/\/Volumes\// {print $NF; exit}')"
if test -f "$app/Contents/Resources/icon.icns"; then
  cp "$app/Contents/Resources/icon.icns" "$mount_dir/.VolumeIcon.icns"
  chmod 644 "$mount_dir/.VolumeIcon.icns"
  SetFile -a C "$mount_dir" 2> /dev/null || true
fi
osascript > /dev/null 2>&1 <<APPLESCRIPT || printf 'Finder layout skipped.\n'
with timeout of 60 seconds
  tell application "Finder"
    tell disk "Epikur"
      open
      set current view of container window to icon view
      set toolbar visible of container window to false
      set statusbar visible of container window to false
      set the bounds of container window to {200, 120, 740, 460}
      set icon size of icon view options of container window to 112
      set arrangement of icon view options of container window to not arranged
      set position of item "Epikur.app" of container window to {140, 160}
      set position of item "Programmer" of container window to {400, 160}
      close
    end tell
  end tell
end timeout
APPLESCRIPT
sync
hdiutil detach -quiet "$mount_dir" || hdiutil detach -quiet -force "$mount_dir"
hdiutil convert -quiet "$rw" -format UDZO -imagekey zlib-level=9 -ov -o "$dmg"
codesign --timestamp --keychain "$keychain" --sign "$identity" "$dmg"
dmg_ticket="$(notarize "$dmg")"
xcrun stapler staple -q "$dmg"
xcrun stapler validate -q "$dmg"
spctl --assess --type open --context context:primary-signature "$dmg"
printf 'DMG notarized (%s), stapled and accepted by Gatekeeper.\n' "$dmg_ticket"

# ---------------------------------------------------------------- receipt

(cd "$output_dir" && shasum -a 256 Epikur.dmg > Epikur.dmg.sha256)
jq -n --arg version "$RELEASE_VERSION" --arg source "$SOURCE_SHA" --arg bundle "$bundle_id" --arg team "$team" \
  --arg app_ticket "$app_ticket" --arg dmg_ticket "$dmg_ticket" --arg sha "$(cut -d' ' -f1 "$output_dir/Epikur.dmg.sha256")" \
  '{app: "Epikur", version: $version, sourceSha: $source, bundleId: $bundle, teamId: $team, architectures: ["arm64", "x86_64"],
    notarization: {app: $app_ticket, dmg: $dmg_ticket, status: "Accepted"}, dmgSha256: $sha,
    checks: {developerId: true, hardenedRuntime: true, strictDeepSignature: true, stapledTicket: true, gatekeeper: true}}' \
  > "$output_dir/signing-receipt.json"
printf 'Epikur %s for Mac is ready: %s\n' "$RELEASE_VERSION" "$(cut -d' ' -f1 "$output_dir/Epikur.dmg.sha256")"
