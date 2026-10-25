#!/usr/bin/env bash
#
# Publish Tubcal for Android as a GitHub release: what `tubcal phone` and the
# installer put on a phone.
#
#   tools/release.sh             build, then publish release phone-v<versionName>
#   tools/release.sh --dry-run   build and write the files; publish nothing
#                                (`tubcal phone --apk app/build/release` installs them)
#
# The release holds these files, which install.sh reads from
# releases/latest/download/ (so the release is marked latest):
#   tubcal-phone-core.apk        the core: the debug build without any room,
#                                debuggable, so tools/sync-data.sh can reach its
#                                database with run-as
#   tubcal-phone-room-<id>.apk   one split APK per room (tools/rooms.py)
#   tubcal-phone.txt             version, versionCode, the core's sha256 and size,
#                                minimum SDK, the ABIs it's built for, the rooms,
#                                and room.<id>=<sha256> <size> for each; read line
#                                by line by install.sh, which streams the core and
#                                the chosen rooms from here to the phone
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
(cd "$HERE" && ./gradlew -q :app:assembleDebug) # and its rooms (assembleRooms)
APK=$HERE/app/build/outputs/apk/debug/app-debug.apk
ROOMS=$HERE/app/build/outputs/rooms

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

rm -rf "$OUT" && mkdir -p "$OUT"
cp "$APK" "$OUT/tubcal-phone-core.apk"
rooms=()
for f in "$ROOMS"/room_*.apk; do
  [[ -e $f ]] || die "no room APKs in ${ROOMS#"$ROOT"/} (tools/rooms.py makes them after the core APK)"
  id=${f##*/room_} id=${id%.apk}
  [[ $("$AAPT" dump badging "$f" | sed -nE "s/^package: .*versionCode='([0-9]+)'.*/\1/p") == "$code" ]] ||
    die "room_$id.apk isn't version $code like the core APK"
  cp "$f" "$OUT/tubcal-phone-room-$id.apk"
  rooms+=("$id")
done
{
  echo "# Tubcal for Android: the build \`tubcal phone\` installs (android/tools/release.sh)"
  echo "version=$version"
  echo "code=$code"
  echo "sha256=$(sha256sum "$OUT/tubcal-phone-core.apk" | cut -d' ' -f1)"
  echo "size=$(stat -c %s "$OUT/tubcal-phone-core.apk")"
  echo "min_sdk=$min_sdk"
  echo "abis=$abis"
  echo "rooms=${rooms[*]}"
  for id in "${rooms[@]}"; do
    echo "room.$id=$(sha256sum "$OUT/tubcal-phone-room-$id.apk" | cut -d' ' -f1) $(stat -c %s "$OUT/tubcal-phone-room-$id.apk")"
  done
  echo "commit=$(git rev-parse HEAD)"
} >"$OUT/tubcal-phone.txt"
echo "wrote ${OUT#"$ROOT"/}: the core APK, ${#rooms[@]} room APKs and tubcal-phone.txt:"
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

Put it on a phone with \`tubcal phone\` (the phone needs USB debugging on). It asks which rooms you want and installs the core APK with those rooms' APKs. By hand: \`adb install-multiple tubcal-phone-core.apk\` followed by the room APKs you want. It runs the whole of Tubcal on the phone and keeps its own data.

The APKs are a debug build of \`android/\` at this tag, under the GPL-3.0-or-later. LICENSE and THIRD_PARTY_NOTICES.md in the source list what they're built from." \
  "$OUT"/tubcal-phone-core.apk "$OUT"/tubcal-phone-room-*.apk "$OUT/tubcal-phone.txt"
