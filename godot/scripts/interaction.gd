extends Node

# Click picking + info panel + audio playback.
# Left click: raycast from the crosshair; if we hit a node body show its
# metadata; if we hit an edge body show its SPO and play the audio clip.

var camera: Camera3D
var loader  # world_loader.gd instance
var lecture_mode  # lecture_mode.gd instance — clicks are suppressed while active

var info_panel: Panel
var info_label: Label
var crosshair_label: Label
var help_label: Label
# AudioStreamPlayer3D so click-to-play clips have spatial falloff from the
# edge's 3D position. Lecture mode uses a separate non-positional player
# (see lecture_mode.gd::narrator_player).
var audio_player_3d: AudioStreamPlayer3D

func _ready() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	info_panel = Panel.new()
	info_panel.custom_minimum_size = Vector2(480, 180)
	info_panel.position = Vector2(20, 20)
	info_panel.size = Vector2(480, 180)
	info_panel.visible = false
	layer.add_child(info_panel)

	info_label = Label.new()
	info_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info_label.anchor_right = 1.0
	info_label.anchor_bottom = 1.0
	info_label.offset_left = 12
	info_label.offset_top = 10
	info_label.offset_right = -12
	info_label.offset_bottom = -10
	info_label.add_theme_font_size_override("font_size", 16)
	info_panel.add_child(info_label)

	# Crosshair.
	var crosshair := Label.new()
	crosshair.text = "+"
	crosshair.add_theme_color_override("font_color", Color(1, 1, 1, 0.85))
	crosshair.add_theme_font_size_override("font_size", 24)
	crosshair.anchor_left = 0.5
	crosshair.anchor_top = 0.5
	crosshair.anchor_right = 0.5
	crosshair.anchor_bottom = 0.5
	crosshair.offset_left = -8
	crosshair.offset_top = -14
	layer.add_child(crosshair)
	crosshair_label = crosshair

	# Help text.
	var help := Label.new()
	help.text = "WASD move | Shift sprint | Q/E down/up | Mouse look | LMB pick | Esc release mouse"
	help.add_theme_color_override("font_color", Color(0.8, 0.85, 0.9, 0.7))
	help.add_theme_font_size_override("font_size", 13)
	help.anchor_left = 0.0
	help.anchor_top = 1.0
	help.anchor_right = 1.0
	help.anchor_bottom = 1.0
	help.offset_left = 16
	help.offset_top = -28
	help.offset_right = -16
	help.offset_bottom = -8
	help.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	layer.add_child(help)
	help_label = help

	audio_player_3d = AudioStreamPlayer3D.new()
	audio_player_3d.unit_size = 30.0
	audio_player_3d.max_distance = 300.0
	audio_player_3d.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
	add_child(audio_player_3d)

func _process(_delta: float) -> void:
	# Hide free-flight HUD (help + crosshair + info panel) while the
	# lecture mode Tween is driving the camera — keeps the recorded
	# movie clean.
	var lm_active: bool = lecture_mode != null and lecture_mode.active
	if help_label != null:
		help_label.visible = not lm_active
	if crosshair_label != null:
		crosshair_label.visible = not lm_active
	if info_panel != null and lm_active:
		info_panel.visible = false

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		# Suppress free-flight click-to-play while lecture mode is driving
		# its own narrator — otherwise the two voices overlap.
		if lecture_mode != null and lecture_mode.active:
			return
		_pick()

func _pick() -> void:
	if camera == null or loader == null:
		return
	var viewport := get_viewport()
	var center := viewport.get_visible_rect().size * 0.5
	var origin := camera.project_ray_origin(center)
	var direction := camera.project_ray_normal(center)
	var to := origin + direction * 10000.0
	var space := camera.get_world_3d().direct_space_state
	var params := PhysicsRayQueryParameters3D.create(origin, to)
	var hit := space.intersect_ray(params)
	if hit.is_empty():
		info_panel.visible = false
		return
	var body = hit.collider
	if body == null or not body.has_meta("kind"):
		return
	var kind: String = body.get_meta("kind")
	if kind == "node":
		_show_node(body.get_meta("id"))
	elif kind == "edge":
		_show_edge(int(body.get_meta("index")))

func _show_node(id: String) -> void:
	var n: Dictionary = loader.node_data.get(id, {})
	if n.is_empty():
		return
	info_label.text = "NODE: %s\n\nid: %s\ncluster: %s\nedges: in %d, out %d\ntype: %s" % [
		n.get("label", id),
		id,
		n.get("cluster_id", ""),
		int(n.get("edge_in_count", 0)),
		int(n.get("edge_out_count", 0)),
		n.get("type", "default"),
	]
	info_panel.visible = true

func _show_edge(idx: int) -> void:
	var e: Dictionary = loader.edge_data.get(idx, {})
	if e.is_empty():
		return
	info_label.text = "EDGE %d: %s — %s → %s\n\n%s" % [
		idx,
		e.get("from_label", e.get("from", "")),
		e.get("verb", "—"),
		e.get("to_label", e.get("to", "")),
		e.get("subtitle", ""),
	]
	info_panel.visible = true
	var clip = e.get("audio_clip", null)
	if clip != null and String(clip) != "":
		var abs_path: String = loader.lecture_dir.path_join(String(clip))
		var stream = loader.load_wav(abs_path)
		if stream != null:
			# Move the 3D audio player to the edge midpoint so the click
			# sound emanates from the correct 3D location.
			var edge_body = loader.edge_bodies.get(idx, null)
			if edge_body != null:
				audio_player_3d.global_position = edge_body.global_position
			audio_player_3d.stream = stream
			audio_player_3d.play()
		else:
			push_error("No audio stream for " + abs_path)
