#!/usr/bin/env python3
"""
render-from-world.py — Blender-standalone reference renderer.

Reads a lecture's world_state.json and spawns Blender geometry from
POSITIONS stored in that file ONLY, then applies the full 4-phase
camera choreography + label visibility rules (see the `camera` section of
tools/pipeline-config.json). The camera math is the same as
godot/scripts/lecture_mode.gd — both read their constants from
tools/pipeline-config.json:camera so there's ONE source of truth.

Usage (from repo root):

    blender -b --factory-startup -P tools/render-from-world.py -- \\
        --lecture fuzzy_logic_zadeh_1965_information_control \\
        [--save-blend /tmp/tvg_render/fuzzy_logic.blend] \\
        [--output /tmp/tvg_render/fuzzy_logic.png] \\
        [--frame-range 1,240] \\
        [--no-render]

By default renders one still at frame 1. Pass --save-blend to inspect
the full keyframed scene in the Blender GUI. Pass --frame-range A,B
to render an animation range.

Note: this is a partial reference renderer (straight edges, no overlays
or audio); the Godot renderer (tools/render-lecture.mjs) is the primary one.
"""

import argparse
import json
import math
import sys
from pathlib import Path

try:
    import bpy
    import mathutils
except ImportError:
    sys.stderr.write(
        "This script must be run with Blender's Python:\n"
        "    blender -b --factory-startup -P tools/render-from-world.py "
        "-- --lecture <basename>\n"
    )
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DEFAULT_FPS = 24


# ─── argument parsing ──────────────────────────────────────────────────────
def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1:]
    else:
        argv = []
    ap = argparse.ArgumentParser(
        description="Render a lecture's world_state.json in Blender.",
    )
    ap.add_argument("--lecture", required=True,
                    help="lecture basename under lectures/")
    ap.add_argument("--lectures-dir", default=str(REPO_ROOT / "lectures"))
    ap.add_argument("--config", default=str(REPO_ROOT / "tools" / "pipeline-config.json"),
                    help="pipeline-config.json path (source of camera constants)")
    ap.add_argument("--output", default=None,
                    help="PNG output path (default: /tmp/tvg_render/<basename>.png)")
    ap.add_argument("--save-blend", default=None,
                    help="optional .blend output for inspection in the GUI")
    ap.add_argument("--resolution", default="1280x720",
                    help="render resolution WIDTHxHEIGHT")
    ap.add_argument("--frame-range", default=None,
                    help="render an animation range A,B (default: still frame 1)")
    ap.add_argument("--no-render", action="store_true",
                    help="build the scene but skip render")
    return ap.parse_args(argv)


# ─── config loader ──────────────────────────────────────────────────────────
def load_camera_config(path):
    defaults = {
        "hold_fraction": 0.75,
        "transition_fraction": 0.25,
        "zoom_out_factor": 1.8,
        "min_distance": 12.0,
        "max_distance": 60.0,
        "edge_length_margin": 6.0,
        "vertical_margin": 5.0,
        "safety_multiplier": 1.12,
        "fov_horizontal_deg": 65.0,
        "fov_vertical_deg": 37.0,
        "global_center_bias": 0.4,
        "overview_yaw_twist_deg": 11.25,
        "overview_pitch_lift_deg": 8.0,
        "overview_pitch_cap_deg": 42.0,
        "lift_pitch_base_deg": 20.0,
        "lift_pitch_amp_deg": 10.0,
        "tilt_amp_deg": 15.0,
        "perp_outward_blend": 0.7,
    }
    p = Path(path)
    if not p.exists():
        print(f"[render-from-world] WARN: {path} not found, using defaults")
        return defaults
    try:
        cfg = json.loads(p.read_text())
    except Exception as e:
        print(f"[render-from-world] WARN: failed to parse {path}: {e}")
        return defaults
    c = cfg.get("camera", {})
    merged = dict(defaults)
    for k in defaults:
        if k in c:
            merged[k] = c[k]
    return merged


# ─── scene reset ────────────────────────────────────────────────────────────
def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for coll in (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.curves,
        bpy.data.images,
    ):
        for item in list(coll):
            coll.remove(item)


# ─── materials ──────────────────────────────────────────────────────────────
def _set_input(bsdf, name, value):
    if name in bsdf.inputs:
        bsdf.inputs[name].default_value = value


