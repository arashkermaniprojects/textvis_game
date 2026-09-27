extends Node

# Phase 4 — scripted lecture replay.
#
# Ports the camera choreography and label visibility rules from
# docs/blender_animated.py.reference (lines ~1145-1436). Both this
# file and tools/render-from-world.py pull their constants from the
# `camera` section of tools/pipeline-config.json — do NOT hardcode them
# in two places.
#
# Research references for the 4-phase timing (also in pipeline-config.json):
#   Heer & Robertson 2007 — animated transitions help tracking; 1-1.5s
#     for simple changes
#   Bartram & Ware 2002   — 3D viewpoint changes need 1.5-2.5s to avoid
#     disorientation
#   Shneiderman 1996      — overview-first-then-detail
#   Film editing          — 2-4s per "shot" for comprehension
#
# Per-edge phases (fractions of the edge's own audio_duration):
#   0.00 → 0.25   zoom-in from previous overview
#   0.25 → 0.75   close-in hold (viewer reads subject/verb/object)
#   0.75 → 1.00   zoom-out starts toward overview
#   silence gap   overview plateau (both current + next SPO visible)
#   0.00 → 0.25   zoom-in into next edge's close pose

var camera: Camera3D                # fly_camera instance
var loader                          # world_loader.gd instance

var active: bool = false
var lecture_time: float = 0.0       # monotonic clock for audio/UI/label sync
var total_duration: float = 0.0
var current_edge_index: int = -1

# When true, lecture_mode plays the ONE concatenated narration.wav at t=0
# and skips per-edge _start_edge_audio calls in _process. Set by start()
# when the lecture dir contains audio_clips/narration.wav — removes all
# per-edge restart risk and makes ffmpeg muxing a one-shot.
var using_narration_wav: bool = false

var keyframes: Array = []           # per-edge pose dicts (see _compute_schedule)
var tween: Tween

var narrator_player: AudioStreamPlayer

# Global scene bounds for overview pose + outward bias.
var global_center: Vector3 = Vector3.ZERO
var global_radius: float = 50.0

# ─── constants loaded from tools/pipeline-config.json ─────────────────────
# Defaults match the reference renderer's values as a safety net if the file is missing
# or malformed, but the JSON is the source of truth.
var HOLD_FRACTION: float = 0.75
var TRANSITION_FRACTION: float = 0.25
var ZOOM_OUT_FACTOR: float = 1.8
var MIN_DISTANCE: float = 12.0
var MAX_DISTANCE: float = 60.0
var EDGE_LENGTH_MARGIN: float = 6.0
var VERTICAL_MARGIN: float = 5.0
var SAFETY_MULTIPLIER: float = 1.12
var FOV_H_DEG: float = 65.0
var FOV_V_DEG: float = 37.0
var GLOBAL_CENTER_BIAS: float = 0.4
var OVERVIEW_YAW_TWIST: float = deg_to_rad(11.25)
var OVERVIEW_PITCH_LIFT: float = deg_to_rad(8.0)
var OVERVIEW_PITCH_CAP: float = deg_to_rad(42.0)
var LIFT_PITCH_BASE: float = deg_to_rad(20.0)
var LIFT_PITCH_AMP: float = deg_to_rad(10.0)
var TILT_AMP: float = deg_to_rad(15.0)
var PERP_OUTWARD_BLEND: float = 0.7

var HALF_H_FOV: float = 0.567  # computed in _load_config
var HALF_V_FOV: float = 0.323

# UI (banner / subtitle / progress)
var canvas_layer: CanvasLayer
var progress_label: Label
var subtitle_label: Label
var banner_label: Label
# When true (recording/headless renders), the HUD stays hidden even in
# lecture mode — the resulting video has no banner, progress line, or
# subtitle strip baked in. Set from main.gd when --auto-lecture or
# --write-movie is on the command line.
var hud_hidden: bool = false

func _ready() -> void:
	narrator_player = AudioStreamPlayer.new()
	narrator_player.bus = "Master"
	add_child(narrator_player)
	set_process(false)
	_load_config()

