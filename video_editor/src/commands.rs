//! The editor's single authoritative mutation channel.
//!
//! The UI never writes project files. It sends one event through
//! `process_ui_event`, receives the resulting state, and renders it.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::timeline::{MediaClip, TimelineState, Track, TrackType};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSession {
    pub timeline: TimelineState,
    #[serde(default)]
    undo: Vec<TimelineState>,
    #[serde(default)]
    redo: Vec<TimelineState>,
}

impl Default for EngineSession {
    fn default() -> Self {
        Self { timeline: TimelineState::default(), undo: Vec::new(), redo: Vec::new() }
    }
}

impl EngineSession {
    fn checkpoint(&mut self) {
        self.undo.push(self.timeline.clone());
        if self.undo.len() > 100 { self.undo.remove(0); }
        self.redo.clear();
    }

    fn track_index(&self, id: usize) -> Result<usize, String> {
        self.timeline.tracks.iter().position(|track| track.id == id)
            .ok_or_else(|| format!("Track '{id}' does not exist"))
    }

    fn clip_index(&self, id: &str) -> Result<usize, String> {
        self.timeline.clips.iter().position(|clip| clip.id == id)
            .ok_or_else(|| format!("Clip '{id}' does not exist"))
    }

    fn require_unlocked_track(&self, id: usize) -> Result<(), String> {
        let track = &self.timeline.tracks[self.track_index(id)?];
        if track.is_locked { Err(format!("Track '{}' is locked", track.name)) } else { Ok(()) }
    }
}

fn number(payload: &Value, name: &str) -> Result<f64, String> {
    payload.get(name).and_then(Value::as_f64).ok_or_else(|| format!("'{name}' must be a number"))
}

fn string(payload: &Value, name: &str) -> Result<String, String> {
    payload.get(name).and_then(Value::as_str).map(str::to_owned).ok_or_else(|| format!("'{name}' must be a string"))
}

fn response(session: &EngineSession, changed: bool) -> Value {
    json!({ "ok": true, "changed": changed, "timeline": session.timeline })
}