def make_cluster_mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    _set_input(bsdf, "Base Color", (rgb[0], rgb[1], rgb[2], 1.0))
    _set_input(bsdf, "Roughness", 0.3)
    _set_input(bsdf, "Alpha", 0.08)
    _set_input(bsdf, "Emission Color", (rgb[0], rgb[1], rgb[2], 1.0))
    _set_input(bsdf, "Emission Strength", 0.1)
    if hasattr(m, "blend_method"):
        m.blend_method = "BLEND"
    if hasattr(m, "surface_render_method"):
        m.surface_render_method = "BLENDED"
    return m


def make_node_mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    _set_input(bsdf, "Base Color", (rgb[0], rgb[1], rgb[2], 1.0))
    _set_input(bsdf, "Roughness", 0.4)
    _set_input(bsdf, "Emission Color", (rgb[0], rgb[1], rgb[2], 1.0))
    _set_input(bsdf, "Emission Strength", 0.3)
    return m


def make_edge_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    _set_input(bsdf, "Base Color", (0.95, 0.72, 0.22, 1.0))
    _set_input(bsdf, "Roughness", 0.4)
    _set_input(bsdf, "Emission Color", (0.95, 0.55, 0.15, 1.0))
    _set_input(bsdf, "Emission Strength", 0.8)
    return m


def make_label_mat(name, rgb, emission=3.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    _set_input(bsdf, "Base Color", (rgb[0], rgb[1], rgb[2], 1.0))
    _set_input(bsdf, "Roughness", 0.2)
    _set_input(bsdf, "Emission Color", (rgb[0], rgb[1], rgb[2], 1.0))
    _set_input(bsdf, "Emission Strength", emission)
    return m


# ─── primitive helpers ──────────────────────────────────────────────────────
def add_sphere(name, position, radius, material, segments=32, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius,
        location=tuple(position),
        segments=segments,
        ring_count=rings,
    )
    obj = bpy.context.object
    obj.name = name
    if obj.data.materials:
        obj.data.materials[0] = material
    else:
        obj.data.materials.append(material)
    return obj


def add_edge_cylinder(name, a, b, radius, material):
    a_vec = mathutils.Vector(a)
    b_vec = mathutils.Vector(b)
    diff = b_vec - a_vec
    length = diff.length
    if length < 1e-4:
        return None
    mid = (a_vec + b_vec) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius,
        depth=length,
        location=tuple(mid),
    )
    obj = bpy.context.object
    obj.name = name
    up = mathutils.Vector((0.0, 0.0, 1.0))
    rot = up.rotation_difference(diff.normalized())
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = rot
    if obj.data.materials:
        obj.data.materials[0] = material
    else:
        obj.data.materials.append(material)
    return obj


def add_text_label(name, text, location, size, material, cam_obj):
    bpy.ops.object.text_add(location=tuple(location))
    obj = bpy.context.object
    obj.name = name
    obj.data.body = text
    obj.data.size = size
    obj.data.align_x = "CENTER"
    obj.data.align_y = "CENTER"
    obj.data.extrude = 0.02
    obj.data.materials.append(material)
    # Billboard via Track-To constraint pointing at the camera.
    tc = obj.constraints.new("TRACK_TO")
    tc.target = cam_obj
    tc.track_axis = "TRACK_Z"
    tc.up_axis = "UP_Y"
    return obj


def key_vis(obj, frame, visible):
    """Keyframe hide_render + hide_viewport as a boolean step. Constant
    interpolation is enforced by Blender for hide_* keyframes, so the
    toggle is instantaneous."""
    if obj is None:
        return
    hide = not visible
    obj.hide_render = hide
    obj.hide_viewport = hide
    obj.keyframe_insert(data_path="hide_render", frame=frame)
    obj.keyframe_insert(data_path="hide_viewport", frame=frame)