func _load_config() -> void:
	# pipeline-config.json lives at <repo>/tools/pipeline-config.json.
	# Resolve via res:// → <repo>/godot/ → parent → tools/.
	var project_root := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var repo_root := project_root.get_base_dir()
	var cfg_path: String = repo_root.path_join("tools").path_join("pipeline-config.json")
	if not FileAccess.file_exists(cfg_path):
		push_warning("[lecture_mode] pipeline-config.json not found at " + cfg_path + " — using hardcoded defaults")
		_recompute_half_fovs()
		return
	var f := FileAccess.open(cfg_path, FileAccess.READ)
	if f == null:
		push_warning("[lecture_mode] failed to open " + cfg_path)
		_recompute_half_fovs()
		return
	var text := f.get_as_text()
	f.close()
	var cfg = JSON.parse_string(text)
	if typeof(cfg) != TYPE_DICTIONARY or not cfg.has("camera"):
		push_warning("[lecture_mode] pipeline-config.json missing camera section")
		_recompute_half_fovs()
		return
	var c: Dictionary = cfg["camera"]
	HOLD_FRACTION        = float(c.get("hold_fraction", HOLD_FRACTION))
	TRANSITION_FRACTION  = float(c.get("transition_fraction", TRANSITION_FRACTION))
	ZOOM_OUT_FACTOR      = float(c.get("zoom_out_factor", ZOOM_OUT_FACTOR))
	MIN_DISTANCE         = float(c.get("min_distance", MIN_DISTANCE))
	MAX_DISTANCE         = float(c.get("max_distance", MAX_DISTANCE))
	EDGE_LENGTH_MARGIN   = float(c.get("edge_length_margin", EDGE_LENGTH_MARGIN))
	VERTICAL_MARGIN      = float(c.get("vertical_margin", VERTICAL_MARGIN))
	SAFETY_MULTIPLIER    = float(c.get("safety_multiplier", SAFETY_MULTIPLIER))
	FOV_H_DEG            = float(c.get("fov_horizontal_deg", FOV_H_DEG))
	FOV_V_DEG            = float(c.get("fov_vertical_deg", FOV_V_DEG))
	GLOBAL_CENTER_BIAS   = float(c.get("global_center_bias", GLOBAL_CENTER_BIAS))
	OVERVIEW_YAW_TWIST   = deg_to_rad(float(c.get("overview_yaw_twist_deg", 11.25)))
	OVERVIEW_PITCH_LIFT  = deg_to_rad(float(c.get("overview_pitch_lift_deg", 8.0)))
	OVERVIEW_PITCH_CAP   = deg_to_rad(float(c.get("overview_pitch_cap_deg", 42.0)))
	LIFT_PITCH_BASE      = deg_to_rad(float(c.get("lift_pitch_base_deg", 20.0)))
	LIFT_PITCH_AMP       = deg_to_rad(float(c.get("lift_pitch_amp_deg", 10.0)))
	TILT_AMP             = deg_to_rad(float(c.get("tilt_amp_deg", 15.0)))
	PERP_OUTWARD_BLEND   = float(c.get("perp_outward_blend", PERP_OUTWARD_BLEND))
	_recompute_half_fovs()

func _recompute_half_fovs() -> void:
	HALF_H_FOV = deg_to_rad(FOV_H_DEG * 0.5)
	HALF_V_FOV = deg_to_rad(FOV_V_DEG * 0.5)

# ─── UI setup (called by main.gd after creation) ───────────────────────────
func setup_ui() -> void:
	canvas_layer = CanvasLayer.new()
	add_child(canvas_layer)

	banner_label = Label.new()
	banner_label.text = "LECTURE MODE"
	banner_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner_label.anchor_left = 0.0
	banner_label.anchor_right = 1.0
	banner_label.anchor_top = 0.0
	banner_label.anchor_bottom = 0.0
	banner_label.offset_top = 12
	banner_label.offset_bottom = 42
	banner_label.add_theme_font_size_override("font_size", 14)
	banner_label.add_theme_color_override("font_color", Color(1, 0.85, 0.2, 0.95))
	banner_label.visible = false
	canvas_layer.add_child(banner_label)

	progress_label = Label.new()
	progress_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	progress_label.anchor_left = 0.0
	progress_label.anchor_right = 1.0
	progress_label.anchor_top = 0.0
	progress_label.anchor_bottom = 0.0
	progress_label.offset_top = 36
	progress_label.offset_bottom = 62
	progress_label.add_theme_font_size_override("font_size", 17)
	progress_label.add_theme_color_override("font_color", Color(1, 1, 1, 0.9))
	progress_label.visible = false
	canvas_layer.add_child(progress_label)

	subtitle_label = Label.new()
	subtitle_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	subtitle_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subtitle_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	subtitle_label.anchor_left = 0.08
	subtitle_label.anchor_right = 0.92
	subtitle_label.anchor_top = 1.0
	subtitle_label.anchor_bottom = 1.0
	subtitle_label.offset_top = -140
	subtitle_label.offset_bottom = -40
	subtitle_label.add_theme_font_size_override("font_size", 24)
	subtitle_label.add_theme_color_override("font_color", Color(1.0, 0.98, 0.85, 0.98))
	subtitle_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 1))
	subtitle_label.add_theme_constant_override("outline_size", 8)
	subtitle_label.visible = false
	canvas_layer.add_child(subtitle_label)

