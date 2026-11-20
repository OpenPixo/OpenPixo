extends Control
## One playthrough of the story. game/story/runner.gd decides what happens;
## this scene shows it: the text box with its typewriter, the choices, the log,
## auto and skip, the ending card, music and sound. It saves where the player
## is after every choice and whenever SaveGame saves (quitting or closing).
##
## You rarely need to change this file to write a story: edit story/ instead.
## The look is in game.tscn and ui/theme.tres.

const Library := preload("res://game/story/library.gd")
const Runner := preload("res://game/story/runner.gd")

const TITLE_SCENE := "res://ui/title_screen.tscn"
## Endings the player has reached in any playthrough, kept apart from the save.
const ENDINGS_PATH := "user://endings.json"
const CHARACTERS_PER_SECOND := 45.0
## How long auto play waits after a line has finished: a base plus a little per character.
const AUTO_DELAY := 0.9
const AUTO_DELAY_PER_CHARACTER := 0.045
const SKIP_INTERVAL := 0.06

var runner: Runner
## The folder under res://story being read, such as "en".
var language := ""
var characters: Dictionary = {}

var _current: Dictionary = {}
var _typing := false
var _shown := 0.0
var _auto := false
var _auto_left := 0.0
var _skip_left := 0.0
var _wait_left := 0.0
var _music_name := ""
var _started := false


func _ready() -> void:
	add_to_group("saved")
	characters = Library.load_characters()
	language = Library.pick_language(TranslationServer.get_locale())
	runner = Runner.new(Library.load_book(language))
	for problem: String in runner.book.errors:
		push_error(problem)
	if not runner.from_save(SaveGame.data.get("story")):
		runner.start()
	%LogButton.pressed.connect(open_log)
	%AutoButton.toggled.connect(_on_auto_toggled)
	%CloseLog.pressed.connect(close_log)
	%BackToTitle.pressed.connect(get_tree().change_scene_to_file.bind(TITLE_SCENE))
	_show(runner.step())
	_started = true


func save_state() -> void:
	SaveGame.data["story"] = runner.to_save()


## Finishes the line being typed, or moves on to the next one.
func advance() -> void:
	if _typing:
		_finish_typing()
	elif _current.kind in ["line", "wait"]:
		_show(runner.next())


func choose(option_index: int) -> void:
	_clear_choices()
	_show(runner.choose(option_index))
	SaveGame.save()


func open_log() -> void:
	for child in %LogList.get_children():
		child.queue_free()
	for entry: Array in runner.history:
		var command := runner.command_at(entry)
		var text := ""
		if command.get("kind") == "line" and entry.size() == 2:
			text = _log_line(command)
		elif command.get("kind") == "choice" and entry.size() > 2 and entry[2] < command.options.size():
			text = "[color=#9aa7bd]→ %s[/color]" % command.options[entry[2]].text
		if text:
			var row := RichTextLabel.new()
			row.bbcode_enabled = true
			row.fit_content = true
			row.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
			row.text = text
			%LogList.add_child(row)
	%LogEmpty.visible = runner.history.is_empty()
	%Backlog.show()
	%CloseLog.grab_focus()
	await get_tree().process_frame
	%Scroll.scroll_vertical = int(%Scroll.get_v_scroll_bar().max_value)


func close_log() -> void:
	%Backlog.hide()


func _input(event: InputEvent) -> void:
	# Ahead of the pause menu, so Esc or B closes the log instead of pausing.
	if %Backlog.visible and (event.is_action_pressed("ui_cancel") or event.is_action_pressed("story_log") or _is_click(event, MOUSE_BUTTON_RIGHT)):
		get_viewport().set_input_as_handled()
		close_log()


func _unhandled_input(event: InputEvent) -> void:
	if %Backlog.visible or %EndCard.visible:
		return
	if event.is_action_pressed("story_log") or _is_click(event, MOUSE_BUTTON_WHEEL_UP):
		get_viewport().set_input_as_handled()
		open_log()
	elif event.is_action_pressed("story_auto"):
		get_viewport().set_input_as_handled()
		%AutoButton.button_pressed = not %AutoButton.button_pressed
	elif not %Choices.visible and (event.is_action_pressed("advance") or _is_click(event, MOUSE_BUTTON_LEFT)):
		get_viewport().set_input_as_handled()
		advance()


func _process(delta: float) -> void:
	_keep_focus()
	if %Backlog.visible or %EndCard.visible:
		return
	var skipping: bool = %SkipButton.button_pressed or Input.is_action_pressed("story_skip")
	if _typing:
		_shown += delta * CHARACTERS_PER_SECOND * (20.0 if skipping else 1.0)
		%Body.visible_characters = int(_shown)
		if _shown >= %Body.get_total_character_count():
			_finish_typing()
		return
	match _current.get("kind"):
		"wait":
			_wait_left -= delta
			if _wait_left <= 0.0 or skipping:
				advance()
		"line":
			if skipping:
				_skip_left -= delta
				if _skip_left <= 0.0:
					_skip_left = SKIP_INTERVAL
					advance()
			elif _auto:
				_auto_left -= delta
				if _auto_left <= 0.0:
					advance()