# ─── camera pose geometry (must match lecture_mode.gd) ─────────────────────
def compute_close_pose(edge, positions, global_center, i, cfg):
    a = positions[edge["from"]]
    b = positions[edge["to"]]
    mid = ((a[0]+b[0])/2.0, (a[1]+b[1])/2.0, (a[2]+b[2])/2.0)
    dx, dy, dz = b[0]-a[0], b[1]-a[1], b[2]-a[2]
    edge_len = math.sqrt(dx*dx + dy*dy + dz*dz)
    if edge_len > 0.1:
        ex, ey, ez = dx/edge_len, dy/edge_len, dz/edge_len
    else:
        ex, ey, ez = 1.0, 0.0, 0.0

    out_x = mid[0] - global_center[0]
    out_y = mid[1] - global_center[1]
    out_z = mid[2] - global_center[2]
    out_len = math.sqrt(out_x*out_x + out_y*out_y + out_z*out_z) or 1.0
    out_x /= out_len; out_y /= out_len; out_z /= out_len

    # Horizontal perpendicular to edge direction (Blender z-up world).
    up_x, up_y, up_z = 0.0, 0.0, 1.0
    px = ey*up_z - ez*up_y
    py = ez*up_x - ex*up_z
    pz = ex*up_y - ey*up_x
    pl = math.sqrt(px*px + py*py + pz*pz) or 1.0
    px /= pl; py /= pl; pz /= pl
    if px*out_x + py*out_y + pz*out_z < 0.0:
        px, py, pz = -px, -py, -pz

    b_frac = cfg["perp_outward_blend"]
    bx = px * b_frac + out_x * (1.0 - b_frac)
    by = py * b_frac + out_y * (1.0 - b_frac)
    bz = pz * b_frac + out_z * (1.0 - b_frac)
    bl = math.sqrt(bx*bx + by*by + bz*bz) or 1.0
    bx /= bl; by /= bl; bz /= bl

    # Per-edge Rodrigues tilt around the edge axis.
    tilt = math.radians(cfg["tilt_amp_deg"]) * math.sin(i * 0.5)
    if edge_len > 0.1:
        ct, st = math.cos(tilt), math.sin(tilt)
        dot_ab = ex*bx + ey*by + ez*bz
        cx_ = ey*bz - ez*by
        cy_ = ez*bx - ex*bz
        cz_ = ex*by - ey*bx
        bx = bx*ct + cx_*st + ex*dot_ab*(1-ct)
        by = by*ct + cy_*st + ey*dot_ab*(1-ct)
        bz = bz*ct + cz_*st + ez*dot_ab*(1-ct)

    # Lift upward (Blender z-up).
    lift_pitch = math.radians(cfg["lift_pitch_base_deg"]) + \
                 math.radians(cfg["lift_pitch_amp_deg"]) * math.sin(i * 0.7)
    lift_h = math.cos(lift_pitch)
    lift_v = math.sin(lift_pitch)
    bx = bx * lift_h
    by = by * lift_h
    bz = bz + lift_v
    nl = math.sqrt(bx*bx + by*by + bz*bz) or 1.0
    bx /= nl; by /= nl; bz /= nl

    # Distance formula — fit both endpoints in frame.
    half_h = math.radians(cfg["fov_horizontal_deg"] * 0.5)
    half_v = math.radians(cfg["fov_vertical_deg"] * 0.5)
    needed_h = (edge_len + cfg["edge_length_margin"]) * 0.5 / math.tan(half_h)
    needed_v = cfg["vertical_margin"] / math.tan(half_v)
    base_dist = max(needed_h, needed_v)
    dist = max(cfg["min_distance"],
               min(base_dist * cfg["safety_multiplier"], cfg["max_distance"]))

    pos = (mid[0] + bx*dist, mid[1] + by*dist, mid[2] + bz*dist)
    yaw = math.atan2(pos[0] - mid[0], -(pos[1] - mid[1]))
    return {
        "pos": pos,
        "target": mid,
        "dist": dist,
        "yaw": yaw,
        "pitch": lift_pitch,
    }


def compute_overview_pose(pose, next_pose, global_center, global_radius, cfg):
    bias = cfg["global_center_bias"]
    mid_t = (
        (pose["target"][0] + next_pose["target"][0]) * 0.5 * (1 - bias) + global_center[0] * bias,
        (pose["target"][1] + next_pose["target"][1]) * 0.5 * (1 - bias) + global_center[1] * bias,
        (pose["target"][2] + next_pose["target"][2]) * 0.5 * (1 - bias) + global_center[2] * bias,
    )
    mid_dist = max(global_radius * 0.9, pose["dist"] * cfg["zoom_out_factor"])
    mid_yaw = (pose["yaw"] + next_pose["yaw"]) * 0.5 + math.radians(cfg["overview_yaw_twist_deg"])
    avg_pitch = (pose["pitch"] + next_pose["pitch"]) * 0.5
    mid_pitch = min(
        math.radians(cfg["overview_pitch_cap_deg"]),
        avg_pitch + math.radians(cfg["overview_pitch_lift_deg"]),
    )
    off_x = mid_dist * math.cos(mid_pitch) * math.sin(mid_yaw)
    off_y = -mid_dist * math.cos(mid_pitch) * math.cos(mid_yaw)
    off_z = mid_dist * math.sin(mid_pitch)
    return {
        "pos": (mid_t[0] + off_x, mid_t[1] + off_y, mid_t[2] + off_z),
        "target": mid_t,
        "dist": mid_dist,
        "yaw": mid_yaw,
        "pitch": mid_pitch,
    }


