extends Node3D

# Root orchestrator for the TextVis Game walking skeleton.
# Loads a lecture's world_state.json and sets up camera + picking.

const WorldLoader := preload("res://scripts/world_loader.gd")
const FlyCamera := preload("res://scripts/fly_camera.gd")
const Interaction := preload("res://scripts/interaction.gd")
const LectureMode := preload("res://scripts/lecture_mode.gd")

@export var lecture_basename: String = "fuzzy_logic_zadeh_1965_information_control"

var camera: Camera3D
var loader
var interaction
var lecture_mode
var preview_mode: bool = false

func _ready() -> void:
	# --lecture <basename> cmdline override so we can run multiple lectures
	# without editing the default. Godot passes "-- --lecture X" as user args.
	var user_args := OS.get_cmdline_user_args()
	for i in range(user_args.size() - 1):
		if user_args[i] == "--lecture":
			lecture_basename = user_args[i + 1]
			break

	# Lighting — cheap ambient + one directional light.
	var env_node := WorldEnvironment.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.02, 0.02, 0.04)
	env.ambient_light_color = Color(0.55, 0.55, 0.65)
	env.ambient_light_energy = 0.6
	env_node.environment = env
	add_child(env_node)

	var dir_light := DirectionalLight3D.new()
	dir_light.light_energy = 0.9
	dir_light.rotation_degrees = Vector3(-45, -35, 0)
	add_child(dir_light)

	# Camera with fly controller. fly_camera.gd extends Camera3D, so .new()
	# yields a Camera3D-typed instance. FOV matches the reference Blender
	# camera (~65° horizontal / 37° vertical), configured from
	# tools/pipeline-config.json:camera.fov_vertical_deg.
	camera = FlyCamera.new()
	camera.current = true
	camera.near = 0.1
	camera.far = 4000.0
	camera.fov = 37.0
	add_child(camera)

	# World loader reads world_state.json and spawns geometry.
	loader = WorldLoader.new()
	add_child(loader)

	# Resolve lecture dir: res:// → <repo>/godot/, parent → <repo>/, then /lectures/<basename>/
	var project_root := ProjectSettings.globalize_path("res://").trim_suffix("/")
	var repo_root := project_root.get_base_dir()
	var lecture_dir: String = repo_root.path_join("lectures").path_join(lecture_basename)

	var ok: bool = loader.load_lecture(lecture_dir)
	if not ok:
		push_error("Failed to load lecture: " + lecture_dir)
		return

	# Position camera outside the graph looking at the origin.
	var r: float = loader.world_radius
	camera.position = Vector3(r * 2.0, r * 1.2, r * 2.0)
	camera.look_at(Vector3.ZERO, Vector3.UP)
	camera.reset_look_angles()

	# Picking + UI.
	interaction = Interaction.new()
	interaction.camera = camera
	interaction.loader = loader
	add_child(interaction)

	# Lecture mode (Phase 4). Uses its own CanvasLayer for banner/subtitles.
	lecture_mode = LectureMode.new()
	lecture_mode.camera = camera
	lecture_mode.loader = loader
	# Recording mode detection: if Godot was launched with --write-movie OR
	# main.gd's --auto-lecture, we suppress the lecture_mode HUD (banner /
	# progress / subtitle strip) so the rendered video doesn't have
	# persistent UI burned in.
	var cmdline := OS.get_cmdline_args()
	var is_recording := false
	for a in cmdline:
		if a == "--write-movie":
			is_recording = true
			break
	if not is_recording and "--auto-lecture" in user_args:
		is_recording = true
	lecture_mode.hud_hidden = is_recording
	add_child(lecture_mode)
	lecture_mode.setup_ui()
	interaction.lecture_mode = lecture_mode

	# Capture mouse by default; Esc toggles.
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

	print("TextVis Game loaded: %s nodes=%d edges=%d clusters=%d radius=%.1f" % [
		lecture_basename, loader.node_count(), loader.edge_count(), loader.cluster_count(), r
	])

	# --screenshot <path>: capture a single still of the free-flight scene
	# (no lecture mode) then quit. Useful for offline visual verification.
	for i in range(user_args.size() - 1):
		if user_args[i] == "--screenshot":
			_run_single_screenshot(user_args[i + 1])
			return

	# --auto-lecture: auto-start lecture mode after one frame and quit when
	# it ends. Used with --headless --write-movie for the parity spike.
	if "--auto-lecture" in user_args:
		_run_auto_lecture()
		return

	# Preview mode: auto-start lecture mode and capture viewport screenshots
	# for an offline visual check. Triggered by --preview on the command line.
	if "--preview" in OS.get_cmdline_args() or "--preview" in OS.get_cmdline_user_args():
		preview_mode = true
		_run_preview_capture()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_ESCAPE:
			if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
			else:
				Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
		elif event.keycode == KEY_SPACE:
			if lecture_mode != null:
				lecture_mode.toggle()
				get_viewport().set_input_as_handled()

func _run_auto_lecture() -> void:
	# Give the world one frame to finish spawning, then start lecture mode
	# and poll for completion. Mouse stays free. Exit the engine as soon as
	# lecture_mode deactivates. Used with --headless --write-movie for the
	# offline parity render.
	#
	# Optional: --max-time N forces quit after N seconds of lecture_time,
	# for short test renders.
	var max_time: float = -1.0
	var uargs := OS.get_cmdline_user_args()
	for i in range(uargs.size() - 1):
		if uargs[i] == "--max-time":
			max_time = float(uargs[i + 1])
			break
	await get_tree().process_frame
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	print("[auto-lecture] starting… max_time=%s" % str(max_time))
	lecture_mode.start()
	while lecture_mode.active:
		await get_tree().process_frame
		if max_time > 0.0 and lecture_mode.lecture_time >= max_time:
			print("[auto-lecture] max_time reached at %.2fs" % lecture_mode.lecture_time)
			lecture_mode.stop()
			break
	print("[auto-lecture] done")
	get_tree().quit()

func _run_single_screenshot(path: String) -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	var img := get_viewport().get_texture().get_image()
	if img != null:
		DirAccess.make_dir_recursive_absolute(path.get_base_dir())
		img.save_png(path)
		print("[screenshot] wrote " + path)
	else:
		push_error("[screenshot] no image captured")
	get_tree().quit()

# ─── preview capture (offline visual check) ────────────────────────────────
func _run_preview_capture() -> void:
	await get_tree().process_frame
	# Output dir: --preview-dir <path>, else user://preview_frames.
	var out_dir := ProjectSettings.globalize_path("user://preview_frames")
	var pargs := OS.get_cmdline_user_args()
	for i in range(pargs.size() - 1):
		if pargs[i] == "--preview-dir":
			out_dir = pargs[i + 1]
			break
	DirAccess.make_dir_recursive_absolute(out_dir)
	# Clean previous frames in case of re-run.
	var d := DirAccess.open(out_dir)
	if d != null:
		for f in d.get_files():
			if f.ends_with(".png"):
				d.remove(f)

	# Free the mouse so capture isn't blocked by mouse capture, then start.
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	lecture_mode.start()

	var capture_interval := 0.3
	var total_capture := 45.0
	var frame_idx := 0
	var t := 0.0
	while t < total_capture:
		await get_tree().create_timer(capture_interval).timeout
		var img := get_viewport().get_texture().get_image()
		if img != null:
			img.save_png("%s/frame_%04d.png" % [out_dir, frame_idx])
			frame_idx += 1
		t += capture_interval

	print("[preview] captured %d frames to %s" % [frame_idx, out_dir])
	get_tree().quit()