# ─── public controls ────────────────────────────────────────────────────────
func toggle() -> void:
	if active:
		stop()
	else:
		start()

func start() -> void:
	if active:
		return
	_compute_schedule()
	if keyframes.is_empty():
		push_error("[lecture_mode] no playable edges")
		return

	# Drift assertion — catches the case where lecture_state.json /
	# durations.json / narration.wav were updated out-of-band. If
	# sum(edge.audio_duration) diverges from audio.total_duration by more
	# than 0.5s, OR if narration.wav is not present and we'd fall back to
	# per-edge clips against a stale world_state, we REFUSE to start the
	# lecture. Fail loud, not silent.
	var edges_total: float = 0.0
	for kf in keyframes:
		edges_total += kf.duration
	var declared_total: float = float(loader.data.get("audio", {}).get("total_duration", 0.0))
	var drift: float = abs(edges_total - declared_total)
	if declared_total > 0.0 and drift > 0.5:
		push_error(
			"[lecture_mode] DRIFT DETECTED: sum(edge.audio_duration)=%.3fs vs world.audio.total_duration=%.3fs (|Δ|=%.3fs > 0.5s). Re-run tools/sync-from-workdir.mjs and tools/compute-layout.mjs. Aborting lecture mode." % [
				edges_total, declared_total, drift
			]
		)
		return
	# Also sanity-check the first edge starts at ~0 and the last ends at
	# ~total_duration.
	var last_kf: Dictionary = keyframes[keyframes.size() - 1]
	var end_of_last: float = last_kf.start + last_kf.duration
	if declared_total > 0.0 and abs(end_of_last - declared_total) > 0.5:
		push_error(
			"[lecture_mode] TAIL DRIFT: last edge ends at %.3fs vs declared total %.3fs. Aborting." % [
				end_of_last, declared_total
			]
		)
		return

	# Disable fly-camera input while the Tween drives the camera.
	if "enabled" in camera:
		camera.enabled = false
	camera.fov = FOV_V_DEG

	# Hide node + verb labels, hide all edge bodies, KEEP cluster labels
	# visible at all times (user directive: cluster labels should be
	# permanently visible so the viewer always knows which cluster the
	# active SPO belongs to). _refresh_visibility() will re-enable the
	# active edge + its SPO labels per frame.
	for lbl in loader.node_labels.values():
		lbl.visible = false
	for lbl in loader.verb_labels.values():
		lbl.visible = false
	for lbl in loader.cluster_labels.values():
		lbl.visible = true
	for eb in loader.edge_bodies.values():
		eb.visible = false

	lecture_time = 0.0
	current_edge_index = -1

	# Snap camera to edge 0's close pose immediately.
	var first_pose: Dictionary = keyframes[0].close_pose
	_apply_close_pose(first_pose)

	# Tween was removed — camera is driven purely from `lecture_time` in
	# `_process` via `_drive_camera_from_time()`. This eliminates the
	# dual-writer conflict between Tween and the overlay override, makes
	# the camera path deterministic, and guarantees the triple is in
	# frame at every moment because the close pose is recomputed each
	# frame based on the currently active edge.
	if tween != null and tween.is_valid():
		tween.kill()
	tween = null

	# Audio: prefer the concatenated narration.wav when present (one stream
	# start, no per-edge restart risk, exact parity with the Blender render).
	# Fall back to per-edge clips if it's missing.
	var narration_path: String = loader.lecture_dir.path_join("audio_clips").path_join("narration.wav")
	using_narration_wav = FileAccess.file_exists(narration_path)
	if using_narration_wav:
		var stream = loader.load_wav(narration_path)
		if stream != null:
			if narrator_player.playing:
				narrator_player.stop()
			narrator_player.stream = stream
			narrator_player.play()
			print("[lecture_mode] narration.wav started (%.1f MB)" % (FileAccess.get_file_as_bytes(narration_path).size() / 1048576.0))
		else:
			using_narration_wav = false
	if not using_narration_wav:
		_start_edge_audio(0)
	current_edge_index = 0
	_refresh_label_visibility()

	active = true
	set_process(true)
	if not hud_hidden:
		banner_label.visible = true
		progress_label.visible = true
		subtitle_label.visible = true
	_update_ui()
	print("[lecture_mode] start — %d edges, total %.1fs" % [keyframes.size(), total_duration])

