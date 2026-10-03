#!/bin/sh
# Applies the Sofia Claw3D patch chain to a clean Claw3D checkout (cwd).
# Usage: sh apply-chain.sh <patch-dir> [last-stage]
#   last-stage: v2.1 .. v3.4.1 (default: v3.4; v3.4.1 is staging opt-in)
# Stages up to v2.7 are node scripts (anchored replacements); from v2.8 on a
# stage may be a unified diff or a guarded node patch.
set -eu
DIR="${1:?patch dir required}"
LAST="${2:-v3.4}"

run_env_patch() {
  name="$1"
  eval "body=\${$name:-}"
  if [ -n "$body" ]; then
    printf '%s' "$body" > "/tmp/sofia-$name.js"
    node "/tmp/sofia-$name.js"
    rm -f "/tmp/sofia-$name.js"
  else
    echo "SOFIA_CHAIN: $name not set, skipped"
  fi
}

node "$DIR/patch-building-v1.js"
run_env_patch SOFIA_STORAGE_FIX_JS
run_env_patch SOFIA_SETTINGS_FIX_JS
run_env_patch SOFIA_HEALTH_PATCH_JS
node "$DIR/patch-health.js"
node "$DIR/patch-ops-v2.js"
node "$DIR/patch-ops-v2.1.js"
for stage in v2.2 v2.3 v2.4 v2.5 v2.6 v2.7 v2.8 v2.9 v2.9.1 v3.0 v3.0.1 v3.1 v3.2 v3.2.1 v3.3 v3.4 v3.4.1; do
  case "$LAST" in v2.1) break ;; esac
  [ "$stage" = "v2.6" ] && sh "$DIR/fetch-assets.sh"
  if [ -f "$DIR/patch-ops-$stage.js" ]; then
    node "$DIR/patch-ops-$stage.js"
  else
    patch -p1 --forward --batch --no-backup-if-mismatch < "$DIR/patch-ops-$stage.diff"
    echo "SOFIA_CHAIN: $stage diff applied"
  fi
  [ "$stage" = "$LAST" ] && break
done
echo "SOFIA_CHAIN_OK: applied through $LAST"