def look_rot(pos, target):
    direction = mathutils.Vector((target[0]-pos[0], target[1]-pos[1], target[2]-pos[2]))
    return direction.to_track_quat("-Z", "Y").to_euler()


# ─── scene build ────────────────────────────────────────────────────────────
def build_scene(world, cfg):
    clear_scene()
    scene = bpy.context.scene

    # World background.
    bg = world.get("scene", {}).get("background_color", [0.02, 0.02, 0.04])
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    bg_node = scene.world.node_tree.nodes.get("Background")
    if bg_node is not None:
        bg_node.inputs["Color"].default_value = (bg[0], bg[1], bg[2], 1.0)
        bg_node.inputs["Strength"].default_value = 1.0

    # Camera — FOV from config.
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens_unit = "FOV"
    cam_data.angle = math.radians(cfg["fov_horizontal_deg"])
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (0, -80, 30)  # initial; will be keyframed
    scene.camera = cam

    # Lights.
    for lname, energy, loc in [
        ("Key", 1500.0, (15.0, 10.0, 20.0)),
        ("Fill", 600.0, (-10.0, -15.0, 10.0)),
        ("Rim", 900.0, (0.0, 5.0, -15.0)),
    ]:
        ld = bpy.data.lights.new(lname, "POINT")
        ld.energy = energy
        ld.color = (0.95, 0.95, 1.0)
        lo = bpy.data.objects.new(lname, ld)
        bpy.context.collection.objects.link(lo)
        lo.location = loc

    # Cluster shells + cluster labels (hidden by default).
    cluster_colors = {}
    cluster_label_objs = {}
    for c in world.get("clusters", []):
        cid = c["id"]
        rgb = tuple(float(v) for v in c.get("color", [0.5, 0.5, 0.6]))
        cluster_colors[cid] = rgb
        center = tuple(float(v) for v in c["center"])
        r = float(c["radius"])
        mat = make_cluster_mat(f"cluster_mat_{cid}", rgb)
        add_sphere(f"cluster_{cid}", center, r, mat, segments=32, rings=16)
        # Cluster label above the top of the sphere.
        label_pos = (center[0], center[1], center[2] + r + 1.5)
        lmat = make_label_mat(f"cluster_lbl_mat_{cid}", (1.0, 0.9, 0.55), emission=4.0)
        lbl = add_text_label(f"cluster_lbl_{cid}", str(c.get("label", cid)),
                             label_pos, 1.4, lmat, cam)
        key_vis(lbl, 1, False)  # hidden by default
        cluster_label_objs[cid] = lbl

    # Nodes + node labels (hidden by default).
    positions = {}
    node_label_objs = {}
    for n in world.get("nodes", []):
        nid = n["id"]
        pos = tuple(float(v) for v in n["position"])
        positions[nid] = pos
        cluster_id = n.get("cluster_id", "")
        rgb = cluster_colors.get(cluster_id, (0.8, 0.8, 0.9))
        mat = make_node_mat(f"node_mat_{nid}", rgb)
        add_sphere(f"node_{nid}", pos, 0.9, mat, segments=16, rings=8)
        # Node label floats above the sphere.
        label_pos = (pos[0], pos[1], pos[2] + 1.4)
        lmat = make_label_mat(f"node_lbl_mat_{nid}", (1.0, 1.0, 1.0), emission=2.5)
        lbl = add_text_label(f"node_lbl_{nid}", str(n.get("label", nid)),
                             label_pos, 0.38, lmat, cam)
        key_vis(lbl, 1, False)
        node_label_objs[nid] = lbl

    # Edges + verb labels (hidden by default).
    edge_mat = make_edge_mat("edge_mat_default")
    verb_label_objs = {}
    for e in world.get("edges", []):
        a_id = e.get("from")
        b_id = e.get("to")
        if a_id not in positions or b_id not in positions:
            continue
        idx = int(e.get("index", -1))
        if idx < 0:
            continue
        add_edge_cylinder(f"edge_{idx}", positions[a_id], positions[b_id],
                          radius=0.15, material=edge_mat)
        verb = str(e.get("verb", ""))
        if verb:
            a = positions[a_id]
            b = positions[b_id]
            mid = ((a[0]+b[0])/2.0, (a[1]+b[1])/2.0, (a[2]+b[2])/2.0 + 0.6)
            lmat = make_label_mat(f"verb_lbl_mat_{idx}", (1.0, 0.95, 0.7), emission=3.0)
            lbl = add_text_label(f"verb_lbl_{idx}", verb, mid, 0.38, lmat, cam)
            key_vis(lbl, 1, False)
            verb_label_objs[idx] = lbl

    return {
        "cam": cam,
        "positions": positions,
        "cluster_colors": cluster_colors,
        "cluster_labels": cluster_label_objs,
        "node_labels": node_label_objs,
        "verb_labels": verb_label_objs,
    }