func stop() -> void:
	if not active:
		return
	active = false
	set_process(false)
	if tween != null and tween.is_valid():
		tween.kill()
	tween = null
	if narrator_player.playing:
		narrator_player.stop()
	banner_label.visible = false
	progress_label.visible = false
	subtitle_label.visible = false

	# Restore free-flight default: all labels + all edges visible.
	loader.set_all_labels_visible(true)
	for eb in loader.edge_bodies.values():
		eb.visible = true

	if "enabled" in camera:
		camera.enabled = true
	if camera.has_method("reset_look_angles"):
		camera.reset_look_angles()
	print("[lecture_mode] stop")

# ─── per-frame loop ─────────────────────────────────────────────────────────
func _process(delta: float) -> void:
	if not active:
		return
	lecture_time += delta

	var new_idx := _find_edge_at(lecture_time)
	if new_idx != current_edge_index:
		current_edge_index = new_idx
		if not using_narration_wav and new_idx >= 0 and new_idx < keyframes.size():
			_start_edge_audio(new_idx)
		_update_ui()

	# Drive the camera directly from lecture_time. No tween, no pre-
	# scheduled state. The overlay override runs AFTER this inside
	# _refresh_label_visibility, so when an overlay is active it wins.
	_drive_camera_from_time()

	_refresh_label_visibility()

	if lecture_time >= total_duration:
		stop()
		return

	if progress_label != null and int(lecture_time * 4) != int((lecture_time - delta) * 4):
		_update_progress_timer()

# Per-frame camera position computed from `lecture_time`. During the
# middle 50% of an edge we hold the close pose; during the first 25%
# we lerp FROM the previous edge's close pose (zoom-in), and during the
# last 25% we lerp TO the next edge's close pose (zoom-out). Cubic
# ease-in-out on the lerp parameter keeps the motion smooth. No Tween,
# so the overlay camera override can stomp the camera without conflict.
func _drive_camera_from_time() -> void:
	var i: int = current_edge_index
	if i < 0 or i >= keyframes.size():
		return
	var kf: Dictionary = keyframes[i]
	var s: float = kf.start
	var d: float = kf.duration
	var close_i: Dictionary = kf.close_pose

	# First 25% of edge i: zoom-in from previous edge's close pose.
	var zoom_in_end: float = s + d * TRANSITION_FRACTION
	if i > 0 and lecture_time < zoom_in_end:
		var prev_kf: Dictionary = keyframes[i - 1]
		var trans_start: float = prev_kf.start + prev_kf.duration * HOLD_FRACTION
		var trans_len: float = zoom_in_end - trans_start
		if trans_len > 0.001:
			var u: float = clamp((lecture_time - trans_start) / trans_len, 0.0, 1.0)
			_apply_interpolated_pose(prev_kf.close_pose, close_i, _ease_in_out_cubic(u))
			return
		_apply_close_pose(close_i)
		return

	# Last 25% of edge i: zoom-out toward next edge's close pose.
	var hold_end: float = s + d * HOLD_FRACTION
	if i + 1 < keyframes.size() and lecture_time >= hold_end:
		var next_kf: Dictionary = keyframes[i + 1]
		var trans_end: float = next_kf.start + next_kf.duration * TRANSITION_FRACTION
		var trans_len2: float = trans_end - hold_end
		if trans_len2 > 0.001:
			var u2: float = clamp((lecture_time - hold_end) / trans_len2, 0.0, 1.0)
			_apply_interpolated_pose(close_i, next_kf.close_pose, _ease_in_out_cubic(u2))
			return

	# Middle 50% (or last-edge tail): hold close pose.
	_apply_close_pose(close_i)

func _apply_interpolated_pose(p0: Dictionary, p1: Dictionary, u: float) -> void:
	var pos: Vector3 = p0.pos.lerp(p1.pos, u)
	var target: Vector3 = p0.target.lerp(p1.target, u)
	if not _is_finite_vec(pos) or not _is_finite_vec(target):
		return
	camera.global_position = pos
	_safe_look_at(target)

func _ease_in_out_cubic(t: float) -> float:
	if t < 0.5:
		return 4.0 * t * t * t
	var f: float = -2.0 * t + 2.0
	return 1.0 - f * f * f * 0.5

