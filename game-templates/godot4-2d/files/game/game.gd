extends Node2D
## Owns the game's progress. Replace this with your own state: it copies what
## should survive a restart into SaveGame.data, and reads it back on start.


func _ready() -> void:
	add_to_group("saved")
	var saved: Variant = SaveGame.data.get("player_position")
	if saved is Array and saved.size() == 2:
		$Player.position = Vector2(saved[0], saved[1])


func save_state() -> void:
	SaveGame.data["player_position"] = [$Player.position.x, $Player.position.y]
