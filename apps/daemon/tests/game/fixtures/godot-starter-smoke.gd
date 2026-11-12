extends Node
## Drives a copied Godot starter through its real scenes with real input events.
## templates-godot.test.ts adds this as an autoload through override.cfg; the
## starter itself never ships it. Two passes run in separate processes, so the
## second proves what the first wrote to user:// really comes back after a restart.
##
## Prints one "SMOKE ok <what>" per check and "SMOKE passed" at the end. Any
## failure prints "SMOKE failed <what>" and exits 1. SMOKE_SHOTS names a folder
## for screenshots; it needs a real window, so headless runs leave it unset.

const JOY_A := JOY_BUTTON_A
const JOY_B := JOY_BUTTON_B
const JOY_START := JOY_BUTTON_START
const JOY_DOWN := JOY_BUTTON_DPAD_DOWN
const JOY_UP := JOY_BUTTON_DPAD_UP
const J_KEY := 74 # Physical J.
const W_KEY := 87


func _ready() -> void:
	_run.call_deferred()


func _run() -> void:
	var pass_name := OS.get_environment("SMOKE_PASS")
	await _frames(5)
	match pass_name:
		"first":
			await _first_pass()
		"second":
			await _second_pass()
		"quit-game":
			await _quit_from_game()
			return
		"quit-title":
			await _quit_from_title()
			return
		_:
			_check(false, "a known SMOKE_PASS, not '%s'" % pass_name)
			return
	print("SMOKE passed")
	get_tree().quit(0)