# ─── camera + label keyframing ─────────────────────────────────────────────
def keyframe_animation(world, built, cfg):
    scene = bpy.context.scene
    fps = int(world.get("scene", {}).get("fps", DEFAULT_FPS))
    scene.render.fps = fps
    cam = built["cam"]
    positions = built["positions"]

    # Global center + bounding radius.
    if positions:
        avg = [
            sum(p[0] for p in positions.values()) / len(positions),
            sum(p[1] for p in positions.values()) / len(positions),
            sum(p[2] for p in positions.values()) / len(positions),
        ]
    else:
        avg = [0.0, 0.0, 0.0]
    global_center = (avg[0], avg[1], avg[2])
    global_radius = 15.0
    for p in positions.values():
        d = math.sqrt((p[0]-avg[0])**2 + (p[1]-avg[1])**2 + (p[2]-avg[2])**2)
        if d > global_radius:
            global_radius = d

    hold_frac = cfg["hold_fraction"]
    trans_frac = cfg["transition_fraction"]

    # Pass 1: filter valid edges and precompute close poses.
    edges_raw = world.get("edges", [])
    playable = []  # list of (edge, close_pose, sf, ef, zoom_in_end, hold_end)
    pose_index = 0
    for e in edges_raw:
        d = float(e.get("audio_duration", 0.0))
        if d <= 0.0:
            continue
        a_id = e.get("from")
        b_id = e.get("to")
        if a_id not in positions or b_id not in positions:
            continue
        s = float(e.get("audio_start", 0.0))
        sf = max(1, int(s * fps))
        ef = max(sf + 1, int((s + d) * fps))
        duration_frames = ef - sf
        zoom_in_end = sf + max(1, int(duration_frames * trans_frac))
        hold_end = max(zoom_in_end + 1, sf + int(duration_frames * hold_frac))
        pose = compute_close_pose(e, positions, global_center, pose_index, cfg)
        playable.append({
            "edge": e,
            "pose": pose,
            "sf": sf,
            "ef": ef,
            "zoom_in_end": zoom_in_end,
            "hold_end": hold_end,
        })
        pose_index += 1

    if not playable:
        print("[render-from-world] no playable edges")
        return None

    # Pass 2: camera keyframes per the 4-phase model.
    for i, item in enumerate(playable):
        pose = item["pose"]
        cam.location = pose["pos"]
        cam.rotation_euler = look_rot(pose["pos"], pose["target"])
        cam.keyframe_insert(data_path="location", frame=item["zoom_in_end"])
        cam.keyframe_insert(data_path="rotation_euler", frame=item["zoom_in_end"])
        if i == 0:
            cam.keyframe_insert(data_path="location", frame=max(1, item["sf"]))
            cam.keyframe_insert(data_path="rotation_euler", frame=max(1, item["sf"]))
        cam.keyframe_insert(data_path="location", frame=item["hold_end"])
        cam.keyframe_insert(data_path="rotation_euler", frame=item["hold_end"])

        if i + 1 < len(playable):
            next_item = playable[i + 1]
            ov = compute_overview_pose(pose, next_item["pose"], global_center, global_radius, cfg)
            cam.location = ov["pos"]
            cam.rotation_euler = look_rot(ov["pos"], ov["target"])
            cam.keyframe_insert(data_path="location", frame=item["ef"])
            cam.keyframe_insert(data_path="rotation_euler", frame=item["ef"])
        else:
            cam.keyframe_insert(data_path="location", frame=item["ef"])
            cam.keyframe_insert(data_path="rotation_euler", frame=item["ef"])

    # Pass 3: label visibility keyframes.
    node_labels = built["node_labels"]
    verb_labels = built["verb_labels"]
    cluster_labels = built["cluster_labels"]

    # Node cluster lookup for cluster-label windows.
    node_cluster = {n["id"]: n.get("cluster_id", "") for n in world.get("nodes", [])}

    for i, item in enumerate(playable):
        sf = item["sf"]
        ef = item["ef"]
        e = item["edge"]
        idx = int(e.get("index", -1))

        # Node + verb labels: visible during [sf, ef], flanked by hide keyframes.
        for nid in (e.get("from"), e.get("to")):
            lbl = node_labels.get(nid)
            if lbl is not None:
                key_vis(lbl, max(1, sf - 2), False)
                key_vis(lbl, sf, True)
                key_vis(lbl, ef, True)
                key_vis(lbl, ef + 2, False)
        vl = verb_labels.get(idx)
        if vl is not None:
            key_vis(vl, max(1, sf - 2), False)
            key_vis(vl, sf, True)
            key_vis(vl, ef, True)
            key_vis(vl, ef + 2, False)

        # Cluster labels: visible from zoom_out_start to next edge's zoom_in_end.
        zoom_out_start = item["hold_end"]
        next_zoom_in_end = item["ef"]
        if i + 1 < len(playable):
            next_zoom_in_end = playable[i + 1]["zoom_in_end"]
        active_cids = set(filter(None, (node_cluster.get(e.get("from")), node_cluster.get(e.get("to")))))
        for cid in active_cids:
            cl = cluster_labels.get(cid)
            if cl is not None:
                key_vis(cl, max(1, zoom_out_start - 2), False)
                key_vis(cl, zoom_out_start, True)
                key_vis(cl, next_zoom_in_end, True)
                key_vis(cl, next_zoom_in_end + 2, False)

    last_ef = playable[-1]["ef"]
    scene.frame_start = 1
    scene.frame_end = last_ef
    print(f"[render-from-world] keyframed {len(playable)} edges, frames 1-{last_ef}")
    return last_ef


