//! Content OS Video Engine Timeline & Track Compositor Core
//! Manages multi-track layout, clip properties, keyframe evaluation, and time-stepping logic.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TrackType {
    Video,
    Audio,
    Caption,
    Effect,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transform {
    #[serde(default)]
    pub position_x: f64,
    #[serde(default)]
    pub position_y: f64,
    #[serde(default)]
    pub position_z: f64,
    #[serde(default = "default_scale")]
    pub scale_x: f64,
    #[serde(default = "default_scale")]
    pub scale_y: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default)]
    pub anchor_x: f64,
    #[serde(default)]
    pub anchor_y: f64,
}

fn default_scale() -> f64 { 100.0 }
fn default_opacity() -> f64 { 100.0 }

impl Default for Transform {
    fn default() -> Self {
        Self {
            position_x: 0.0,
            position_y: 0.0,
            position_z: 0.0,
            scale_x: 100.0,
            scale_y: 100.0,
            rotation: 0.0,
            opacity: 100.0,
            anchor_x: 0.0,
            anchor_y: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorGrading {
    #[serde(default)]
    pub exposure: f64,
    #[serde(default = "default_scale")]
    pub contrast: f64,
    #[serde(default)]
    pub highlights: f64,
    #[serde(default)]
    pub shadows: f64,
    #[serde(default = "default_scale")]
    pub saturation: f64,
    #[serde(default)]
    pub temperature: f64,
    #[serde(default)]
    pub tint: f64,
    #[serde(default)]
    pub lut_file: Option<String>,
}

impl Default for ColorGrading {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            contrast: 100.0,
            highlights: 0.0,
            shadows: 0.0,
            saturation: 100.0,
            temperature: 0.0,
            tint: 0.0,
            lut_file: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframe {
    pub time_sec: f64,
    pub property: String, // e.g. "position_x", "scale_x", "opacity"
    pub value: f64,
    pub easing: String,   // "linear", "ease_in", "ease_out", "bezier"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaClip {
    pub id: String,
    pub name: String,
    pub src: String,
    pub media_type: String, // "video", "audio", "image", "text"
    pub start_time: f64,    // Position on timeline in seconds
    pub duration: f64,      // Active duration on timeline
    pub in_point: f64,      // Trim start inside source media
    pub out_point: f64,     // Trim end inside source media
    pub track_id: usize,
    #[serde(default)]
    pub transform: Transform,
    #[serde(default)]
    pub color_grading: ColorGrading,
    pub keyframes: Vec<Keyframe>,
    pub volume_db: f64,
    #[serde(rename = "muted", alias = "is_muted", default)]
    pub is_muted: bool,
}

impl MediaClip {
    pub fn new(id: String, name: String, src: String, media_type: String, track_id: usize) -> Self {
        Self {
            id,
            name,
            src,
            media_type,
            start_time: 0.0,
            duration: 5.0,
            in_point: 0.0,
            out_point: 5.0,
            track_id,
            transform: Transform::default(),
            color_grading: ColorGrading::default(),
            keyframes: Vec::new(),
            volume_db: 0.0,
            is_muted: false,
        }
    }

    pub fn is_active_at(&self, time_sec: f64) -> bool {
        time_sec >= self.start_time && time_sec < (self.start_time + self.duration)
    }

    pub fn evaluate_transform(&self, time_sec: f64) -> Transform {
        let mut t = self.transform.clone();
        if self.keyframes.is_empty() {
            return t;
        }

        // Interpolate keyframe properties if present
        for property in &["position_x", "position_y", "scale_x", "scale_y", "rotation", "opacity"] {
            let prop_keyframes: Vec<&Keyframe> = self
                .keyframes
                .iter()
                .filter(|k| k.property == *property)
                .collect();

            if prop_keyframes.is_empty() {
                continue;
            }

            if time_sec <= prop_keyframes[0].time_sec {
                set_transform_prop(&mut t, property, prop_keyframes[0].value);
            } else if time_sec >= prop_keyframes.last().unwrap().time_sec {
                set_transform_prop(&mut t, property, prop_keyframes.last().unwrap().value);
            } else {
                // Linear interpolation between surrounding keyframes
                for i in 0..prop_keyframes.len() - 1 {
                    let k1 = prop_keyframes[i];
                    let k2 = prop_keyframes[i + 1];
                    if time_sec >= k1.time_sec && time_sec <= k2.time_sec {
                        let ratio = (time_sec - k1.time_sec) / (k2.time_sec - k1.time_sec);
                        let val = k1.value + ratio * (k2.value - k1.value);
                        set_transform_prop(&mut t, property, val);
                        break;
                    }
                }
            }
        }

        t
    }
}

fn set_transform_prop(t: &mut Transform, prop: &str, val: f64) {
    match prop {
        "position_x" => t.position_x = val,
        "position_y" => t.position_y = val,
        "position_z" => t.position_z = val,
        "scale_x" => t.scale_x = val,
        "scale_y" => t.scale_y = val,
        "rotation" => t.rotation = val,
        "opacity" => t.opacity = val,
        _ => {}
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: usize,
    pub name: String,
    #[serde(rename = "type", alias = "track_type")]
    pub track_type: TrackType,
    #[serde(rename = "muted", alias = "is_muted")]
    pub is_muted: bool,
    #[serde(rename = "solo", alias = "is_solo")]
    pub is_solo: bool,
    #[serde(rename = "locked", alias = "is_locked")]
    pub is_locked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineState {
    pub project_name: String,
    pub fps: u32,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub playhead: f64,
    pub tracks: Vec<Track>,
    pub clips: Vec<MediaClip>,
}

impl Default for TimelineState {
    fn default() -> Self {
        Self {
            project_name: String::from("IntroExercise"),
            fps: 60,
            width: 1920,
            height: 1080,
            duration: 30.0,
            playhead: 0.0,
            tracks: vec![
                Track { id: 0, name: String::from("V2 (Titles/FX)"), track_type: TrackType::Video, is_muted: false, is_solo: false, is_locked: false },
                Track { id: 1, name: String::from("V1 (Main Video)"), track_type: TrackType::Video, is_muted: false, is_solo: false, is_locked: false },
                Track { id: 2, name: String::from("A1 (Voiceover)"), track_type: TrackType::Audio, is_muted: false, is_solo: false, is_locked: false },
                Track { id: 3, name: String::from("A2 (BGM)"), track_type: TrackType::Audio, is_muted: false, is_solo: false, is_locked: false },
            ],
            clips: Vec::new(),
        }
    }
}

impl TimelineState {
    pub fn get_active_clips(&self, time_sec: f64) -> Vec<&MediaClip> {
        self.clips.iter().filter(|c| c.is_active_at(time_sec)).collect()
    }
}
