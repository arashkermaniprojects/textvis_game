// Edge pulse shader — ports the reference renderer's traveling-light trail (Blender
// uses bevel_factor_start/end keyframes on a twin curve, which isn't
// available in Godot, so we fake it in a fragment shader using the
// sweep UV and TIME).
//
// The CSGPolygon3D.MODE_PATH maps the sweep direction to one of the
// UV channels. In Godot 4.3 the along-path coordinate is UV.y; the
// ring-around-polygon is UV.x. If the mapping flips we fall back to
// UV.x by toggling SWEEP_Y.

shader_type spatial;
render_mode unshaded, cull_disabled, blend_add;

uniform vec4 base_color : source_color = vec4(1.0, 0.55, 0.1, 1.0);
uniform float offset     : hint_range(0.0, 1.0) = 0.0;
uniform float speed      : hint_range(0.1, 3.0) = 0.55;
uniform float band_width : hint_range(0.02, 0.3) = 0.09;
uniform float baseline   : hint_range(0.0, 2.0) = 0.6;
uniform float pulse_gain : hint_range(0.5, 8.0) = 3.2;

void fragment() {
	float u = UV.y;
	float travel = fract(u - TIME * speed - offset);
	// Narrow bright band centred on 0 in the fract domain, with soft
	// falloff on both sides using smoothstep.
	float dist_to_band = min(travel, 1.0 - travel);
	float pulse = 1.0 - smoothstep(0.0, band_width, dist_to_band);
	vec3 col = base_color.rgb * (baseline + pulse * pulse_gain);
	ALBEDO = col;
	EMISSION = col;
	ALPHA = 1.0;
}
