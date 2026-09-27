extends Node3D

# Reads a lecture's world_state.json and spawns clusters, nodes, edges.
# Positions are Blender z-up; we rotate into Godot y-up via bvec().

const VerbColors := preload("res://scripts/verb_colors.gd")

var world_radius: float = 50.0
var lecture_dir: String = ""
var data: Dictionary = {}

var node_bodies: Dictionary = {}   # node id -> StaticBody3D
var edge_bodies: Dictionary = {}   # edge index (int) -> StaticBody3D
var node_data: Dictionary = {}     # node id -> Dictionary
var edge_data: Dictionary = {}     # edge index (int) -> Dictionary

# Dual-mesh edge system: every edge pre-builds TWO tube meshes — a
# subtle-bow normal version, and an exaggerated-bow active version that
# arcs outward from the host cluster so the curve (and the verb label on
# its midpoint) reach empty space beyond the dense cluster interior.
# lecture_mode toggles between them via set_edge_active(idx, active).
var edge_mesh_instances: Dictionary = {}  # idx -> MeshInstance3D inside the body
var edge_normal_mesh: Dictionary = {}     # idx -> ArrayMesh (subtle bow)
var edge_active_mesh: Dictionary = {}     # idx -> ArrayMesh (big bow)
var edge_normal_mid: Dictionary = {}      # idx -> Vector3 (verb label pos, normal)
var edge_active_mid: Dictionary = {}      # idx -> Vector3 (verb label pos, active)
var edge_active_state: Dictionary = {}    # idx -> bool (which mesh is mounted)

# Label references for the visibility-toggling rules. In free-flight all
# labels are visible by default; lecture_mode hides them and shows only
# the active SPO + active cluster labels.
var node_labels: Dictionary = {}     # node id -> Label3D
var verb_labels: Dictionary = {}     # edge index (int) -> Label3D
var cluster_labels: Dictionary = {}  # cluster id -> Label3D

# Image overlays loaded from overlay_assets/overlay_timeline.json. Keyed
# by array index, each value is {obj: MeshInstance3D, start: float,
# end: float, node_id: String, kind: String, caption: String}.
var overlay_entries: Array = []

const OVERLAY_PLANE_SIZE: float = 14.0

func node_count() -> int:
	return node_bodies.size()
func edge_count() -> int:
	return edge_bodies.size()
func cluster_count() -> int:
	return int(data.get("clusters", []).size())

static func bvec(p) -> Vector3:
	# Blender (x,y,z) with +Z up → Godot (x,y,z) with +Y up.
	return Vector3(float(p[0]), float(p[2]), -float(p[1]))

func load_lecture(dir: String) -> bool:
	lecture_dir = dir
	var state_path := dir.path_join("world_state.json")
	var f := FileAccess.open(state_path, FileAccess.READ)
	if f == null:
		push_error("world_state.json not found at " + state_path)
		return false
	var text := f.get_as_text()
	f.close()
	var parsed = JSON.parse_string(text)
	if parsed == null or typeof(parsed) != TYPE_DICTIONARY:
		push_error("Failed to parse " + state_path)
		return false
	data = parsed
	world_radius = float(data.get("scene", {}).get("global_radius", 50.0))

	_spawn_clusters()
	_spawn_nodes()
	_spawn_edges()
	_spawn_overlays()
	return true

func _spawn_clusters() -> void:
	for c in data.get("clusters", []):
		var center: Vector3 = bvec(c["center"])
		var radius: float = float(c["radius"])
		var mesh_inst := MeshInstance3D.new()
		var mesh := SphereMesh.new()
		mesh.radius = radius
		mesh.height = radius * 2.0
		mesh.radial_segments = 32
		mesh.rings = 16
		mesh_inst.mesh = mesh
		mesh_inst.position = center
		var mat := StandardMaterial3D.new()
		var col = c.get("color", [0.5, 0.5, 0.6])
		# Alpha 0.01 matches Blender's make_mat(..., alpha=0.01) for the
		# container sphere — the shell is structural containment only,
		# essentially invisible in render.
		mat.albedo_color = Color(float(col[0]), float(col[1]), float(col[2]), 0.01)
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mesh_inst.material_override = mat
		add_child(mesh_inst)

		# Cluster label — shown only during the overview transition out of
		# this cluster in lecture mode. Floats ~radius above the center.
		var clabel := Label3D.new()
		clabel.text = String(c.get("label", c["id"])).to_upper()
		clabel.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		clabel.font_size = 48
		clabel.outline_size = 12
		clabel.modulate = Color(1.0, 0.9, 0.55)
		clabel.outline_modulate = Color(0, 0, 0)
		clabel.position = center + Vector3(0, radius + 1.5, 0)
		clabel.pixel_size = 0.012
		clabel.no_depth_test = true
		clabel.render_priority = 1
		add_child(clabel)
		_attach_backdrop(clabel, 0.22)
		cluster_labels[c["id"]] = clabel

