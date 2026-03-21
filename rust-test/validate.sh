#!/bin/bash
set -e

echo "🧪 Validating Import Organizer"

# Backup
cp test_fixture.rs test_fixture.rs.bak

# Check original compiles
echo "Checking original..."
cargo check --quiet

echo "✅ Original compiles"
echo ""
echo "Now run your VS Code extension on test_fixture.rs"
echo "Press Enter when done..."
read

# Check organized compiles
echo "Checking organized..."
cargo check --quiet

echo "✅ Organized compiles"

# Specific checks
echo "Running specific checks..."

if grep -q "Value as JsonValue" test_fixture.rs; then
    echo "✅ JsonValue alias preserved"
else
    echo "❌ JsonValue alias missing!"
fi

if grep -q "use std::sync::Arc;" test_fixture.rs; then
    echo "❌ Unused Arc not removed!"
else
    echo "✅ Unused Arc removed"
fi

# Restore
mv test_fixture.rs.bak test_fixture.rs
echo "✅ Restored original"