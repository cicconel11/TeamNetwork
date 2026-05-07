#!/usr/bin/env bash
set -euo pipefail

find_sdk_root() {
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    printf '%s\n' "$ANDROID_HOME"
    return 0
  fi

  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    printf '%s\n' "$ANDROID_SDK_ROOT"
    return 0
  fi

  local candidates=(
    "$HOME/Library/Android/sdk"
    "$HOME/Android/Sdk"
    "/opt/homebrew/share/android-commandlinetools"
    "/usr/local/share/android-commandlinetools"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

print_missing_sdk_help() {
  cat >&2 <<'EOF'
Android SDK not found.

Install the local Android toolchain with:
  brew install --cask temurin android-commandlinetools
  export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
  export ANDROID_SDK_ROOT=$ANDROID_HOME
  export PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH
  sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-35" "build-tools;35.0.0"

Then re-run the Expo Android command.
EOF
}

ensure_java() {
  if command -v java >/dev/null 2>&1 && java -version >/dev/null 2>&1; then
    if [[ -z "${JAVA_HOME:-}" ]] && command -v /usr/libexec/java_home >/dev/null 2>&1; then
      export JAVA_HOME="$(/usr/libexec/java_home 2>/dev/null || true)"
    fi
    return 0
  fi

  local homebrew_openjdk="/opt/homebrew/opt/openjdk"
  local homebrew_java_home="$homebrew_openjdk/libexec/openjdk.jdk/Contents/Home"
  if [[ -x "$homebrew_java_home/bin/java" ]]; then
    export JAVA_HOME="$homebrew_java_home"
    export PATH="$homebrew_openjdk/bin:$PATH"
    return 0
  fi

  return 1
}

main() {
  local sdk_root
  if ! sdk_root="$(find_sdk_root)"; then
    print_missing_sdk_help
    exit 1
  fi

  export ANDROID_HOME="$sdk_root"
  export ANDROID_SDK_ROOT="$sdk_root"
  export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

  if ! ensure_java; then
    cat >&2 <<'EOF'
Java not found.

Install a JDK with one of:
  brew install openjdk
  brew install --cask temurin
EOF
    exit 1
  fi

  if ! command -v adb >/dev/null 2>&1; then
    cat >&2 <<EOF
Android platform-tools are not installed for this SDK root.

ANDROID_HOME is set to:
  $ANDROID_HOME

Install the missing Android packages with:
  sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-35" "build-tools;35.0.0"

Then verify:
  $ANDROID_HOME/platform-tools/adb version
  $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --list | head -n 20
EOF
    exit 1
  fi

  if [[ ! -d "$ANDROID_HOME/platforms/android-35" || ! -d "$ANDROID_HOME/build-tools/35.0.0" ]]; then
    cat >&2 <<EOF
Android SDK platform 35 and/or build-tools 35.0.0 are not installed.

ANDROID_HOME is set to:
  $ANDROID_HOME

Install the missing Android packages with:
  sdkmanager --sdk_root=$ANDROID_HOME "platforms;android-35" "build-tools;35.0.0"
EOF
    exit 1
  fi

  exec "$@"
}

main "$@"