func _cluster_color_lookup() -> Dictionary:
	var map: Dictionary = {}
	for c in data.get("clusters", []):
		map[c["id"]] = c.get("color", [0.8, 0.8, 0.9])
	return map

func _spawn_nodes() -> void:
	# Matches blender_animated.py.reference lines 330-381: each node is
	# rendered as a PNG icon plane (Sprite3D in Godot) when the icon file
	# exists, or a small emissive sphere fallback when it doesn't.
	var cluster_colors := _cluster_color_lookup()
	var icons_dir: String = lecture_dir.path_join("png_icons")
	for n in data.get("nodes", []):
		var id: String = n["id"]
		node_data[id] = n
		var pos: Vector3 = bvec(n["position"])

		var body := StaticBody3D.new()
		body.position = pos
		body.set_meta("kind", "node")
		body.set_meta("id", id)

		var col = cluster_colors.get(n.get("cluster_id", ""), [0.8, 0.8, 0.9])
		var c := Color(float(col[0]), float(col[1]), float(col[2]))

		var icon_path: String = icons_dir.path_join(id + ".png")
		var has_icon: bool = FileAccess.file_exists(icon_path)
		if has_icon:
			var img := Image.load_from_file(icon_path)
			if img != null and not img.is_empty():
				var tex := ImageTexture.create_from_image(img)
				var sprite := Sprite3D.new()
				sprite.texture = tex
				sprite.billboard = BaseMaterial3D.BILLBOARD_ENABLED
				sprite.shaded = false
				sprite.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
				sprite.alpha_scissor_threshold = 0.25
				# pixel_size * image_px = world units across.
				# Parent Blender plane is size 0.7; 256px × 0.00273 ≈ 0.7.
				sprite.pixel_size = 0.7 / max(1, img.get_width())
				sprite.no_depth_test = false
				body.add_child(sprite)
			else:
				has_icon = false
		if not has_icon:
			# Small sphere fallback (radius 0.3, matches parent line 376).
			var mesh_inst := MeshInstance3D.new()
			var sphere := SphereMesh.new()
			sphere.radius = 0.3
			sphere.height = 0.6
			sphere.radial_segments = 16
			sphere.rings = 8
			mesh_inst.mesh = sphere
			var mat := StandardMaterial3D.new()
			mat.albedo_color = c
			mat.emission_enabled = true
			mat.emission = c
			mat.emission_energy_multiplier = 0.8
			mesh_inst.material_override = mat
			body.add_child(mesh_inst)

		var shape := CollisionShape3D.new()
		var ball := SphereShape3D.new()
		ball.radius = 0.45
		shape.shape = ball
		body.add_child(shape)

		var label := Label3D.new()
		label.text = String(n.get("label", id))
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.font_size = 36
		label.outline_size = 10
		label.modulate = Color(1, 1, 1)
		label.outline_modulate = Color(0, 0, 0)
		# Node labels sit just 0.35 above their sphere. The visual
		# separation from the verb label comes from the EDGE CURVE
		# dipping below — the verb lives at the bezier midpoint which
		# is below the straight S-O line.
		label.position = Vector3(0, 0.35, 0)
		label.pixel_size = 0.006
		label.no_depth_test = true
		label.render_priority = 1
		body.add_child(label)
		_attach_backdrop(label, 0.14)
		node_labels[id] = label

		add_child(body)
		node_bodies[id] = body