# ─── label visibility per frame ────────────────────────────────────────────
# Pattern: compute visibility from time. NEVER mutate state over time.
# Every frame rebuilds the full visibility picture from scratch; the only
# source of truth is `lecture_time` + the edge schedule. This avoids the
# "only ever set to true" accumulation bug that left 74+ edges visible at
# t=600 in the v2 render.
const VIS_GAP: float = 0.08  # 80ms grace window on each side of an edge

func _refresh_label_visibility() -> void:
	var t: float = lecture_time
	var show_edges: Dictionary = {}   # edge index int -> true
	var show_nodes: Dictionary = {}   # node id -> true
	var show_verbs: Dictionary = {}   # edge index int -> true
	var show_clusters: Dictionary = {}  # cluster id -> true

	# Pass 1 — active edges + their node/verb labels.
	# Each edge is visible iff t ∈ [audio_start - VIS_GAP, audio_end + VIS_GAP].
	for i in range(keyframes.size()):
		var kf: Dictionary = keyframes[i]
		var s: float = kf.start
		var d: float = kf.duration
		var active: bool = (t >= s - VIS_GAP) and (t <= s + d + VIS_GAP)
		if not active:
			continue
		var edge: Dictionary = kf.edge
		show_edges[kf.index] = true
		show_nodes[edge.from] = true
		show_nodes[edge.to] = true
		show_verbs[kf.index] = true

		# Cluster labels are shown during the "overview plateau" at the
		# end of this edge (hold_end to next edge's zoom_in_end).
		var zoom_out_start: float = s + d * HOLD_FRACTION
		var next_zoom_in_end: float = s + d
		if i + 1 < keyframes.size():
			var next_kf: Dictionary = keyframes[i + 1]
			next_zoom_in_end = next_kf.start + next_kf.duration * TRANSITION_FRACTION
		if t >= zoom_out_start - VIS_GAP and t <= next_zoom_in_end + VIS_GAP:
			var from_cid = loader.node_data.get(edge.from, {}).get("cluster_id", "")
			var to_cid = loader.node_data.get(edge.to, {}).get("cluster_id", "")
			if from_cid != "": show_clusters[from_cid] = true
			if to_cid != "": show_clusters[to_cid] = true

	# Pass 2 — apply the computed visibility state to every edge/node/verb/
	# cluster label in the world. This flips BOTH directions every frame.
	# For the active edge we also swap to the exaggerated "bowed-to-sphere"
	# mesh so its curve arcs outward into empty space, guaranteeing S/V/O
	# labels aren't buried by sibling cluster nodes.
	for idx in loader.edge_bodies.keys():
		var is_on: bool = show_edges.has(idx)
		loader.edge_bodies[idx].visible = is_on
		loader.set_edge_active(idx, is_on)
	for id in loader.node_labels.keys():
		loader.node_labels[id].visible = show_nodes.has(id)
	for idx in loader.verb_labels.keys():
		loader.verb_labels[idx].visible = show_verbs.has(idx)
	# Cluster labels are permanently visible in lecture mode per user
	# directive — they act as spatial anchors so the viewer always knows
	# which cluster the current SPO lives in. We intentionally DO NOT use
	# show_clusters here.
	for id in loader.cluster_labels.keys():
		loader.cluster_labels[id].visible = true


	# Image overlays from overlay_timeline.json — visible during their
	# own [start, end] window, hidden otherwise.
	var active_overlay = null
	for entry in loader.overlay_entries:
		var obj = entry.get("obj", null)
		if obj == null:
			continue
		var os: float = float(entry.get("start", 0.0))
		var oe: float = float(entry.get("end", 0.0))
		var oa: bool = t >= os and t < oe
		obj.visible = oa
		if oa and active_overlay == null:
			active_overlay = entry

	# Camera override for overlay windows — places the camera to frame
	# the image plane, in addition to whatever the Tween set this frame.
	if active_overlay != null:
		_pin_overlay_to_camera_right(active_overlay)

