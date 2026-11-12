extends CharacterBody2D

@export var speed: float = 240.0


func _physics_process(_delta: float) -> void:
	velocity = Input.get_vector("move_left", "move_right", "move_up", "move_down") * speed
	move_and_slide()
	position = position.clamp(Vector2(16, 16), get_viewport_rect().size - Vector2(16, 16))
