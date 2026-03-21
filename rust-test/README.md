# 1. Create the project
mkdir rust-import-organizer-test
cd rust-import-organizer-test
cargo init

# 2. Copy the files above into place
# 3. Copy your test_fixture.rs to the root

# 4. Verify it compiles before organization
cargo check

# 5. Open in VS Code and run your extension on test_fixture.rs
code .

# 6. After organization, verify it still compiles
cargo check

# 7. Run the test runner
cargo run --bin test-runner