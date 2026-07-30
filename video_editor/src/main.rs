//! Standalone bridge to the Content OS Rust command engine.

use std::{env, fs, path::PathBuf};
use video_editor_engine::{process_ui_event, EngineSession};

fn main() {
    let args: Vec<String> = env::args().collect();
    let state_arg = args.iter().position(|arg| arg == "--state").and_then(|index| args.get(index + 1));
    let event_arg = args.iter().position(|arg| arg == "--event").and_then(|index| args.get(index + 1));
    let (Some(state_arg), Some(event)) = (state_arg, event_arg) else {
        eprintln!("Usage: video_editor_server --state <session.json> --event <json>");
        std::process::exit(2);
    };

    let state_path = PathBuf::from(state_arg);
    let mut session = fs::read_to_string(&state_path).ok()
        .and_then(|content| serde_json::from_str::<EngineSession>(&content).ok())
        .unwrap_or_default();

    match process_ui_event(&mut session, event) {
        Ok(result) => {
            if let Some(parent) = state_path.parent() { let _ = fs::create_dir_all(parent); }
            if let Err(error) = fs::write(&state_path, serde_json::to_string_pretty(&session).unwrap()) {
                eprintln!("Could not save engine state: {error}");
                std::process::exit(1);
            }
            println!("{result}");
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
