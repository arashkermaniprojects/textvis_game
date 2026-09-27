extends Camera3D

# Free-flight camera: WASD planar, Q/E vertical, Shift to sprint, mouse look.

@export var speed: float = 25.0
@export var sprint_multiplier: float = 4.0
@export var mouse_sensitivity: float = 0.002

# Disabled by lecture_mode.gd while its Tween drives the camera.
var enabled: bool = true

var yaw: float = 0.0
var pitch: float = 0.0

func reset_look_angles() -> void:
	# Call after externally positioning/looking the camera so _input
	# continues from the current orientation instead of snapping.
	yaw = rotation.y
	pitch = rotation.x

func _ready() -> void:
	reset_look_angles()

func _input(event: InputEvent) -> void:
	if not enabled:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		yaw -= event.relative.x * mouse_sensitivity
		pitch -= event.relative.y * mouse_sensitivity
		pitch = clamp(pitch, -1.48, 1.48)
		rotation = Vector3(pitch, yaw, 0.0)

func _process(delta: float) -> void:
	if not enabled:
		return
	var dir := Vector3.ZERO
	var forward := -global_transform.basis.z
	var right := global_transform.basis.x
	var up := Vector3.UP

	# SPACE is reserved for lecture-mode toggle; up/down is E/Q only.
	if Input.is_key_pressed(KEY_W): dir += forward
	if Input.is_key_pressed(KEY_S): dir -= forward
	if Input.is_key_pressed(KEY_A): dir -= right
	if Input.is_key_pressed(KEY_D): dir += right
	if Input.is_key_pressed(KEY_E): dir += up
	if Input.is_key_pressed(KEY_Q) or Input.is_key_pressed(KEY_CTRL): dir -= up

	if dir.length() > 0.01:
		dir = dir.normalized()
		var s := speed
		if Input.is_key_pressed(KEY_SHIFT):
			s *= sprint_multiplier
		position += dir * s * delta