# ─── schedule derivation ────────────────────────────────────────────────────
func _compute_schedule() -> void:
	keyframes.clear()
	total_duration = 0.0
	var edges: Array = loader.data.get("edges", [])

	# Compute global center + radius from placed node positions (the Godot-
	# space positions, after bvec conversion). Used for outward bias and
	# overview pose's center pull.
	var positions: Array = []
	for id in loader.node_bodies.keys():
		positions.append((loader.node_bodies[id] as Node3D).position)
	if positions.is_empty():
		global_center = Vector3.ZERO
		global_radius = 50.0
	else:
		var sum := Vector3.ZERO
		for p in positions:
			sum += p
		global_center = sum / positions.size()
		var max_d := 0.0
		for p in positions:
			var dd: float = (p - global_center).length()
			if dd > max_d:
				max_d = dd
		global_radius = max(max_d, 15.0)

	# Pass 1: build per-edge close poses (requires index for tilt/lift variation).
	var pose_index := 0
	for e in edges:
		var d := float(e.get("audio_duration", 0.0))
		if d <= 0.0:
			continue
		var from_id: String = String(e.get("from", ""))
		var to_id: String = String(e.get("to", ""))
		if not loader.node_bodies.has(from_id) or not loader.node_bodies.has(to_id):
			continue
		var s := float(e.get("audio_start", 0.0))
		var close_pose: Dictionary = _edge_close_pose(e, pose_index)
		keyframes.append({
			"edge": e,
			"index": int(e.get("index", -1)),
			"start": s,
			"duration": d,
			"close_pose": close_pose,
			"pose_index": pose_index,
		})
		if s + d > total_duration:
			total_duration = s + d
		pose_index += 1

func _find_edge_at(t: float) -> int:
	for i in range(keyframes.size()):
		var kf: Dictionary = keyframes[i]
		if t < kf.start + kf.duration:
			return i
	return keyframes.size() - 1

# ─── pose geometry ─────────────────────────────────────────────────────────
# Perpendicular-to-edge radial framing. Camera approach direction is
# (world_origin → mid_edge) PROJECTED ONTO the plane perpendicular to the
# edge. Guarantees:
#   - Camera is never looking down the edge axis (edge spans the full
#     horizontal frame instead of collapsing to a dot).
#   - Triple centered: target == edge midpoint.
#   - Radial bias keeps the camera outside the graph cloud.
#   - No Rodrigues tilt / no lift / no per-edge variation, so framing is
#     deterministic and always fits.
func _edge_close_pose(edge: Dictionary, i: int) -> Dictionary:
	var a_id: String = String(edge.get("from", ""))
	var b_id: String = String(edge.get("to", ""))
	var a: Vector3 = (loader.node_bodies[a_id] as Node3D).position
	var b: Vector3 = (loader.node_bodies[b_id] as Node3D).position
	var mid := (a + b) * 0.5
	var diff := b - a
	var edge_len: float = diff.length()
	var edge_dir: Vector3 = diff.normalized() if edge_len > 0.001 else Vector3.RIGHT

	# Approach direction = (mid - origin) PROJECTED onto the plane that is
	# perpendicular to the edge. This guarantees the camera looks at the
	# edge side-on so the full edge length spans the horizontal frame axis,
	# not head-on (which would make a long edge project as a dot). NO
	# post-hoc y bias — that used to re-introduce along-edge component and
	# silently shorten the horizontal projection of long cross-cluster
	# edges, which is the bug the user reported: "just the middle of the
	# edge P is shown, not the three components of the triple".
	var out_vec: Vector3 = mid - global_center
	if out_vec.length() < 0.01:
		out_vec = Vector3(0, 0, 1)
	# Apply a mild upward bias BEFORE projection, so the projection step
	# maintains strict perpendicularity.
	out_vec += Vector3(0, out_vec.length() * 0.12, 0)
	var outward: Vector3 = out_vec.normalized()
	var along: float = outward.dot(edge_dir)
	var perp: Vector3 = outward - edge_dir * along
	# If outward is parallel to edge, fall back to any perpendicular.
	if perp.length() < 0.01:
		perp = Vector3.UP - edge_dir * edge_dir.dot(Vector3.UP)
		if perp.length() < 0.01:
			perp = Vector3.RIGHT - edge_dir * edge_dir.dot(Vector3.RIGHT)
	perp = perp.normalized()

	# With the active-bow mesh, the bezier midpoint (where the verb label
	# sits) is pushed outward to the cluster sphere border — well off the
	# straight S-O line. The camera has to frame the whole S/verb-mid/O
	# triangle, not just the straight edge. We look at the centroid of
	# those three points and fit the bounding-box extents along the
	# horizontal (perp) and vertical (up) axes in camera space.
	var active_mid: Vector3 = mid
	var edge_idx: int = int(edge.get("index", -1))
	if edge_idx >= 0 and loader.edge_active_mid.has(edge_idx):
		active_mid = loader.edge_active_mid[edge_idx]
	var focus_target: Vector3 = (a + b + active_mid) / 3.0

	# Build a camera-space frame: forward is already `perp` (pointed at the
	# edge from outside); right is along the edge; up is perp × right.
	var right_axis: Vector3 = edge_dir
	var up_axis: Vector3 = perp.cross(right_axis).normalized()

	var pts: Array = [a, b, active_mid]
	var half_h: float = 0.0   # horizontal half-extent along right_axis
	var half_v: float = 0.0   # vertical half-extent along up_axis
	for p in pts:
		var rel: Vector3 = p - focus_target
		half_h = max(half_h, abs(rel.dot(right_axis)))
		half_v = max(half_v, abs(rel.dot(up_axis)))

	var label_margin: float = EDGE_LENGTH_MARGIN + 10.0
	var label_stack_height: float = 3.0
	var needed_h: float = (half_h * 2.0 + label_margin) * 0.5 / tan(HALF_H_FOV)
	var needed_v: float = (max(half_v * 2.0, label_stack_height) + VERTICAL_MARGIN) * 0.5 / tan(HALF_V_FOV)
	var base_dist: float = max(needed_h, needed_v)
	var dist: float = clamp(base_dist * SAFETY_MULTIPLIER, MIN_DISTANCE, MAX_DISTANCE)

	var pos: Vector3 = focus_target + perp * dist
	return {
		"pos": pos,
		"target": focus_target,
		"dist": dist,
		"dir": perp,
	}

