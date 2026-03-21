// Test file for Rust Import Organizer - Bug test cases
//
// BUG 1: use serde_json::Value as JsonValue; - IS used as type but gets REMOVED incorrectly
// BUG 2: use chrono::{DateTime, Utc}; - NEITHER is used, should be removed ENTIRELY
//        but bug results in: use chrono::{DateTime}; (keeps DateTime, removes Utc)

use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;

fn process(val: JsonValue) -> String {
    "ok".to_string()
}

fn main() {
    let v: JsonValue = serde_json::json!({"a": 1});
    let _ = process(v);
}
