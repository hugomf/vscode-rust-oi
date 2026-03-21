// Test file for Rust Import Organizer - Unused imports test
// This file has some imports that should be removed

use std::collections::HashMap;
use std::fs::File;
use std::path::{Path};

use anyhow::Result;
use my_crate::models::User;
use tokio::runtime::Runtime;

use crate::config::Settings;

fn main() {
    println!("This is a test file for the Rust Import Organizer");

    // Only use some of the imports
    let map: HashMap<String, i32> = HashMap::new();
    let file = File::open("test.txt").unwrap();
    let path = Path::new("test.txt");
    let result: Result<()> = Ok(());
    let user = User::new("test".to_string());
    let runtime = Runtime::new().unwrap();
    let settings = Settings::new();
}

pub struct Example {
    name: String,
    value: i32,
}

impl Example {
    pub fn new(name: String, value: i32) -> Self {
        Self { name, value }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example() {
        let example = Example::new("test".to_string(), 42);
        assert_eq!(example.value, 42);
    }
}