func _spawn_edges() -> void:
	# Pre-compute {cluster_id: {center, radius}} for the active-bow geometry.
	var cluster_info: Dictionary = {}
	for c in data.get("clusters", []):
		cluster_info[c["id"]] = {
			"center": bvec(c["center"]),
			"radius": float(c["radius"]),
		}

	for e in data.get("edges", []):
		var from_id: String = e.get("from", "")
		var to_id: String = e.get("to", "")
		if not node_bodies.has(from_id) or not node_bodies.has(to_id):
			continue
		var idx: int = int(e.get("index", -1))
		if idx < 0:
			continue
		edge_data[idx] = e

		var a: Vector3 = node_bodies[from_id].position
		var b: Vector3 = node_bodies[to_id].position
		var diff := b - a
		var length := diff.length()
		if length < 0.001:
			continue

		var straight_mid: Vector3 = (a + b) * 0.5

		# ── NORMAL mesh: subtle downward bow (unchanged from v2).
		var ctrl_normal: Vector3 = straight_mid + Vector3(0, -length * 0.25, 0)
		# Cubic midpoint with both handles on ctrl: 0.25*straight_mid + 0.75*ctrl
		# (= straight_mid - 0.1875*length in y), so the label sits on the tube.
		var normal_mid: Vector3 = straight_mid * 0.25 + ctrl_normal * 0.75

		# ── ACTIVE mesh: big bow that reaches the cluster sphere border.
		# Pick the "home" cluster (containing edge.from; falls back to
		# edge.to). Outward direction = (straight_mid - cluster_center);
		# magnitude pushes the bezier midpoint beyond the sphere.
		var from_cid: String = String(node_data.get(from_id, {}).get("cluster_id", ""))
		var to_cid: String = String(node_data.get(to_id, {}).get("cluster_id", ""))
		var home_cid: String = from_cid if cluster_info.has(from_cid) else to_cid
		var cluster_c: Vector3 = Vector3.ZERO
		var cluster_r: float = 0.0
		if cluster_info.has(home_cid):
			cluster_c = cluster_info[home_cid].center
			cluster_r = cluster_info[home_cid].radius

		var outward: Vector3 = straight_mid - cluster_c
		outward.y = 0.0  # force horizontal component; arc stays draped
		if outward.length() < 0.1:
			# Midpoint near the cluster center — pick a perpendicular to
			# the edge in the xz plane so we still get a sideways bow.
			outward = Vector3(-diff.z, 0.0, diff.x)
			if outward.length() < 0.1:
				outward = Vector3(1, 0, 0)
		outward = outward.normalized()

		# Target midpoint: outside the cluster sphere, with a downward
		# y dip so the arc reads as a drape rather than a sideways push.
		var sphere_reach: float = max(cluster_r + 2.0, length * 0.75)
		var target_mid: Vector3 = cluster_c + outward * sphere_reach
		target_mid.y = straight_mid.y - max(length * 0.5, 4.0)
		# A cubic Curve3D point with out-handle (ctrl-a) and in-handle
		# (ctrl-b) has bezier_mid = 0.25*straight_mid + 0.75*ctrl, so
		# ctrl = (4/3)*target_mid - (1/3)*straight_mid puts the curve
		# midpoint exactly on target_mid.
		var ctrl_active: Vector3 = target_mid * (4.0 / 3.0) - straight_mid * (1.0 / 3.0)

		var verb_col: Color = VerbColors.color_for_verb(String(e.get("verb", "")))

		var body := StaticBody3D.new()
		body.set_meta("kind", "edge")
		body.set_meta("index", idx)

		# Build BOTH tube meshes at spawn. Normal is mounted by default;
		# lecture_mode swaps to the active mesh when the edge is focused.
		var curve_normal := Curve3D.new()
		curve_normal.bake_interval = 0.25
		curve_normal.add_point(a, Vector3.ZERO, ctrl_normal - a)
		curve_normal.add_point(b, ctrl_normal - b, Vector3.ZERO)
		var normal_mesh: ArrayMesh = _build_tube_mesh(curve_normal, 0.035, 6)

		var curve_active := Curve3D.new()
		curve_active.bake_interval = 0.25
		curve_active.add_point(a, Vector3.ZERO, ctrl_active - a)
		curve_active.add_point(b, ctrl_active - b, Vector3.ZERO)
		var active_mesh: ArrayMesh = _build_tube_mesh(curve_active, 0.05, 6)

		var mesh_inst := MeshInstance3D.new()
		mesh_inst.mesh = normal_mesh
		var mat := StandardMaterial3D.new()
		mat.albedo_color = verb_col
		mat.emission_enabled = true
		mat.emission = verb_col
		mat.emission_energy_multiplier = 1.1
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mesh_inst.material_override = mat
		body.add_child(mesh_inst)

		edge_mesh_instances[idx] = mesh_inst
		edge_normal_mesh[idx] = normal_mesh
		edge_active_mesh[idx] = active_mesh
		edge_normal_mid[idx] = normal_mid
		edge_active_mid[idx] = target_mid
		edge_active_state[idx] = false

		var bezier_mid: Vector3 = normal_mid

		# Collision approximation — same capsule for click picking.
		var shape := CollisionShape3D.new()
		var cyl_shape := CylinderShape3D.new()
		cyl_shape.height = length
		cyl_shape.radius = 0.35
		shape.shape = cyl_shape
		shape.transform = _cylinder_between(a, b)
		body.add_child(shape)

		add_child(body)
		edge_bodies[idx] = body

		# Verb label placed at the edge midpoint, billboarded, hidden by
		# default. lecture_mode shows it only during the active edge.
		var verb_text: String = String(e.get("verb", ""))
		if verb_text != "":
			var vlabel := Label3D.new()
			vlabel.text = verb_text
			vlabel.billboard = BaseMaterial3D.BILLBOARD_ENABLED
			vlabel.font_size = 34
			vlabel.outline_size = 10
			vlabel.modulate = Color(1.0, 0.95, 0.7)
			vlabel.outline_modulate = Color(0, 0, 0)
			# Verb label at the BEZIER midpoint (below the straight
			# S-O line by length*0.125). It sits visually centered on
			# the curved edge, naturally offset from the S and O labels
			# that sit above their endpoint nodes.
			vlabel.position = bezier_mid
			vlabel.pixel_size = 0.008
			vlabel.no_depth_test = true
			vlabel.render_priority = 1
			add_child(vlabel)
			_attach_backdrop(vlabel, 0.14)
			verb_labels[idx] = vlabel

