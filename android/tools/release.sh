#!/usr/bin/env bash
#
# Publish Tubcal for Android as a GitHub release: what `tubcal phone` and the
# installer put on a phone.
#
#   tools/release.sh             build, then publish release phone-v<versionName>
#   tools/release.sh --dry-run   build and write the two files; publish nothing
#
# The release holds two files, which install.sh reads from
# releases/latest/download/ (so the release is marked latest):
#   tubcal-phone.apk   the debug build: debuggable, so tools/sync-data.sh can
#                      reach its database with run-as
#   tubcal-phone.txt   version, versionCode, sha256, size, minimum SDK and the
#                      ABIs it's built for, read line by line by install.sh
#
# Before a release, raise versionCode and versionName in app/build.gradle.kts:
# a phone only takes an update with a higher versionCode, and the tag is
# phone-v<versionName>. The tag points at HEAD, which has to be committed and
# pushed, so the source of every published APK is on GitHub (GPL-3.0).
#
# Every release must be signed with the same key, or phones can't update in
# place. Today that's the debug key of the machine that builds it
# (~/.android/debug.keystore): build releases on that machine.
set -euo pipefail

HERE=$(cd "$(dirname "$0")/.." && pwd) # android/
ROOT=$(cd "$HERE/.." && pwd)
OUT=$HERE/app/build/release
export ANDROID_HOME=${ANDROID_HOME:-$HOME/Android/Sdk}

DRY=0
case ${1:-} in
  --dry-run) DRY=1 ;;
  -h|--help) sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "") ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

die() { echo "release: $*" >&2; exit 1; }
git() { command git -C "$ROOT" "$@"; }

if ((!DRY)); then
  command -v gh >/dev/null || die "the GitHub CLI (gh) is needed to publish"
  [[ -z $(git status --porcelain --untracked-files=no) ]] || die "commit your changes first: the release is built from HEAD"
  git fetch -q origin
  [[ -n $(git branch -r --contains HEAD) ]] || die "push HEAD first: the release's tag points at it"
fi

echo "building…"
(cd "$HERE" && ./gradlew -q :app:assembleDebug)
APK=$HERE/app/build/outputs/apk/debug/app-debug.apk

# What the APK itself says, from the newest build-tools' aapt2.
AAPT=$(ls -d "$ANDROID_HOME"/build-tools/*/ 2>/dev/null | sort -V | tail -n 1)aapt2
[[ -x $AAPT ]] || die "no aapt2 under $ANDROID_HOME/build-tools"
badging=$("$AAPT" dump badging "$APK")
pkg=$(sed -nE "s/^package: name='([^']+)'.*/\1/p" <<<"$badging")
version=$(sed -nE "s/^package: .*versionName='([^']+)'.*/\1/p" <<<"$badging")
code=$(sed -nE "s/^package: .*versionCode='([0-9]+)'.*/\1/p" <<<"$badging")
min_sdk=$(sed -nE "s/^(minSdkVersion|sdkVersion):'([0-9]+)'.*/\2/p" <<<"$badging" | head -n 1)
abis=$(sed -nE "s/^native-code: //p" <<<"$badging" | tr -d "'")
[[ $pkg == com.tubcal.app && -n $version && -n $code && -n $min_sdk && -n $abis ]] ||
  die "couldn't read the APK's package, version, SDK or ABIs"

mkdir -p "$OUT"
cp "$APK" "$OUT/tubcal-phone.apk"
cat >"$OUT/tubcal-phone.txt" <<EOF
# Tubcal for Android: the build \`tubcal phone\` installs (android/tools/release.sh)
version=$version
code=$code
sha256=$(sha256sum "$OUT/tubcal-phone.apk" | cut -d' ' -f1)
size=$(stat -c %s "$OUT/tubcal-phone.apk")
min_sdk=$min_sdk
abis=$abis
commit=$(git rev-parse HEAD)
EOF
echo "wrote ${OUT#"$ROOT"/}/tubcal-phone.apk and tubcal-phone.txt:"
sed 's/^/  /' "$OUT/tubcal-phone.txt"
((DRY)) && exit 0

repo=$(cd "$ROOT" && gh repo view --json nameWithOwner -q .nameWithOwner)
tag=phone-v$version
gh release view "$tag" -R "$repo" >/dev/null 2>&1 &&
  die "$tag is already released: raise versionName and versionCode in app/build.gradle.kts"
prev=$(curl -fsSL "https://github.com/$repo/releases/latest/download/tubcal-phone.txt" 2>/dev/null |
  sed -n 's/^code=//p') || prev=""
[[ -z $prev ]] || ((code > prev)) ||
  die "versionCode $code isn't above the last release's ($prev): phones wouldn't take it as an update"

short=$(git rev-parse --short HEAD)
gh release create "$tag" -R "$repo" --target "$(git rev-parse HEAD)" --latest \
  --title "Tubcal for Android $version" \
  --notes "Tubcal for Android $version, built from $short.

Put it on a phone with \`tubcal phone\` (the phone needs USB debugging on), or with \`adb install tubcal-phone.apk\`. It runs the whole of Tubcal on the phone and keeps its own data.

The APK is a debug build of \`android/\` at this tag, under the GPL-3.0-or-later. LICENSE and THIRD_PARTY_NOTICES.md in the source list what it's built from." \
  "$OUT/tubcal-phone.apk" "$OUT/tubcal-phone.txt"