func _first_pass() -> void:
	_check(get_tree().current_scene.name == "TitleScreen", "the first scene is the title screen")
	_check(not _find_button("Continue").visible, "no Continue button before there is a save")
	_check(_focused() == _find_button("NewGame"), "a gamepad can start on New game")
	_check(not FileAccess.file_exists("user://save.json"), "no save file on a first run")
	await _shot("title")

	# Reach the settings with a gamepad alone.
	await _joy(JOY_DOWN)
	_check(_focused() == _find_button("SettingsButton"), "D-pad down moves the menu focus")
	await _joy(JOY_A)
	var screen := get_tree().current_scene.get_node_or_null("SettingsScreen")
	_check(screen != null, "A opens the settings screen")
	await _frames(3)
	await _shot("settings")

	# Display mode.
	var display: OptionButton = _find(screen, "DisplayMode")
	_check(_focused() == display, "the settings open with the focus on the first row")
	await _joy(JOY_A)
	_check(display.get_popup().visible, "A opens the display mode list")
	await _joy(JOY_DOWN)
	await _joy(JOY_A)
	await _frames(10)
	_check(display.selected == 1, "a gamepad can pick Fullscreen")
	_check(Settings.is_fullscreen(), "fullscreen is stored")
	if DisplayServer.get_name() != "headless":
		_check(DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_FULLSCREEN, "the window goes fullscreen")
		await _shot("settings-fullscreen")
		display.select(0)
		display.item_selected.emit(0)
		await _frames(10)
		_check(DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_WINDOWED, "the window returns to windowed")
	else:
		display.select(0)
		display.item_selected.emit(0)
	_check(not Settings.is_fullscreen(), "windowed is stored")

	# Volume.
	var sliders := screen.find_children("*", "HSlider", true, false)
	_check(sliders.size() == Settings.VOLUME_BUSES.size(), "one volume slider per bus")
	(sliders[1] as HSlider).value = 0.25
	var music := AudioServer.get_bus_index("Music")
	_check(music >= 0 and is_equal_approx(AudioServer.get_bus_volume_db(music), linear_to_db(0.25)), "the music slider changes the music bus")
	(sliders[2] as HSlider).value = 0.0
	_check(AudioServer.is_bus_mute(AudioServer.get_bus_index("SFX")), "a volume of zero mutes the bus")

	# Language: the table's own column, live, and a key that resolves through tr().
	var language: OptionButton = _find(screen, "Language")
	_check(language.item_count == Strings.locales.size() + 1, "every language column is offered")
	var english := Strings.locales.find("en") + 1
	language.select(english)
	language.item_selected.emit(english)
	await _frames(3)
	_check(tr("MENU_SETTINGS") == "Settings", "English comes from the table")
	await _shot("settings-en")
	var chinese := Strings.locales.find("zh_CN") + 1
	language.select(chinese)
	language.item_selected.emit(chinese)
	await _frames(3)
	_check(tr("MENU_SETTINGS") == "设置", "the language changes the strings")
	await _shot("settings-zh")

	# Rebind a key: press the row's button, then the new key.
	var rows := _binding_buttons(screen)
	var left_keys := _row(rows, &"move_left", Settings.KEYS)
	left_keys.pressed.emit()
	_check(left_keys.get_meta("slot") == Settings.KEYS, "the row accepts a key")
	await _key(J_KEY)
	_check(InputMap.action_has_event(&"move_left", _key_event(J_KEY)), "J now moves left")
	_check(not left_keys.text.is_empty() and left_keys.text != "SETTINGS_PRESS_KEY", "the row shows the new key")
	Input.parse_input_event(_key_event(J_KEY, true))
	await _frames(2)
	_check(Input.is_action_pressed(&"move_left"), "pressing J triggers the action")
	Input.parse_input_event(_key_event(J_KEY, false))
	await _frames(2)

	# A key another action holds moves to this one, and that action keeps a key.
	var right_keys := _row(rows, &"move_right", Settings.KEYS)
	right_keys.pressed.emit()
	await _key(J_KEY)
	_check(InputMap.action_has_event(&"move_right", _key_event(J_KEY)), "J moved to move_right")
	_check(not InputMap.action_has_event(&"move_left", _key_event(J_KEY)), "J left move_left")
	_check(not Settings.events_in(&"move_left", Settings.KEYS).is_empty(), "move_left still has a key")

	# Escape cancels a rebind and changes nothing.
	right_keys.pressed.emit()
	await _key(KEY_ESCAPE)
	_check(InputMap.action_has_event(&"move_right", _key_event(J_KEY)), "Esc cancels a rebind")
	_check(get_tree().current_scene.get_node_or_null("SettingsScreen") != null, "that Esc did not close the settings")

	# Rebind a gamepad button.
	var up_buttons := _row(rows, &"move_up", Settings.BUTTONS)
	up_buttons.grab_focus()
	await _joy(JOY_A)
	_check(up_buttons.text == "SETTINGS_PRESS_BUTTON", "A on a row starts listening for a button")
	await _key(J_KEY) # A key is not a button: still listening.
	_check(up_buttons.text == "SETTINGS_PRESS_BUTTON", "a key does not end a gamepad rebind")
	await _joy(JOY_BUTTON_Y)
	_check(not InputMap.action_has_event(&"move_up", _button_event(JOY_UP)), "the old button is gone")
	_check(InputMap.action_has_event(&"move_up", _button_event(JOY_BUTTON_Y)), "Y now moves up")
	var stick := InputEventJoypadMotion.new()
	stick.axis = JOY_AXIS_LEFT_Y
	stick.axis_value = -1.0
	stick.device = 0
	_check(InputMap.action_has_event(&"move_up", stick), "the left stick stays bound")
	await _shot("settings-rebound")

	# B closes the settings and returns the focus.
	await _joy(JOY_B)
	await _frames(2)
	_check(get_tree().current_scene.get_node_or_null("SettingsScreen") == null, "B closes the settings")
	_check(_focused() == _find_button("SettingsButton"), "the focus returns to Settings")

	# Start a game with the gamepad.
	await _joy(JOY_UP)
	await _joy(JOY_A)
	await _frames(5)
	_check(get_tree().current_scene.name == "Game", "New game opens the game scene")
	await _shot("game")

	# The rebound and default inputs both move the player.
	var player := get_tree().current_scene.get_node("Player")
	var start: Variant = player.position
	var d_pad := _button_event(JOY_BUTTON_DPAD_LEFT, true)
	Input.parse_input_event(d_pad)
	await _physics(15)
	Input.parse_input_event(_button_event(JOY_BUTTON_DPAD_LEFT, false))
	await _frames(2)
	_check(player.position != start, "the gamepad moves the player")
	var moved: Variant = player.position

	# Start pauses: no movement while paused, then quit to title saves.
	await _joy(JOY_START)
	_check(get_tree().paused, "Start pauses the game")
	await _frames(2)
	await _shot("paused")
	Input.parse_input_event(_button_event(JOY_BUTTON_DPAD_LEFT, true))
	await _physics(10)
	Input.parse_input_event(_button_event(JOY_BUTTON_DPAD_LEFT, false))
	await _frames(2)
	_check(player.position == moved, "the player stays still while paused")
	await _joy(JOY_B)
	_check(not get_tree().paused, "B resumes the game")
	await _joy(JOY_START)

	# Open the settings from the pause menu: they must work while paused.
	var pause_menu := get_tree().current_scene.get_node("PauseMenu")
	_find(pause_menu, "SettingsButton").pressed.emit()
	await _frames(2)
	var paused_settings := pause_menu.find_child("SettingsScreen", true, false)
	_check(paused_settings != null, "the settings open from the pause menu")
	await _joy(JOY_B)
	await _frames(2)
	_check(get_tree().paused and pause_menu.find_child("SettingsScreen", true, false) == null, "B returns to the pause menu")

	_find(pause_menu, "QuitToTitle").pressed.emit()
	await _frames(5)
	_check(get_tree().current_scene.name == "TitleScreen", "Quit to title returns to the title screen")
	_check(not get_tree().paused, "the title screen is not paused")
	_check(FileAccess.file_exists("user://save.json"), "quitting to the title writes a save")
	_check(_find_button("Continue").visible, "Continue appears once a save exists")
	_check(_focused() == _find_button("Continue"), "the focus starts on Continue")
	var expected: Array = SaveGame.data["player_position"]
	_write_marker(expected)

	# Every path under user:// sits outside the game's folder.
	var game_folder := ProjectSettings.globalize_path("res://").simplify_path()
	var user_folder := ProjectSettings.globalize_path("user://").simplify_path()
	_check(not user_folder.begins_with(game_folder), "user data is outside the game folder")
	_check(not FileAccess.file_exists(game_folder.path_join("save.json")), "no save beside the game files")