static func _edge_cross_section(r: float) -> PackedVector2Array:
	# Regular hexagon cross-section, used as the swept profile.
	var pts := PackedVector2Array()
	for i in range(6):
		var ang: float = i * TAU / 6.0
		pts.append(Vector2(cos(ang) * r, sin(ang) * r))
	return pts

# Build a tube `ArrayMesh` by sweeping a regular `sides`-gon of `radius`
# along the baked points of a `Curve3D`. Uses parallel-transport frames
# (last ring's normal projected onto next tangent) so there's no
# twisting. Called once at spawn time; the resulting mesh is a regular
# `MeshInstance3D.mesh` — no runtime CSG, no per-frame rebuild, safe
# under Movie Maker mode.
static func _build_tube_mesh(curve: Curve3D, radius: float, sides: int = 6) -> ArrayMesh:
	var baked := curve.get_baked_points()
	var n: int = baked.size()
	if n < 2:
		return null

	# Initial frame: pick an arbitrary axis perpendicular to the first
	# tangent.
	var t0: Vector3 = (baked[1] - baked[0]).normalized()
	var normal: Vector3 = Vector3.UP
	if abs(t0.dot(normal)) > 0.95:
		normal = Vector3.RIGHT
	normal = (normal - t0 * t0.dot(normal)).normalized()

	# Parallel-transport the normal along the curve, emitting a ring of
	# `sides` vertices per baked point.
	var ring_count: int = n
	var ring_verts := PackedVector3Array()
	ring_verts.resize(ring_count * sides)
	for i in range(ring_count):
		var t: Vector3
		if i < n - 1:
			t = (baked[i + 1] - baked[i]).normalized()
		else:
			t = (baked[i] - baked[i - 1]).normalized()
		# Reproject normal to be perpendicular to new tangent
		var new_normal: Vector3 = normal - t * t.dot(normal)
		if new_normal.length() < 0.01:
			new_normal = Vector3.UP if abs(t.dot(Vector3.UP)) < 0.95 else Vector3.RIGHT
			new_normal = new_normal - t * t.dot(new_normal)
		normal = new_normal.normalized()
		var binormal: Vector3 = t.cross(normal).normalized()
		for j in range(sides):
			var ang: float = TAU * float(j) / float(sides)
			var offset: Vector3 = normal * cos(ang) * radius + binormal * sin(ang) * radius
			ring_verts[i * sides + j] = baked[i] + offset

	# Triangulate: each ring pair produces `sides` quads, each quad = 2 tris.
	var verts := PackedVector3Array()
	verts.resize((ring_count - 1) * sides * 6)
	var vi: int = 0
	for i in range(ring_count - 1):
		for j in range(sides):
			var j2: int = (j + 1) % sides
			var v0: Vector3 = ring_verts[i * sides + j]
			var v1: Vector3 = ring_verts[i * sides + j2]
			var v2: Vector3 = ring_verts[(i + 1) * sides + j2]
			var v3: Vector3 = ring_verts[(i + 1) * sides + j]
			verts[vi] = v0; vi += 1
			verts[vi] = v1; vi += 1
			verts[vi] = v2; vi += 1
			verts[vi] = v0; vi += 1
			verts[vi] = v2; vi += 1
			verts[vi] = v3; vi += 1

	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh

