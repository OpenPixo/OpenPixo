extends CanvasLayer
## Opens over the game on the pause action, so a player in fullscreen or on a
## gamepad can always reach settings and quit. Both quit buttons save first.

const TITLE_SCENE := "res://ui/title_screen.tscn"
const SETTINGS_SCREEN := preload("res://ui/settings_screen.tscn")


func _ready() -> void:
	%Resume.pressed.connect(_set_open.bind(false))
	%SettingsButton.pressed.connect(_open_settings)
	%QuitToTitle.pressed.connect(_quit_to_title)
	%QuitToDesktop.pressed.connect(_quit_to_desktop)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause") or (visible and event.is_action_pressed("ui_cancel")):
		get_viewport().set_input_as_handled()
		_set_open(not visible)


func _set_open(open: bool) -> void:
	visible = open
	get_tree().paused = open
	if open:
		%Resume.grab_focus()
	else:
		get_viewport().gui_release_focus()


func _open_settings() -> void:
	%Menu.hide()
	var screen := SETTINGS_SCREEN.instantiate()
	screen.closed.connect(_on_settings_closed)
	%Root.add_child(screen)


func _on_settings_closed() -> void:
	%Menu.show()
	%SettingsButton.grab_focus()


func _quit_to_title() -> void:
	SaveGame.save()
	get_tree().paused = false
	get_tree().change_scene_to_file(TITLE_SCENE)


func _quit_to_desktop() -> void:
	SaveGame.save()
	get_tree().quit()