func _rodrigues(v: Vector3, axis: Vector3, angle: float) -> Vector3:
	# Rodrigues rotation of vector v around unit axis by angle (radians).
	var c: float = cos(angle)
	var s: float = sin(angle)
	var cross := axis.cross(v)
	var dot := axis.dot(v)
	return v * c + cross * s + axis * dot * (1.0 - c)

func _overview_pose(a_kf: Dictionary, b_kf: Dictionary) -> Dictionary:
	# Overview target: midpoint of the two triples, biased toward the global
	# scene center so the viewer sees spatial context, not just the two edges.
	var ta: Vector3 = a_kf.close_pose.target
	var tb: Vector3 = b_kf.close_pose.target
	var mid_target: Vector3 = (ta + tb) * 0.5 * (1.0 - GLOBAL_CENTER_BIAS) + global_center * GLOBAL_CENTER_BIAS

	# Overview camera: pulled back by ZOOM_OUT_FACTOR, elevated 8° more than
	# the average of the two close poses (capped at 42° to avoid top-down),
	# with a small yaw twist for 3D feel. In the reference Blender renderer (z-up)
	# code the yaw/pitch math uses trig; in Godot we can just take the
	# average direction of the two close poses, rotate it toward +Y a bit,
	# and rotate slightly around +Y (yaw twist).
	var dir_a: Vector3 = a_kf.close_pose.dir
	var dir_b: Vector3 = b_kf.close_pose.dir
	var avg_dir: Vector3 = (dir_a + dir_b).normalized()
	if avg_dir.length() < 0.01:
		avg_dir = Vector3.UP

	# Apply extra pitch lift (toward +Y), capped.
	var horiz_len: float = Vector2(avg_dir.x, avg_dir.z).length()
	var cur_pitch: float = atan2(avg_dir.y, max(0.0001, horiz_len))
	var new_pitch: float = min(cur_pitch + OVERVIEW_PITCH_LIFT, OVERVIEW_PITCH_CAP)
	var new_horiz: float = cos(new_pitch)
	var new_y: float = sin(new_pitch)
	# Preserve horizontal direction from avg_dir, rescale.
	var horiz: Vector3 = Vector3(avg_dir.x, 0.0, avg_dir.z)
	if horiz.length() < 0.001:
		horiz = Vector3.RIGHT
	horiz = horiz.normalized() * new_horiz
	var new_dir: Vector3 = Vector3(horiz.x, new_y, horiz.z).normalized()

	# Yaw twist around +Y.
	new_dir = new_dir.rotated(Vector3.UP, OVERVIEW_YAW_TWIST)

	var mid_dist: float = max(global_radius * 0.9, a_kf.close_pose.dist * ZOOM_OUT_FACTOR)
	var pos: Vector3 = mid_target + new_dir * mid_dist
	return {
		"pos": pos,
		"target": mid_target,
		"dist": mid_dist,
		"dir": new_dir,
	}

# ─── camera pose applied to the Camera3D ───────────────────────────────────
func _is_finite_vec(v: Vector3) -> bool:
	return is_finite(v.x) and is_finite(v.y) and is_finite(v.z)