# Shared compiled shader for all edges — one resource, per-edge uniforms
# set via ShaderMaterial.
# Swap an edge's tube mesh between its subtle-bow and exaggerated-bow
# variants. Called by lecture_mode every time the active edge changes:
# active=true for the focused edge, false for every other edge. Also
# repositions the verb label so it sits on the actual bezier midpoint
# of whichever mesh is currently mounted.
func set_edge_active(idx: int, active: bool) -> void:
	if not edge_mesh_instances.has(idx):
		return
	if edge_active_state.get(idx, false) == active:
		return
	var mi: MeshInstance3D = edge_mesh_instances[idx]
	if active:
		mi.mesh = edge_active_mesh[idx]
	else:
		mi.mesh = edge_normal_mesh[idx]
	if verb_labels.has(idx):
		var vl: Label3D = verb_labels[idx]
		vl.position = edge_active_mid[idx] if active else edge_normal_mid[idx]
	edge_active_state[idx] = active

const EDGE_PULSE_SHADER = preload("res://shaders/edge_pulse.gdshader")

func _make_edge_pulse_material(verb_col: Color, idx: int) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = EDGE_PULSE_SHADER
	m.set_shader_parameter("base_color", verb_col)
	# Per-edge phase offset so consecutive revealed edges don't pulse in
	# lockstep; idx * golden-ratio mod 1 is a cheap "quasi-random" spread.
	var phase: float = fmod(float(idx) * 0.61803398875, 1.0)
	m.set_shader_parameter("offset", phase)
	return m