func _notification(what: int) -> void:
	# A language picked in Settings switches the story to that folder at the same place.
	if what != NOTIFICATION_TRANSLATION_CHANGED or not _started:
		return
	var picked := Library.pick_language(TranslationServer.get_locale())
	if picked == language:
		return
	var place := runner.to_save()
	language = picked
	runner = Runner.new(Library.load_book(language))
	if not runner.from_save(place):
		runner.start()
	_show(runner.step())
	_finish_typing()
	if %Backlog.visible:
		open_log()


func _show(command: Dictionary) -> void:
	_current = command
	_clear_choices()
	%Stage.show_stage(runner.background, runner.cast, characters, language, command.get("speaker", ""))
	_play_audio()
	match command.kind:
		"line":
			_show_text(command.speaker, command.text)
		"choice":
			if command.prompt:
				_show_text("", command.prompt)
			%SkipButton.button_pressed = false
			_show_choices()
		"wait":
			_wait_left = command.seconds
		"end":
			_show_end(command)


func _show_text(speaker: String, text: String) -> void:
	%Speaker.visible = not speaker.is_empty()
	%Speaker.text = Library.character_name(characters, speaker, language) if speaker else ""
	%Speaker.add_theme_color_override("font_color", Library.character_color(characters, speaker))
	%Body.text = text
	%Body.visible_characters = 0
	_shown = 0.0
	_typing = true
	%TextBox.show()


func _finish_typing() -> void:
	_typing = false
	%Body.visible_characters = -1
	_auto_left = AUTO_DELAY + AUTO_DELAY_PER_CHARACTER * %Body.get_total_character_count()


func _show_choices() -> void:
	var open := runner.options()
	if open.is_empty():
		_show(runner.skip_choice())
		return
	for option: Dictionary in open:
		var button := Button.new()
		button.text = option.text
		button.auto_translate_mode = Node.AUTO_TRANSLATE_MODE_DISABLED
		button.pressed.connect(choose.bind(option.index))
		%Choices.add_child(button)
	%Choices.show()


func _clear_choices() -> void:
	for child in %Choices.get_children():
		%Choices.remove_child(child)
		child.queue_free()
	%Choices.hide()


func _show_end(command: Dictionary) -> void:
	%TextBox.hide()
	%Toolbar.hide()
	var found := _record_ending(command.id)
	var all := _ending_ids()
	%EndingTitle.text = command.title
	%EndingTitle.visible = not command.title.is_empty()
	%EndingsFound.text = tr("STORY_ENDINGS_FOUND") % [all.filter(func(id: String) -> bool: return id in found).size(), all.size()]
	%EndingsFound.visible = not all.is_empty()
	%EndCard.show()
	%BackToTitle.grab_focus()
	# A finished story starts over: without a save the title screen offers New game.
	SaveGame.data = {}
	if SaveGame.exists():
		DirAccess.remove_absolute(SaveGame.PATH)


func _play_audio() -> void:
	if runner.music != _music_name:
		_music_name = runner.music
		var path := Library.music_path(_music_name) if _music_name else ""
		if path:
			var stream: AudioStream = load(path)
			if "loop" in stream:
				stream.set("loop", true)
			%Music.stream = stream
			%Music.play()
		else:
			%Music.stop()
	for sound in runner.pending_sounds:
		var path := Library.sound_path(sound)
		if path:
			var player := AudioStreamPlayer.new()
			player.bus = "SFX"
			player.stream = load(path)
			player.finished.connect(player.queue_free)
			add_child(player)
			player.play()
	runner.pending_sounds.clear()


func _log_line(command: Dictionary) -> String:
	if command.speaker.is_empty():
		return command.text
	var colour := Library.character_color(characters, command.speaker).to_html(false)
	return "[color=#%s]%s[/color]  %s" % [colour, Library.character_name(characters, command.speaker, language), command.text]


## Endings named in this story's @end lines.
func _ending_ids() -> Array:
	var ids: Array = []
	for label: String in runner.book.labels:
		for command: Dictionary in runner.book.labels[label]:
			if command.kind == "end" and command.id and not command.id in ids:
				ids.append(command.id)
	return ids


func _record_ending(id: String) -> Array:
	var found: Variant = JSON.parse_string(FileAccess.get_file_as_string(ENDINGS_PATH)) if FileAccess.file_exists(ENDINGS_PATH) else []
	if not found is Array:
		found = []
	if id and not id in found:
		found.append(id)
		var file := FileAccess.open(ENDINGS_PATH, FileAccess.WRITE)
		if file:
			file.store_string(JSON.stringify(found))
	return found


func _on_auto_toggled(on: bool) -> void:
	_auto = on
	if not _typing:
		_finish_typing()


## A gamepad player always has something focused: the pause menu releases focus when it closes.
func _keep_focus() -> void:
	if get_viewport().gui_get_focus_owner() != null:
		return
	if %EndCard.visible:
		%BackToTitle.grab_focus()
	elif %Backlog.visible:
		%CloseLog.grab_focus()
	elif %Choices.visible and %Choices.get_child_count() > 0:
		%Choices.get_child(0).grab_focus()


func _is_click(event: InputEvent, button: MouseButton) -> bool:
	return event is InputEventMouseButton and event.pressed and event.button_index == button
