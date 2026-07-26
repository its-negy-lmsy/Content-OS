//! Content OS Standalone Video Engine Entry Point

use video_editor_engine::{render_frame_spec, TimelineState};

fn main() {
    println!("=====================================================");
    println!("  🎥 CONTENT OS — NATIVE RUST VIDEO ENGINE          ");
    println!("=====================================================");

    let timeline = TimelineState::default();
    println!("Initialized Timeline: {}", timeline.project_name);
    println!("Resolution: {}x{} @ {}fps", timeline.width, timeline.height, timeline.fps);

    let frame = render_frame_spec(&timeline, 0.0);
    println!("{}", frame);
    println!("Engine core ready.");
}