func _apply_close_pose(pose: Dictionary) -> void:
	var p: Vector3 = pose.pos
	var t: Vector3 = pose.target
	if not _is_finite_vec(p) or not _is_finite_vec(t):
		push_error("[lecture_mode] close pose NaN: pos=%s target=%s" % [p, t])
		return
	camera.global_position = p
	_safe_look_at(t)

func _apply_bezier(u: float, p0: Dictionary, p1: Dictionary, p2: Dictionary) -> void:
	var one_minus := 1.0 - u
	var b0 := one_minus * one_minus
	var b1 := 2.0 * one_minus * u
	var b2 := u * u
	var pos: Vector3 = p0.pos * b0 + p1.pos * b1 + p2.pos * b2
	var target: Vector3 = p0.target * b0 + p1.target * b1 + p2.target * b2
	if not _is_finite_vec(pos) or not _is_finite_vec(target):
		push_error("[lecture_mode] bezier NaN at u=%f" % u)
		return
	camera.global_position = pos
	_safe_look_at(target)

func _pin_overlay_to_camera_right(entry: Dictionary) -> void:
	# Place the overlay plane in camera-local space so it always appears
	# anchored to the right side of the frame, regardless of where the
	# camera is looking. The camera itself is untouched — it keeps
	# framing the active SPO triple.
	var obj = entry.get("obj", null)
	if obj == null:
		return
	var xform: Transform3D = camera.global_transform
	var cam_pos: Vector3 = xform.origin
	var cam_forward: Vector3 = -xform.basis.z
	var cam_right: Vector3 = xform.basis.x
	var cam_up: Vector3 = xform.basis.y

	# Plane sits `depth` units in front of the camera, offset to the right
	# by ~35% of the frame half-width so the plane's LEFT edge sits ~0.35
	# from screen center (putting the whole 14-unit plane in the right
	# half of the frame).
	const OVERLAY_W: float = 14.0
	var depth: float = OVERLAY_W * 1.1 / (2.0 * max(0.001, tan(HALF_V_FOV)))
	# depth is the distance at which the plane fits exactly in the
	# vertical frame; multiply by 1.15 so the plane takes ~87% of
	# vertical frame height (readable but not hogging).
	depth = depth * 1.15
	var frame_half_width: float = depth * tan(HALF_H_FOV)
	var right_offset: float = frame_half_width * 0.35  # into the right half
	var pos: Vector3 = cam_pos + cam_forward * depth + cam_right * right_offset
	if not _is_finite_vec(pos):
		return
	(obj as Node3D).global_position = pos

func _safe_look_at(target: Vector3) -> void:
	var dir := (target - camera.global_position)
	if dir.length() < 0.001:
		return
	var up := Vector3.UP
	if abs(dir.normalized().dot(up)) > 0.99:
		up = Vector3.RIGHT
	camera.look_at(target, up)

# ─── audio ──────────────────────────────────────────────────────────────────
func _start_edge_audio(i: int) -> void:
	if i < 0 or i >= keyframes.size():
		return
	var kf: Dictionary = keyframes[i]
	var clip_rel: String = String(kf.edge.get("audio_clip", ""))
	if clip_rel == "":
		return
	var abs_path: String = loader.lecture_dir.path_join(clip_rel)
	var stream = loader.load_wav(abs_path)
	if stream == null:
		push_error("[lecture_mode] failed to load " + abs_path)
		return
	if narrator_player.playing:
		narrator_player.stop()
	narrator_player.stream = stream
	narrator_player.play()
	print("[lecture_mode] edge %d audio=%s t=%.2f" % [i, clip_rel, lecture_time])

# ─── UI update ──────────────────────────────────────────────────────────────
func _update_ui() -> void:
	if current_edge_index < 0 or current_edge_index >= keyframes.size():
		return
	var kf: Dictionary = keyframes[current_edge_index]
	var edge: Dictionary = kf.edge
	subtitle_label.text = String(edge.get("subtitle", ""))
	_update_progress_timer()

func _update_progress_timer() -> void:
	if current_edge_index < 0 or current_edge_index >= keyframes.size():
		return
	var kf: Dictionary = keyframes[current_edge_index]
	var edge: Dictionary = kf.edge
	var from_label: String = String(edge.get("from_label", edge.get("from", "")))
	var to_label: String = String(edge.get("to_label", edge.get("to", "")))
	var verb: String = String(edge.get("verb", "—"))
	progress_label.text = "edge %d / %d    t = %5.1f / %.1fs    %s — %s → %s" % [
		current_edge_index + 1,
		keyframes.size(),
		lecture_time,
		total_duration,
		from_label,
		verb,
		to_label,
	]
