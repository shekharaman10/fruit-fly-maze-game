# What a knocked-down body actually does, measured rather than guessed.
#
# web/walker has no balance model: the character cannot fall over, and
# docs/walker.md lists that as a limitation. Before writing one in JavaScript
# it is worth knowing what the answer should look like -- how far a person goes
# when hit, how long they are down, how hard an impulse has to be before it
# matters at all. Godot has Jolt, so the cheapest way to find out is to ask it.
#
# NOTHING HERE SHIPS. This is a measuring instrument. What crosses back into
# web/walker/world/body3d.js is a handful of numbers, not this code -- the
# walker vendors three.js and nothing else, and that has not changed.
#
# Run:  godot --headless --path .
extends Node3D

# The character web/walker uses: 1.78 m, and 75 kg is the anthropometry that
# goes with it. Radius matches BODY_RADIUS in world/maze.js.
const HEIGHT := 1.78
const RADIUS := 0.32
const MASS := 75.0

# Impulses to try, in newton-seconds. 75 kg * 1 m/s = 75, so these read as
# "knocked to 1 m/s", "to 4 m/s", and so on.
const IMPULSES := [75.0, 150.0, 300.0, 600.0]

# Settled = barely moving and barely turning, for a quarter second.
const V_STILL := 0.15
const W_STILL := 0.30
const STILL_HOLD := 0.25

var _body: RigidBody3D
var _trial := -1
var _t := 0.0
var _still := 0.0
var _start := Vector3.ZERO
var _peak_height := 0.0
var _results: Array = []
var _pending := 0


func _ready() -> void:
	var floor_body := StaticBody3D.new()
	var floor_shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(200, 1, 200)
	var mat := PhysicsMaterial.new()
	mat.friction = 0.9
	floor_body.physics_material_override = mat
	floor_shape.shape = box
	floor_shape.position = Vector3(0, -0.5, 0)
	floor_body.add_child(floor_shape)
	add_child(floor_body)

	print("knockdown: %.2f m, %.0f kg, capsule r=%.2f" % [HEIGHT, MASS, RADIUS])
	print("physics  : %d Hz, %s" % [
		Engine.physics_ticks_per_second,
		ProjectSettings.get_setting("physics/3d/physics_engine", "default"),
	])
	print("")
	print("  impulse   knocked to   travelled   time down   ended")
	print("  -------   ----------   ---------   ---------   -----")
	_next_trial()


func _next_trial() -> void:
	if _body != null:
		_body.queue_free()
		_body = null

	_trial += 1
	if _trial >= IMPULSES.size():
		_finish()
		return

	var rb := RigidBody3D.new()
	rb.mass = MASS
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.height = HEIGHT
	cap.radius = RADIUS
	shape.shape = cap
	rb.add_child(shape)
	# Standing: capsule centre at half height.
	rb.position = Vector3(0, HEIGHT * 0.5, 0)
	add_child(rb)
	_body = rb

	# The hit waits one physics frame -- see _physics_process. Two things about
	# impulses on 4.7.2 had to be measured rather than assumed, and both make a
	# 75 kg body behave like a 1 kg one if you get them wrong:
	#
	#   1. rb.apply_impulse() does not divide by mass. 75 N*s on 75 kg came out
	#      at 74.875 m/s instead of 1.0, while the server correctly reported
	#      BODY_PARAM_MASS = 75. PhysicsServer3D.body_apply_impulse gave 0.998.
	#   2. The mass is not IN the server until the body has been stepped once.
	#      Applying in the same frame as add_child() hits the default 1 kg, which
	#      is why fixing (1) alone changed nothing.
	# TWO frames, not one. The body has to be stepped once for its mass to be
	# in the server, and a body created inside _ready() has not been stepped at
	# all when the first _physics_process runs -- which is why trial 1 kept
	# behaving like 1 kg after trials 2-4 were fixed.
	_pending = 2
	_t = 0.0
	_still = 0.0
	_start = rb.position
	_peak_height = rb.position.y


func _physics_process(delta: float) -> void:
	if _body == null:
		return

	if _pending > 0:
		_pending -= 1
		if _pending > 0:
			return
		# Hit at chest height rather than through the centre of mass: the offset
		# is what turns a shove into a knockdown, because it produces the spin.
		PhysicsServer3D.body_apply_impulse(
			_body.get_rid(),
			Vector3(IMPULSES[_trial], 0, 0),
			Vector3(0, HEIGHT * 0.25, 0),
		)
		_t = 0.0
		_start = _body.position
		return

	_t += delta
	_peak_height = max(_peak_height, _body.position.y)

	var v := _body.linear_velocity.length()
	var w := _body.angular_velocity.length()
	if v < V_STILL and w < W_STILL:
		_still += delta
	else:
		_still = 0.0

	if _still >= STILL_HOLD or _t > 12.0:
		var travelled := Vector2(
			_body.position.x - _start.x, _body.position.z - _start.z
		).length()
		# How far from standing it ended: 0 deg is upright, 90 is flat out.
		var up := _body.global_transform.basis.y
		var tipped := rad_to_deg(up.angle_to(Vector3.UP))
		var ended := "flat" if tipped > 60.0 else ("stumbled" if tipped > 15.0 else "stayed up")

		print("  %7.0f   %6.2f m/s   %7.2f m   %7.2f s   %s" % [
			IMPULSES[_trial],
			IMPULSES[_trial] / MASS,
			travelled,
			_t - STILL_HOLD,
			ended,
		])
		_results.append({
			"impulse": IMPULSES[_trial],
			"travelled": travelled,
			"down": _t - STILL_HOLD,
			"tipped": tipped,
		})
		_next_trial()


func _finish() -> void:
	print("")
	# The number body3d.js would actually want: the threshold where a hit stops
	# being a shove and starts being a knockdown.
	var first_fall := -1.0
	for r in _results:
		if r["tipped"] > 60.0:
			first_fall = r["impulse"]
			break
	if first_fall > 0.0:
		print("knocks flat from : %.0f N*s (%.1f m/s)" % [first_fall, first_fall / MASS])
	else:
		print("nothing tested knocked it flat")
	print("done")
	get_tree().quit()
