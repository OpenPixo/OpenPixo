extends CharacterBody3D

@export var speed: float = 5.0
@export var bounds: float = 7.5


func _physics_process(_delta: float) -> void:
	var input := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	velocity = Vector3(input.x, 0.0, input.y) * speed
	move_and_slide()
	position.x = clampf(position.x, -bounds, bounds)
	position.z = clampf(position.z, -bounds, bounds)
