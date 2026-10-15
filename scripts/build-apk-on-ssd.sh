#!/bin/bash
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
SSD='/Volumes/SSD Files/SOLAO/market-order-system'
# Caller supplies the UUID from the latest successful SSD verification.
# This invocation uses Claude's 2026-10-15 21:17:23 rc=0 evidence, as requested.
if [[ "${SOLAO_SSD_VERIFIED_UUID:-}" != 'AEFCEAC9-3AFD-46A4-9EFE-2785ACC83E0B' ]]; then
  echo 'Missing verified SSD UUID; stop and obtain SSD verification before building.' >&2
  exit 1
fi
[[ -d "$SSD/runs" && -d "$SSD/cache" ]] || { echo 'Verified SSD folders unavailable' >&2; exit 1; }
/sbin/mount | /usr/bin/grep -F ' on /Volumes/SSD Files (' >/dev/null || { echo 'SSD is not mounted' >&2; exit 1; }
FREE_KB=$(df -Pk "$SSD" | awk 'NR==2 {print $4}')
[[ "$FREE_KB" -gt 5242880 ]] || { echo 'SSD has less than 5 GiB free' >&2; exit 1; }
STAMP=$(date '+%Y%m%d-%H%M%S')
RUN="$SSD/runs/apk-build/$STAMP-$$"
REPORT="$SSD/reports/receiving-apk-codex"
mkdir -p "$RUN" "$REPORT" "$SSD/tmp/apk" "$SSD/cache/npm" "$SSD/cache/gradle" "$SSD/cache/android/.android"
export TMPDIR="$SSD/tmp/apk"
export npm_config_cache="$SSD/cache/npm"
export GRADLE_USER_HOME="$SSD/cache/gradle"
export ANDROID_USER_HOME="$SSD/cache/android/.android"
export ANDROID_PREFS_ROOT="$SSD/cache/android"
export ANDROID_SDK_HOME="$SSD/cache/android"
export SOLAO_DEBUG_KEYSTORE="$SSD/cache/android/debug.keystore"
export JAVA_HOME='/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home'
export ANDROID_HOME='/opt/homebrew/share/android-commandlinetools'
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"
export JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=\"$TMPDIR\" -Duser.language=en -Duser.country=US"
# SDK downloads and new license acceptance are forbidden for this build.
rsync -a --exclude='.git' --exclude='.env*' --exclude='node_modules' \
  --exclude='build' --exclude='.gradle' --exclude='dist' --exclude='dist-receiving' \
  --exclude='local.properties' --exclude='*.keystore' --exclude='*.jks' \
  --exclude='*.db' --exclude='*.sqlite*' --exclude='uploads' --exclude='logs' \
  --exclude='google-services.json' --exclude='.npmrc' --exclude='.aws' \
  "$SOURCE/" "$RUN/"
printf '%s\n' "$RUN" > "$REPORT/latest-run.txt"
build_debug() {
cd "$RUN/client"
npm ci --no-audit --no-fund
npm run test:receiving-app
npm run build:receiving
npx --no-install cap sync android
cd android
./gradlew --no-daemon -Dorg.gradle.java.installations.auto-download=false \
  -Dandroid.builder.sdkDownload=false assembleDebug
APK="$RUN/client/android/app/build/outputs/apk/debug/app-debug.apk"
AAPT="$ANDROID_HOME/build-tools/36.0.0/aapt2"
"$AAPT" dump badging "$APK" > "$RUN/apk-badging.txt"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify "$APK"
cp "$APK" "$REPORT/receiving-debug.apk"
(cd "$REPORT" && shasum -a 256 receiving-debug.apk > receiving-debug.apk.sha256)
cp "$RUN/apk-badging.txt" "$REPORT/apk-badging.txt"
stat -f 'APK size: %z bytes' "$REPORT/receiving-debug.apk"
cat "$REPORT/receiving-debug.apk.sha256"
printf 'APK: %s\nBuild evidence: %s\n' "$REPORT/receiving-debug.apk" "$RUN"
}
build_debug 2>&1 | tee "$RUN/build.log"
