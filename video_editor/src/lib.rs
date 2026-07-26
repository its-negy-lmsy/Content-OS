//! Content OS Native Rust Video Engine Core
//! Handles timeline track composite calculation, frame transformations, keyframe interpolation, and export rendering pipelines.

pub mod encoder;
pub mod timeline;

pub use encoder::{generate_ffmpeg_command, RenderConfig};
pub use timeline::{ColorGrading, Keyframe, MediaClip, TimelineState, Track, TrackType, Transform};

pub fn render_frame_spec(state: &TimelineState, time_sec: f64) -> String {
    let active_clips = state.get_active_clips(time_sec);
    format!(
        "Render Spec at {:.2}s for project '{}' ({}x{} @ {}fps) — Active Clips: {}",
        time_sec, state.project_name, state.width, state.height, state.fps, active_clips.len()
    )
}