func _second_pass() -> void:
	_check(Settings.get_volume("Music") == 0.25, "the music volume survives a restart")
	_check(AudioServer.is_bus_mute(AudioServer.get_bus_index("SFX")), "the mute survives a restart")
	_check(Settings.get_language() == "zh_CN" and tr("MENU_SETTINGS") == "设置", "the language survives a restart")
	_check(InputMap.action_has_event(&"move_right", _key_event(J_KEY)), "a rebound key survives a restart")
	_check(InputMap.action_has_event(&"move_up", _button_event(JOY_BUTTON_Y)), "a rebound button survives a restart")

	var continue_button := _find_button("Continue")
	_check(continue_button.visible and _focused() == continue_button, "Continue is offered after a restart")
	await _shot("title-continue")
	await _joy(JOY_A)
	await _frames(5)
	_check(get_tree().current_scene.name == "Game", "Continue opens the game scene")
	var player := get_tree().current_scene.get_node("Player")
	var marker: Array = str_to_var(FileAccess.get_file_as_string("user://smoke-marker.txt"))
	var position: Vector2 = Vector2(player.position.x, player.position.y if player.position is Vector2 else player.position.z)
	_check(position.is_equal_approx(Vector2(marker[0], marker[1])), "the saved position comes back")

	# Reset restores the project's bindings and the sticks.
	Settings.reset_bindings()
	_check(not InputMap.action_has_event(&"move_up", _button_event(JOY_BUTTON_Y)), "reset removes the rebound button")
	_check(InputMap.action_has_event(&"move_up", _button_event(JOY_UP)), "reset restores the default button")
	_check(InputMap.action_has_event(&"move_up", _key_event(W_KEY)), "reset restores the default key")

	# Closing the window saves. Telling the nodes directly leaves the process running.
	player.position += Vector3(1, 0, 0) if player.position is Vector3 else Vector2(1, 0)
	var before: Array = SaveGame.data["player_position"].duplicate()
	get_tree().root.propagate_notification(NOTIFICATION_WM_CLOSE_REQUEST)
	await _frames(1)
	var written: Variant = JSON.parse_string(FileAccess.get_file_as_string(SaveGame.PATH))
	_check(written is Dictionary and written["player_position"] != before, "closing the window saves the latest state")

	# A damaged save does not stop the game.
	FileAccess.open("user://save.json", FileAccess.WRITE).store_string("{ not json")
	_check(not SaveGame.load_game(), "a damaged save is refused")