# ─── image overlays ────────────────────────────────────────────────────────
# Matches parent blender_animated.py.reference lines ~533-690. Reads
# overlay_assets/overlay_timeline.json, builds textured billboard planes
# positioned outside each host node's sub-network, hidden by default.
# lecture_mode._refresh_overlay_visibility() toggles them per-frame based
# on (entry.start, entry.end) windows.
func _spawn_overlays() -> void:
	var path := lecture_dir.path_join("overlay_assets").path_join("overlay_timeline.json")
	if not FileAccess.file_exists(path):
		return
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return
	var text := f.get_as_text()
	f.close()
	var parsed = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var entries = parsed.get("entries", [])
	if entries.is_empty():
		return

	# Build adjacency for subnet computation.
	var neighbors: Dictionary = {}
	for e in data.get("edges", []):
		var from_id: String = String(e.get("from", ""))
		var to_id: String = String(e.get("to", ""))
		if from_id == "" or to_id == "":
			continue
		if not neighbors.has(from_id):
			neighbors[from_id] = []
		(neighbors[from_id] as Array).append(to_id)
		if not neighbors.has(to_id):
			neighbors[to_id] = []
		(neighbors[to_id] as Array).append(from_id)

	for i in range(entries.size()):
		var entry: Dictionary = entries[i]
		var host_id: String = String(entry.get("node_id", ""))
		var png_rel: String = _rewrite_overlay_png_path(String(entry.get("png", "")))
		if host_id == "" or png_rel == "":
			continue
		if not node_bodies.has(host_id):
			continue
		if not FileAccess.file_exists(png_rel):
			push_warning("[world_loader] overlay PNG missing: " + png_rel)
			continue

		# Sub-network bounding sphere: host + immediate neighbors.
		var subnet_ids: Array = [host_id]
		for nid in neighbors.get(host_id, []):
			if node_bodies.has(nid) and not subnet_ids.has(nid):
				subnet_ids.append(nid)
		var positions_arr: Array = []
		for nid in subnet_ids:
			positions_arr.append((node_bodies[nid] as Node3D).position)
		var sub_sum := Vector3.ZERO
		for p in positions_arr:
			sub_sum += p
		var sub_center: Vector3 = sub_sum / positions_arr.size()
		var sub_r: float = 0.0
		for p in positions_arr:
			var d: float = (p - sub_center).length()
			if d > sub_r:
				sub_r = d
		sub_r = max(sub_r + 1.0, 3.0)

		# Horizontal direction from sub-center to host (Godot xz plane).
		var host_pos: Vector3 = (node_bodies[host_id] as Node3D).position
		var dir_x: float = host_pos.x - sub_center.x
		var dir_z: float = host_pos.z - sub_center.z
		var dir_len: float = sqrt(dir_x * dir_x + dir_z * dir_z)
		if dir_len < 0.1:
			dir_x = 1.0
			dir_z = 0.0
			dir_len = 1.0
		dir_x /= dir_len
		dir_z /= dir_len

		var offset: float = sub_r + OVERLAY_PLANE_SIZE * 0.55 + 2.0
		var plane_pos := Vector3(
			sub_center.x + dir_x * offset,
			sub_center.y,
			sub_center.z + dir_z * offset,
		)

		# Load the image as an emissive textured quad (QuadMesh is native
		# z-facing and plays nicely with billboard_mode).
		var img := Image.load_from_file(png_rel)
		if img == null or img.is_empty():
			continue
		var tex := ImageTexture.create_from_image(img)
		var mesh_inst := MeshInstance3D.new()
		var quad := QuadMesh.new()
		quad.size = Vector2(OVERLAY_PLANE_SIZE, OVERLAY_PLANE_SIZE)
		mesh_inst.mesh = quad
		mesh_inst.position = plane_pos

		var mat := StandardMaterial3D.new()
		mat.albedo_texture = tex
		mat.albedo_color = Color(1, 1, 1, 1)
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		mat.billboard_keep_scale = true
		mat.emission_enabled = true
		mat.emission = Color(1, 1, 1)
		mat.emission_energy_multiplier = 1.8
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		mesh_inst.material_override = mat
		mesh_inst.visible = false  # hidden until step 7 / lecture_mode toggles
		add_child(mesh_inst)

		overlay_entries.append({
			"obj": mesh_inst,
			"start": float(entry.get("start", 0.0)),
			"end": float(entry.get("end", 0.0)),
			"node_id": host_id,
			"kind": String(entry.get("kind", "")),
			"caption": String(entry.get("caption", "")),
		})

func _rewrite_overlay_png_path(png_path: String) -> String:
	# overlay_timeline.json may contain absolute
	# `/tmp/textvis_run_<basename>/overlay_assets/...` workdir paths.
	# Rewrite to the local lecture's overlay_assets/... so Godot can load
	# from disk.
	if png_path == "":
		return ""
	var marker := "/overlay_assets/"
	var idx: int = png_path.rfind(marker)
	if idx < 0:
		return png_path
	var rel: String = png_path.substr(idx + marker.length())
	return lecture_dir.path_join("overlay_assets").path_join(rel)

