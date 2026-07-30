# Content OS Video Engine

## One authority for edits

The UI is a view layer. It must not write a project file directly. Durable edits
go through one serialized event channel:

```text
CapCut-style workspace -> POST /api/video/engine/event -> project validator -> video_project.json
```

The frontend queues writes so an old drag, trim, or split cannot race a newer
one. The Rust core mirrors this contract in `src/commands.rs` through the
single `process_ui_event(event)` entry point, ready for the native bridge when
the Rust toolchain is installed.

## Current folders

```text
backend/database/video_editor.py  Project authority, media pipeline, real render graph
database/settings/video_project.json  Active project (UUID references and timeline)
database/assets_vault/imports/    Immutable user source assets
database/assets_vault/videos/     Finished exports
database/cache/video_editor/
  thumbnails/                     Rebuildable video thumbnails
  proxies/                        Rebuildable edit proxies
  waveforms/                      Rebuildable audio waveforms
  previews/                       Rebuildable preview data
video_editor/src/
  timeline.rs                     Shared project structures and keyframe evaluation
  commands.rs                     Authoritative command/undo entry point
  encoder.rs                      Native FFmpeg command construction (next bridge target)
  main.rs                         Stateless Rust command bridge CLI
```

Cache never lives inside source assets and may be deleted without damaging a
project. Originals remain the source of truth; a final render resolves original
files inside the asset vault instead of any generated proxy.

## Implemented command contract

- Track add/update/delete (with lock protection)
- Clip add, move, trim, split, duplicate, delete
- Transform properties and audio gain
- Playhead updates
- Serializable undo/redo in the Rust command core
- Atomic project persistence, media probing, thumbnail/proxy/waveform work when FFmpeg is available
- Real FFmpeg composition with transforms and audio mixing; render errors remain errors

## Toolchain requirement

The current machine does not expose `cargo`, `rustc`, `ffmpeg`, or `ffprobe` on
PATH. The browser can still edit and save project state, but generating proxies,
waveforms, and exports requires FFmpeg, and executing the Rust bridge requires
the Rust toolchain. The application reports these as explicit errors rather than
pretending a render completed.

## Next vertical slices

1. Connect the compiled Rust command bridge to `/api/video/engine/event`.
2. Add command-level events from every timeline interaction instead of whole
   timeline snapshots.
3. Add keyframe/effect/mask render nodes with each node tested against export.
4. Add project snapshots, cache cleanup, and background render jobs.
5. Build advanced tools only when their command, preview, export, undo/redo,
   persistence, and manual verification are all present.