## The process ending with code 0 is what proves these two buttons work.
func _quit_from_game() -> void:
	_find_button("NewGame").pressed.emit()
	await _frames(5)
	await _joy(JOY_START)
	print("SMOKE passed")
	_find_button("QuitToDesktop").pressed.emit()
	await _still_running()


func _quit_from_title() -> void:
	_check(SaveGame.load_game(), "Quit to desktop wrote a readable save")
	print("SMOKE passed")
	_find_button("Quit").pressed.emit()
	await _still_running()


func _still_running() -> void:
	await get_tree().create_timer(5.0).timeout
	_check(false, "the quit button ends the game")


func _write_marker(position: Array) -> void:
	FileAccess.open("user://smoke-marker.txt", FileAccess.WRITE).store_string(var_to_str(position))


func _check(ok: bool, what: String) -> void:
	if ok:
		print("SMOKE ok ", what)
		return
	# The tree stops at the end of this frame, so the scenario's next await never returns.
	print("SMOKE failed ", what)
	get_tree().quit(1)


func _focused() -> Control:
	return get_viewport().gui_get_focus_owner()


func _find(root: Node, node_name: String) -> Node:
	return root.find_child(node_name, true, false)


func _find_button(node_name: String) -> Button:
	return _find(get_tree().current_scene, node_name) as Button


func _binding_buttons(screen: Node) -> Array:
	return screen.find_children("*", "Button", true, false).filter(func(button: Node) -> bool: return button.has_meta("slot"))


func _row(rows: Array, action: StringName, slot: String) -> Button:
	for button: Button in rows:
		if button.get_meta("action") == action and button.get_meta("slot") == slot:
			return button
	return null


func _key_event(code: int, pressed := false) -> InputEventKey:
	var event := InputEventKey.new()
	event.physical_keycode = code as Key
	event.pressed = pressed
	event.device = 0
	return event


func _button_event(index: int, pressed := false) -> InputEventJoypadButton:
	var event := InputEventJoypadButton.new()
	event.button_index = index as JoyButton
	event.pressed = pressed
	event.device = 0
	return event


func _key(code: int) -> void:
	await _tap(_key_event(code, true), _key_event(code, false))


func _joy(index: int) -> void:
	await _tap(_button_event(index, true), _button_event(index, false))


## Press and release at a person's pace: menus and popups act over real time, not frames.
func _tap(press: InputEvent, release: InputEvent) -> void:
	Input.parse_input_event(press)
	await get_tree().create_timer(0.06).timeout
	Input.parse_input_event(release)
	await get_tree().create_timer(0.06).timeout
	await _frames(2)


func _frames(count: int) -> void:
	for i in count:
		await get_tree().process_frame


func _physics(count: int) -> void:
	for i in count:
		await get_tree().physics_frame


func _shot(shot_name: String) -> void:
	var folder := OS.get_environment("SMOKE_SHOTS")
	if folder.is_empty():
		return
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(folder.path_join("%s.png" % shot_name))