/// Processes one serializable event. This is the only mutation entry point.
pub fn process_ui_event(session: &mut EngineSession, event: &str) -> Result<Value, String> {
    let input: Value = serde_json::from_str(event).map_err(|error| format!("Invalid engine event: {error}"))?;
    let op = input.get("op").and_then(Value::as_str).ok_or("Engine event is missing 'op'")?;
    let payload = input.get("payload").cloned().unwrap_or_else(|| json!({}));

    match op {
        "replace_timeline" => {
            let timeline = serde_json::from_value(payload).map_err(|error| format!("Invalid timeline: {error}"))?;
            session.checkpoint();
            session.timeline = timeline;
            Ok(response(session, true))
        }
        "set_playhead" => {
            session.timeline.playhead = number(&payload, "time")?.clamp(0.0, session.timeline.duration);
            Ok(response(session, false))
        }
        "add_track" => {
            let track_type = serde_json::from_value(payload.get("type").cloned().unwrap_or_else(|| json!("video")))
                .map_err(|_| "Track type must be video, audio, caption, or effect".to_string())?;
            session.checkpoint();
            let id = session.timeline.tracks.iter().map(|track| track.id).max().unwrap_or(0) + 1;
            session.timeline.tracks.push(Track {
                id,
                name: payload.get("name").and_then(Value::as_str).unwrap_or("Untitled Track").to_owned(),
                track_type,
                is_muted: false,
                is_solo: false,
                is_locked: false,
            });
            Ok(response(session, true))
        }
        "update_track" => {
            let id = payload.get("id").and_then(Value::as_u64).ok_or("'id' must be a track id")? as usize;
            let index = session.track_index(id)?;
            session.checkpoint();
            let track = &mut session.timeline.tracks[index];
            if let Some(name) = payload.get("name").and_then(Value::as_str) { track.name = name.to_owned(); }
            if let Some(value) = payload.get("muted").and_then(Value::as_bool) { track.is_muted = value; }
            if let Some(value) = payload.get("solo").and_then(Value::as_bool) { track.is_solo = value; }
            if let Some(value) = payload.get("locked").and_then(Value::as_bool) { track.is_locked = value; }
            Ok(response(session, true))
        }
        "delete_track" => {
            let id = payload.get("id").and_then(Value::as_u64).ok_or("'id' must be a track id")? as usize;
            let index = session.track_index(id)?;
            if session.timeline.clips.iter().any(|clip| clip.track_id == id) { return Err("Move or delete this track's clips first".into()); }
            session.checkpoint();
            session.timeline.tracks.remove(index);
            Ok(response(session, true))
        }
        "add_clip" => {
            let clip: MediaClip = serde_json::from_value(payload.get("clip").cloned().ok_or("'clip' is required")?)
                .map_err(|error| format!("Invalid clip: {error}"))?;
            session.require_unlocked_track(clip.track_id)?;
            if clip.duration <= 0.0 { return Err("A clip duration must be greater than zero".into()); }
            if session.timeline.clips.iter().any(|existing| existing.id == clip.id) { return Err("Clip ids must be unique".into()); }
            session.checkpoint();
            session.timeline.duration = session.timeline.duration.max(clip.start_time + clip.duration);
            session.timeline.clips.push(clip);
            Ok(response(session, true))
        }
        "move_clip" => {
            let id = string(&payload, "id")?;
            let index = session.clip_index(&id)?;
            let destination = payload.get("track_id").and_then(Value::as_u64).map(|value| value as usize).unwrap_or(session.timeline.clips[index].track_id);
            session.require_unlocked_track(session.timeline.clips[index].track_id)?;
            session.require_unlocked_track(destination)?;
            session.checkpoint();
            let clip = &mut session.timeline.clips[index];
            clip.start_time = number(&payload, "start_time")?.max(0.0);
            clip.track_id = destination;
            session.timeline.duration = session.timeline.duration.max(clip.start_time + clip.duration);
            Ok(response(session, true))
        }
        "trim_clip" => {
            let id = string(&payload, "id")?;
            let index = session.clip_index(&id)?;
            session.require_unlocked_track(session.timeline.clips[index].track_id)?;
            let duration = number(&payload, "duration")?;
            if duration <= 0.0 { return Err("A trimmed clip must remain longer than zero".into()); }
            session.checkpoint();
            let clip = &mut session.timeline.clips[index];
            clip.start_time = payload.get("start_time").and_then(Value::as_f64).unwrap_or(clip.start_time).max(0.0);
            clip.duration = duration;
            clip.out_point = clip.in_point + duration;
            Ok(response(session, true))
        }
        "split_clip" => {
            let id = string(&payload, "id")?;
            let at = number(&payload, "time")?;
            let index = session.clip_index(&id)?;
            let original = session.timeline.clips[index].clone();
            session.require_unlocked_track(original.track_id)?;
            if at <= original.start_time || at >= original.start_time + original.duration { return Err("Split point must fall inside the clip".into()); }
            let new_id = string(&payload, "new_id")?;
            if session.timeline.clips.iter().any(|clip| clip.id == new_id) { return Err("The new split clip id already exists".into()); }
            let offset = at - original.start_time;
            session.checkpoint();
            session.timeline.clips[index].duration = offset;
            session.timeline.clips[index].out_point = original.in_point + offset;
            let mut right = original;
            right.id = new_id;
            right.start_time = at;
            right.in_point += offset;
            right.duration -= offset;
            session.timeline.clips.push(right);
            Ok(response(session, true))
        }
        "delete_clip" => {
            let id = string(&payload, "id")?;
            let index = session.clip_index(&id)?;
            session.require_unlocked_track(session.timeline.clips[index].track_id)?;
            session.checkpoint();
            session.timeline.clips.remove(index);
            Ok(response(session, true))
        }
        "duplicate_clip" => {
            let id = string(&payload, "id")?;
            let index = session.clip_index(&id)?;
            let mut copied = session.timeline.clips[index].clone();
            session.require_unlocked_track(copied.track_id)?;
            copied.id = string(&payload, "new_id")?;
            if session.timeline.clips.iter().any(|clip| clip.id == copied.id) { return Err("The duplicated clip id already exists".into()); }
            copied.start_time = payload.get("start_time").and_then(Value::as_f64).unwrap_or(copied.start_time + copied.duration).max(0.0);
            session.checkpoint();
            session.timeline.duration = session.timeline.duration.max(copied.start_time + copied.duration);
            session.timeline.clips.push(copied);
            Ok(response(session, true))
        }
        "set_clip_property" => {
            let id = string(&payload, "id")?;
            let property = string(&payload, "property")?;
            let value = number(&payload, "value")?;
            let index = session.clip_index(&id)?;
            session.require_unlocked_track(session.timeline.clips[index].track_id)?;
            session.checkpoint();
            let clip = &mut session.timeline.clips[index];
            match property.as_str() {
                "position_x" => clip.transform.position_x = value,
                "position_y" => clip.transform.position_y = value,
                "scale_x" => clip.transform.scale_x = value.max(0.0),
                "scale_y" => clip.transform.scale_y = value.max(0.0),
                "rotation" => clip.transform.rotation = value,
                "opacity" => clip.transform.opacity = value.clamp(0.0, 100.0),
                "volume_db" => clip.volume_db = value.clamp(-96.0, 24.0),
                _ => return Err(format!("Unsupported clip property '{property}'")),
            }
            Ok(response(session, true))
        }
        "undo" => {
            let previous = session.undo.pop().ok_or("There is no edit to undo")?;
            session.redo.push(session.timeline.clone());
            session.timeline = previous;
            Ok(response(session, true))
        }
        "redo" => {
            let next = session.redo.pop().ok_or("There is no edit to redo")?;
            session.undo.push(session.timeline.clone());
            session.timeline = next;
            Ok(response(session, true))
        }
        _ => Err(format!("Unsupported engine operation '{op}'")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_is_undoable() {
        let mut session = EngineSession::default();
        let clip = json!({"id":"a","name":"A","src":"a.mp4","media_type":"video","start_time":0.0,"duration":5.0,"in_point":0.0,"out_point":5.0,"track_id":1,"transform":{},"color_grading":{},"keyframes":[],"volume_db":0.0,"is_muted":false});
        process_ui_event(&mut session, &json!({"op":"add_clip","payload":{"clip":clip}}).to_string()).unwrap();
        process_ui_event(&mut session, r#"{"op":"split_clip","payload":{"id":"a","new_id":"b","time":2.0}}"#).unwrap();
        assert_eq!(session.timeline.clips.len(), 2);
        process_ui_event(&mut session, r#"{"op":"undo"}"#).unwrap();
        assert_eq!(session.timeline.clips.len(), 1);
    }
}
