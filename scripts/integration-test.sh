#!/usr/bin/env bash
# scripts/integration-test.sh
#
# Full integration test:
#   1. Compile the TypeScript CLI
#   2. Run the organizer on every file in fixtures/input/
#   3. Diff result against fixtures/expected/ — fail on mismatch
#   4. Copy each organized file into rust-test/src/generated/
#   5. Run `cargo check` to verify the output is valid Rust
#
# Usage:
#   bash scripts/integration-test.sh            # full run
#   bash scripts/integration-test.sh --no-cargo # skip cargo check (faster)
#
# Requirements:
#   - Node.js + npm (already needed for the extension)
#   - Rust + Cargo (only for step 5; skip with --no-cargo)
#
# Exit code: 0 = all good, 1 = any failure

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURES_INPUT="$PROJECT_DIR/fixtures/input"
FIXTURES_EXPECTED="$PROJECT_DIR/fixtures/expected"
RUST_TEST_DIR="$PROJECT_DIR/rust-test"
CLI="node $PROJECT_DIR/out/cli.js"
SKIP_CARGO=false

for arg in "$@"; do
  [[ "$arg" == "--no-cargo" ]] && SKIP_CARGO=true
done

PASS=0
FAIL=0
SKIP=0

# ─── colours ─────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC}  $*"; ((PASS++)) || true; }
fail() { echo -e "  ${RED}✗${NC}  $*"; ((FAIL++)) || true; }
info() { echo -e "  ${YELLOW}→${NC}  $*"; }

# ─── step 1: compile ─────────────────────────────────────────────────────────
echo ""
echo "1. Compiling TypeScript..."
cd "$PROJECT_DIR"
npm run compile --silent 2>&1 | sed 's/^/   /'
if [[ ! -f "$PROJECT_DIR/out/cli.js" ]]; then
  echo -e "${RED}Error: out/cli.js not found after compile${NC}"
  exit 1
fi
ok "compiled successfully"

# ─── step 2 + 3: run organizer and compare ───────────────────────────────────
echo ""
echo "2. Running organizer on fixtures..."

if [[ ! -d "$FIXTURES_INPUT" ]]; then
  info "No fixtures/input/ directory found — skipping"
  ((SKIP++)) || true
else
  GENERATED_DIR="$RUST_TEST_DIR/src/generated"
  mkdir -p "$GENERATED_DIR"

  for input_file in "$FIXTURES_INPUT"/*.rs; do
    [[ -f "$input_file" ]] || continue
    name="$(basename "$input_file" .rs)"
    expected_file="$FIXTURES_EXPECTED/${name}.expected.rs"
    generated_file="$GENERATED_DIR/${name}.rs"

    # Load per-fixture options if any
    options_file="$PROJECT_DIR/fixtures/options/${name}.json"
    extra_args=""
    if [[ -f "$options_file" ]]; then
      # Parse a few well-known options from the JSON — a real impl would use jq
      if command -v jq &>/dev/null; then
        group=$(jq -r '.groupImports // "true"' "$options_file" 2>/dev/null)
        [[ "$group" == "false" ]]    && extra_args="--no-group"
        [[ "$group" == "preserve" ]] && extra_args="--preserve"
        order=$(jq -r '.importOrder // "" | join(",")' "$options_file" 2>/dev/null)
        [[ -n "$order" && "$group" == "custom" ]] && extra_args="--order $order"
        noremove=$(jq -r '.removeUnused // true' "$options_file" 2>/dev/null)
        [[ "$noremove" == "false" ]] && extra_args="$extra_args --no-remove-unused"
      fi
    fi

    # Run the organizer
    actual=$($CLI $extra_args "$input_file" 2>&1) || {
      fail "$name — organizer crashed: $actual"
      continue
    }

    # Write to generated dir (for cargo check)
    echo "$actual" > "$generated_file"

    # Compare against expected snapshot
    if [[ ! -f "$expected_file" ]]; then
      info "$name — no expected file, generating..."
      echo "$actual" > "$expected_file"
      ok "$name — snapshot created"
    elif diff -q <(echo "$actual") "$expected_file" >/dev/null 2>&1; then
      ok "$name"
    else
      fail "$name — output differs from expected"
      echo ""
      diff --color=always <(echo "$actual") "$expected_file" | head -40 | sed 's/^/     /'
      echo ""
    fi
  done
fi

# ─── step 4: cargo check ─────────────────────────────────────────────────────
echo ""
echo "3. Running cargo check..."

if $SKIP_CARGO; then
  info "skipped (--no-cargo flag)"
elif ! command -v cargo &>/dev/null; then
  info "Cargo not found — skipping compilation check"
  info "Install Rust from https://rustup.rs to enable this step"
  ((SKIP++)) || true
elif [[ ! -f "$RUST_TEST_DIR/Cargo.toml" ]]; then
  info "rust-test/Cargo.toml not found — skipping"
  ((SKIP++)) || true
else
  cd "$RUST_TEST_DIR"

  # Check each generated file individually by injecting it as the lib source
  GENERATED_DIR="$RUST_TEST_DIR/src/generated"
  any_cargo_fail=false

  if [[ ! -d "$GENERATED_DIR" ]] || [[ -z "$(ls "$GENERATED_DIR"/*.rs 2>/dev/null)" ]]; then
    info "No generated files to check"
    ((SKIP++)) || true
  else
    for gen_file in "$GENERATED_DIR"/*.rs; do
      [[ -f "$gen_file" ]] || continue
      name="$(basename "$gen_file" .rs)"

      # Use cargo check with a temp main that includes the generated file
      tmp_main="$RUST_TEST_DIR/src/main_check_tmp.rs"
      cat > "$tmp_main" << EOF
// Auto-generated temporary check file — do not commit
#[allow(unused_imports, dead_code, unused_variables)]
mod fixture {
    include!("generated/${name}.rs");
}
fn main() {}
EOF

      if cargo check --bin test-runner --quiet 2>/dev/null; then
        ok "cargo check: $name"
      else
        # Run again capturing stderr for the error message
        err=$(cargo check --bin test-runner 2>&1 | grep "^error" | head -5)
        fail "cargo check: $name"
        echo "     $err"
        any_cargo_fail=true
      fi

      rm -f "$tmp_main"
    done

    $any_cargo_fail && ((FAIL++)) || true
  fi

  cd "$PROJECT_DIR"
fi

# ─── summary ─────────────────────────────────────────────────────────────────
echo ""
echo "─────────────────────────────────────────"
echo -e "  ${GREEN}${PASS} passed${NC}   ${RED}${FAIL} failed${NC}   ${YELLOW}${SKIP} skipped${NC}"
echo "─────────────────────────────────────────"
echo ""

[[ $FAIL -eq 0 ]] && exit 0 || exit 1