# ─── label backdrop helper ─────────────────────────────────────────────────
# Dark alpha-0.85 quad placed behind every Label3D, matching the parent
# Blender reference (lines ~399-408, ~499-503). Added as a CHILD of the
# label so visibility toggling propagates for free.
func _attach_backdrop(label: Label3D, size_scale: float) -> void:
	var backdrop := MeshInstance3D.new()
	var quad := QuadMesh.new()
	var w: float = max(0.6, float(label.text.length()) * size_scale)
	var h: float = size_scale * 2.2
	quad.size = Vector2(w, h)
	backdrop.mesh = quad
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.0, 0.0, 0.02, 0.85)
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.no_depth_test = true
	mat.render_priority = -1
	backdrop.material_override = mat
	backdrop.sorting_offset = -0.01
	label.add_child(backdrop)

# ─── label visibility helpers ──────────────────────────────────────────────
func set_all_labels_visible(v: bool) -> void:
	for l in node_labels.values():
		if l != null: l.visible = v
	for l in verb_labels.values():
		if l != null: l.visible = v
	for l in cluster_labels.values():
		if l != null: l.visible = v

func set_node_labels_visible(ids: Array, v: bool) -> void:
	for id in ids:
		var lbl = node_labels.get(id, null)
		if lbl != null:
			lbl.visible = v

func set_verb_labels_visible(indices: Array, v: bool) -> void:
	for idx in indices:
		var lbl = verb_labels.get(idx, null)
		if lbl != null:
			lbl.visible = v

func set_cluster_labels_visible(ids: Array, v: bool) -> void:
	for id in ids:
		var lbl = cluster_labels.get(id, null)
		if lbl != null:
			lbl.visible = v

static func _cylinder_between(a: Vector3, b: Vector3) -> Transform3D:
	# Oriented so the CylinderMesh's local +Y runs from a to b.
	var mid := (a + b) * 0.5
	var diff := b - a
	if diff.length() < 0.001:
		return Transform3D(Basis.IDENTITY, mid)
	var y_axis := diff.normalized()
	var ref := Vector3.UP
	if abs(y_axis.dot(ref)) > 0.99:
		ref = Vector3.RIGHT
	var x_axis := ref.cross(y_axis).normalized()
	var z_axis := x_axis.cross(y_axis).normalized()
	return Transform3D(Basis(x_axis, y_axis, z_axis), mid)

# ─── WAV loader (bypasses Godot import system) ─────────────────────────────
static func load_wav(path: String) -> AudioStreamWAV:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		push_error("Cannot open WAV: " + path)
		return null
	var bytes := f.get_buffer(f.get_length())
	f.close()
	if bytes.size() < 44:
		push_error("WAV too short: " + path)
		return null
	if bytes.slice(0, 4).get_string_from_ascii() != "RIFF":
		push_error("Not a RIFF/WAV: " + path)
		return null

	var channels: int = 1
	var sample_rate: int = 44100
	var bits: int = 16
	var data_bytes := PackedByteArray()
	var i: int = 12
	while i + 8 <= bytes.size():
		var chunk_id := bytes.slice(i, i + 4).get_string_from_ascii()
		var chunk_size: int = bytes.decode_u32(i + 4)
		if chunk_id == "fmt ":
			channels = bytes.decode_u16(i + 10)
			sample_rate = bytes.decode_u32(i + 12)
			bits = bytes.decode_u16(i + 22)
		elif chunk_id == "data":
			data_bytes = bytes.slice(i + 8, i + 8 + chunk_size)
		i += 8 + chunk_size
		if chunk_size % 2 == 1:
			i += 1

	if data_bytes.size() == 0:
		push_error("WAV has no data chunk: " + path)
		return null

	var stream := AudioStreamWAV.new()
	if bits == 16:
		stream.format = AudioStreamWAV.FORMAT_16_BITS
	elif bits == 8:
		stream.format = AudioStreamWAV.FORMAT_8_BITS
	else:
		push_error("Unsupported WAV bit depth %d: %s" % [bits, path])
		return null
	stream.mix_rate = sample_rate
	stream.stereo = channels >= 2
	stream.data = data_bytes
	return stream
