extends Control
## The settings screen, opened from the title screen and the pause menu. Every
## row works with a mouse, a keyboard or a gamepad alone.

signal closed

## Printed on the buttons of most gamepads, so these names are not translated.
const BUTTON_NAMES := {
	JOY_BUTTON_A: "A", JOY_BUTTON_B: "B", JOY_BUTTON_X: "X", JOY_BUTTON_Y: "Y",
	JOY_BUTTON_BACK: "Back", JOY_BUTTON_START: "Start",
	JOY_BUTTON_LEFT_STICK: "L3", JOY_BUTTON_RIGHT_STICK: "R3",
	JOY_BUTTON_LEFT_SHOULDER: "LB", JOY_BUTTON_RIGHT_SHOULDER: "RB",
	JOY_BUTTON_DPAD_UP: "D-pad ↑", JOY_BUTTON_DPAD_DOWN: "D-pad ↓",
	JOY_BUTTON_DPAD_LEFT: "D-pad ←", JOY_BUTTON_DPAD_RIGHT: "D-pad →",
}

var _binding_buttons: Array[Button] = []
var _listening: Button


func _ready() -> void:
	_build_display_mode()
	_build_language()
	_build_volume_rows()
	_build_binding_rows()
	%Back.pressed.connect(_close)
	%ResetControls.pressed.connect(_reset_controls)
	%DisplayMode.grab_focus()


func _input(event: InputEvent) -> void:
	if _listening == null or event is InputEventMouseMotion:
		return
	get_viewport().set_input_as_handled()
	if event is InputEventMouseButton:
		_stop_listening()
	elif event.is_pressed() and not event.is_echo():
		if event.is_action("pause"):
			_stop_listening()
		elif Settings.slot_of(event) == _listening.get_meta("slot"):
			Settings.rebind(_listening.get_meta("action"), event)
			_stop_listening()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel") or event.is_action_pressed("pause"):
		get_viewport().set_input_as_handled()
		_close()


func _build_display_mode() -> void:
	%DisplayMode.add_item("SETTINGS_WINDOWED")
	%DisplayMode.add_item("SETTINGS_FULLSCREEN")
	%DisplayMode.select(1 if Settings.is_fullscreen() else 0)
	%DisplayMode.item_selected.connect(func(index: int) -> void: Settings.set_fullscreen(index == 1))


func _build_language() -> void:
	%Language.add_item("SETTINGS_LANGUAGE_SYSTEM")
	for locale in Strings.locales:
		%Language.add_item(Strings.language_name(locale))
	var current: int = Strings.locales.find(Settings.get_language())
	%Language.select(current + 1)
	%Language.item_selected.connect(func(index: int) -> void:
		Settings.set_language("" if index == 0 else Strings.locales[index - 1]))


func _build_volume_rows() -> void:
	for bus in Settings.VOLUME_BUSES:
		var label := Label.new()
		label.text = "SETTINGS_VOLUME_%s" % bus.to_upper()
		var slider := HSlider.new()
		slider.max_value = 1.0
		slider.step = 0.05
		slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		slider.value = Settings.get_volume(bus)
		slider.value_changed.connect(func(value: float) -> void: Settings.set_volume(bus, value))
		%General.add_child(label)
		%General.add_child(slider)


func _build_binding_rows() -> void:
	for action in Settings.REBINDABLE:
		var label := Label.new()
		label.text = "ACTION_%s" % String(action).to_upper()
		%Controls.add_child(label)
		for slot in [Settings.KEYS, Settings.BUTTONS]:
			var button := Button.new()
			button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			button.set_meta("action", action)
			button.set_meta("slot", slot)
			button.pressed.connect(_listen.bind(button))
			%Controls.add_child(button)
			_binding_buttons.append(button)
	_refresh_bindings()


func _refresh_bindings() -> void:
	for button in _binding_buttons:
		var names: PackedStringArray = []
		for event: InputEvent in Settings.events_in(button.get_meta("action"), button.get_meta("slot")):
			names.append(_event_name(event))
		button.text = ", ".join(names)


func _event_name(event: InputEvent) -> String:
	if event is InputEventKey:
		# Name the key as printed on the player's keyboard layout. Only a real window knows it.
		if DisplayServer.get_name() == "headless":
			return event.as_text_physical_keycode()
		return OS.get_keycode_string(DisplayServer.keyboard_get_keycode_from_physical(event.physical_keycode))
	return BUTTON_NAMES.get(event.button_index, str(event.button_index))


func _listen(button: Button) -> void:
	_listening = button
	button.text = "SETTINGS_PRESS_KEY" if button.get_meta("slot") == Settings.KEYS else "SETTINGS_PRESS_BUTTON"


func _stop_listening() -> void:
	_listening = null
	_refresh_bindings()


func _reset_controls() -> void:
	Settings.reset_bindings()
	_refresh_bindings()


func _close() -> void:
	closed.emit()
	queue_free()
