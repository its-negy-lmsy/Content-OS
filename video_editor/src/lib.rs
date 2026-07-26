//! Content OS Native Rust Video Engine Core
//! Handles timeline track composite calculation, frame transformations, and export rendering pipelines.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TrackType {
    Video,
    Audio,
    Caption,
    Effect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaClip {
    pub id: String,
    pub name: String,
    pub src: String,
    pub start_time: f64,
    pub duration: f64,
    pub track_id: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineState {
    pub project_name: String,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub playhead: f64,
    pub clips: Vec<MediaClip>,
}

impl Default for TimelineState {
    fn default() -> Self {
        Self {
            project_name: String::from("Untitled Project"),
            fps: 60,
            width: 1920,
            height: 1080,
            duration: 30.0,
            playhead: 0.0,
            clips: Vec::new(),
        }
    }
}

pub fn render_frame_spec(state: &TimelineState, time_sec: f64) -> String {
    format!(
        "Render Spec at {:.2}s for project '{}' ({:?}x{:?})",
        time_sec, state.project_name, state.width, state.height
    )
}
