extends Control
## The first scene a player sees. It shows the name set as config/name in
## project.godot.

const GAME_SCENE := "res://game/game.tscn"
const SETTINGS_SCREEN := preload("res://ui/settings_screen.tscn")


func _ready() -> void:
	# A Movie Maker capture has no input, so it records the game, not this menu.
	if OS.has_feature("movie"):
		_start_game.call_deferred()
		return
	%Title.text = ProjectSettings.get_setting("application/config/name")
	%Continue.visible = SaveGame.load_game()
	%Continue.pressed.connect(_continue_game)
	%NewGame.pressed.connect(_start_game)
	%SettingsButton.pressed.connect(_open_settings)
	%Quit.pressed.connect(get_tree().quit)
	(%Continue if %Continue.visible else %NewGame).grab_focus()


func _continue_game() -> void:
	get_tree().change_scene_to_file(GAME_SCENE)


func _start_game() -> void:
	SaveGame.start_new()
	get_tree().change_scene_to_file(GAME_SCENE)


func _open_settings() -> void:
	%Menu.hide()
	var screen := SETTINGS_SCREEN.instantiate()
	screen.closed.connect(_on_settings_closed)
	add_child(screen)


func _on_settings_closed() -> void:
	%Menu.show()
	%SettingsButton.grab_focus()
