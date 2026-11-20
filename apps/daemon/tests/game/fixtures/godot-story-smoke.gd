extends Node
## Plays a copied godot4-story kit through its real scenes with real input
## events. templates-godot-story.test.ts adds this as an autoload through
## override.cfg; the kit itself never ships it. The two passes run in separate
## processes, so the second proves the save written by the first comes back.
##
## Prints one "SMOKE ok <what>" per check and "SMOKE passed" at the end. Any
## failure prints "SMOKE failed <what>" and exits 1. SMOKE_SHOTS names a folder
## for screenshots; it needs a real window, so headless runs leave it unset.

const L_KEY := 76
const A_KEY := 65


func _ready() -> void:
	_run.call_deferred()


func _run() -> void:
	await _frames(5)
	match OS.get_environment("SMOKE_PASS"):
		"first":
			await _first_pass()
		"second":
			await _second_pass()
		var other:
			_check(false, "a known SMOKE_PASS, not '%s'" % other)
			return
	print("SMOKE passed")
	get_tree().quit(0)


func _first_pass() -> void:
	Settings.set_language("en")
	_check(get_tree().current_scene.name == "TitleScreen", "the first scene is the title screen")
	_check(not _find_button("Continue").visible, "no Continue button before there is a save")
	await _joy(JOY_BUTTON_A)
	await _frames(5)
	var game := get_tree().current_scene
	_check(game.name == "Game", "New game opens the story")
	_check(_find(game, "TextBox").visible, "the text box shows the first line")
	var body: RichTextLabel = _find(game, "Body")
	_check(body.text.begins_with("The last train"), "the first line comes from story/en")
	_check(body.visible_characters >= 0, "the line types itself out")
	await _key(KEY_ENTER)
	_check(body.visible_characters == -1, "Enter finishes the line being typed")
	await _key(KEY_ENTER)
	_check(await _until(func() -> bool: return _find(game, "Speaker").text == "Ren", 4.0), "after the @wait, Ren speaks with their name shown")

	# A mouse click finishes the line, a second shows the choice.
	await _click(MOUSE_BUTTON_LEFT)
	_check(body.visible_characters == -1, "a click finishes the line")
	await _shot("line")
	await _click(MOUSE_BUTTON_LEFT)
	var choices: Control = _find(game, "Choices")
	_check(choices.visible and choices.get_child_count() == 2, "a click moves on to a choice with two options")
	_check(body.text == "What do you say?", "the choice's question is shown")
	await _frames(2)
	_check(_focused() == choices.get_child(0), "a gamepad can start on the first option")
	await _shot("choice")
	await _joy(JOY_BUTTON_DPAD_DOWN)
	await _joy(JOY_BUTTON_A)
	_check(game.runner.variables.get("trust") == 1.0, "the second option runs its @add")
	_check(FileAccess.file_exists(SaveGame.PATH), "a choice saves the game")

	# Holding skip runs to the next choice, and the option that needs trust is offered.
	Input.parse_input_event(_key_event(KEY_CTRL, true))
	var reached := await _until(func() -> bool: return choices.visible, 6.0)
	Input.parse_input_event(_key_event(KEY_CTRL, false))
	_check(reached, "holding Ctrl skips to the next choice")
	_check(choices.get_child_count() == 3, "an option whose condition holds is offered")
	_check(game.runner.background == "waiting_room" and game.runner.cast.has("iko"), "the stage follows @bg and @show while skipping")
	await _shot("skip-choice")

	# The log lists what was read, and Esc closes it without pausing.
	await _key(L_KEY)
	var backlog: Control = _find(game, "Backlog")
	_check(backlog.visible and _find(game, "LogList").get_child_count() >= 3, "L opens the log with the lines read so far")
	await _frames(2)
	await _shot("log")
	await _key(KEY_ESCAPE)
	_check(not backlog.visible and not get_tree().paused, "Esc closes the log and does not pause")

	# Changing the language switches the story in place.
	Settings.set_language("zh_CN")
	await _frames(3)
	_check(choices.visible and (choices.get_child(0) as Button).text == "问问那封信", "the story switches to story/zh_CN at the same choice")
	await _shot("choice-zh")
	Settings.set_language("en")
	await _frames(3)
	_check((choices.get_child(0) as Button).text == "Ask about the letter", "and back to English")

	# Quit to the title through the pause menu: the save keeps this choice.
	await _joy(JOY_BUTTON_START)
	_check(get_tree().paused, "Start pauses the story")
	_find(game, "QuitToTitle").pressed.emit()
	await _frames(5)
	_check(get_tree().current_scene.name == "TitleScreen", "Quit to title returns to the title screen")
	_check(_find_button("Continue").visible, "Continue appears once a save exists")