# ─── engine selection ──────────────────────────────────────────────────────
def pick_engine(scene):
    available = [
        e.identifier
        for e in scene.render.bl_rna.properties["engine"].enum_items
    ]
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        if candidate in available:
            return candidate
    return available[0] if available else "BLENDER_EEVEE"


# ─── main ───────────────────────────────────────────────────────────────────
def main():
    args = parse_args()
    cfg = load_camera_config(args.config)

    lecture_path = Path(args.lectures_dir) / args.lecture / "world_state.json"
    if not lecture_path.exists():
        sys.stderr.write(f"world_state.json not found at {lecture_path}\n")
        sys.exit(2)
    world = json.loads(lecture_path.read_text())

    print("[render-from-world] lecture={} nodes={} edges={} clusters={} radius={:.1f}".format(
        args.lecture,
        len(world.get("nodes", [])),
        len(world.get("edges", [])),
        len(world.get("clusters", [])),
        float(world.get("scene", {}).get("global_radius", 0.0)),
    ))

    built = build_scene(world, cfg)
    last_frame = keyframe_animation(world, built, cfg)

    scene = bpy.context.scene
    scene.render.engine = pick_engine(scene)
    try:
        w, h = args.resolution.lower().split("x")
        scene.render.resolution_x = int(w)
        scene.render.resolution_y = int(h)
    except Exception:
        scene.render.resolution_x = 1280
        scene.render.resolution_y = 720

    if args.save_blend:
        out_blend = Path(args.save_blend)
        out_blend.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(out_blend))
        print(f"[render-from-world] saved .blend to {out_blend}")

    if args.no_render:
        return

    if args.frame_range:
        try:
            start, end = [int(x) for x in args.frame_range.split(",")]
            scene.frame_start = start
            scene.frame_end = end
        except Exception:
            print(f"[render-from-world] bad --frame-range {args.frame_range}, rendering still at 1")
            scene.frame_start = 1
            scene.frame_end = 1
        out_dir = Path(args.output or f"/tmp/tvg_render/{args.lecture}")
        out_dir.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(out_dir) + "/frame_"
        scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(animation=True)
        print(f"[render-from-world] wrote frames to {out_dir}")
    else:
        out_png = Path(args.output or f"/tmp/tvg_render/{args.lecture}.png")
        out_png.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(out_png)
        scene.render.image_settings.file_format = "PNG"
        scene.frame_set(1)
        bpy.ops.render.render(write_still=True)
        print(f"[render-from-world] wrote {out_png}")


if __name__ == "__main__":
    main()