func _second_pass() -> void:
	await _joy(JOY_BUTTON_A)
	await _frames(5)
	var game := get_tree().current_scene
	var choices: Control = _find(game, "Choices")
	_check(game.name == "Game" and choices.visible and choices.get_child_count() == 3, "Continue returns to the same choice")
	_check(game.runner.variables.get("trust") == 1.0, "the variables come back with the save")
	_check(game.runner.cast.has("ren") and game.runner.cast.has("iko"), "the cast on stage comes back with the save")

	# Auto play reads to the ending with no more input.
	await _key(A_KEY)
	_check(_find_button("AutoButton").button_pressed, "A turns on auto play")
	await _frames(2)
	await _joy(JOY_BUTTON_DPAD_DOWN)
	await _joy(JOY_BUTTON_DPAD_DOWN)
	await _joy(JOY_BUTTON_A)
	_check(await _until(func() -> bool: return _find(game, "EndCard").visible, 20.0), "auto play reaches an ending")
	_check(_find(game, "EndingTitle").text == "The Keeper's Stove", "the ending shows its title")
	_check(_find(game, "EndingsFound").text == "Endings found: 1 of 3", "the ending card counts the endings found")
	_check(not FileAccess.file_exists(SaveGame.PATH), "finishing the story removes the save")
	var endings: Variant = JSON.parse_string(FileAccess.get_file_as_string(game.ENDINGS_PATH))
	_check(endings is Array and "keeper" in endings, "the ending is remembered apart from the save")
	await _frames(2)
	await _shot("ending")
	await _joy(JOY_BUTTON_A)
	await _frames(5)
	_check(get_tree().current_scene.name == "TitleScreen", "the ending's button returns to the title")
	_check(not _find_button("Continue").visible, "a finished story offers New game, not Continue")


func _until(condition: Callable, seconds: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(seconds * 1000)
	while Time.get_ticks_msec() < deadline:
		if condition.call():
			return true
		await get_tree().process_frame
	return condition.call()


func _check(ok: bool, what: String) -> void:
	if ok:
		print("SMOKE ok ", what)
		return
	print("SMOKE failed ", what)
	get_tree().quit(1)


func _focused() -> Control:
	return get_viewport().gui_get_focus_owner()


func _find(root: Node, node_name: String) -> Node:
	return root.find_child(node_name, true, false)


func _find_button(node_name: String) -> Button:
	return _find(get_tree().current_scene, node_name) as Button


func _key_event(code: int, pressed := false) -> InputEventKey:
	var event := InputEventKey.new()
	event.physical_keycode = code as Key
	event.keycode = code as Key
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


func _click(button: MouseButton) -> void:
	var press := InputEventMouseButton.new()
	press.button_index = button
	press.pressed = true
	press.position = get_viewport().get_visible_rect().size / 2
	var release: InputEventMouseButton = press.duplicate()
	release.pressed = false
	await _tap(press, release)


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


func _shot(shot_name: String) -> void:
	var folder := OS.get_environment("SMOKE_SHOTS")
	if folder.is_empty():
		return
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(folder.path_join("%s.png" % shot_name))
