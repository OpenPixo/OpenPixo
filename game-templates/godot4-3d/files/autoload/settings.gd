extends Node
## Player settings: display mode, volume, language and key bindings.
## Stored per user in user://settings.cfg, never beside the game files.

const PATH := "user://settings.cfg"
## Each bus needs a SETTINGS_VOLUME_<BUS> string in i18n/strings.csv.
const VOLUME_BUSES: PackedStringArray = ["Master", "Music", "SFX"]
## Actions a player can rebind. Each needs an ACTION_<NAME> string. The pause
## action stays out, so a player can always reach the menu.
const REBINDABLE: Array[StringName] = [&"move_up", &"move_down", &"move_left", &"move_right"]
const KEYS := "keys"
const BUTTONS := "buttons"

var _config := ConfigFile.new()
var _default_events := {}


func _ready() -> void:
	for action in REBINDABLE:
		_default_events[action] = InputMap.action_get_events(action)
	# No file on a first run, and a damaged file falls back to the defaults.
	if _config.load(PATH) != OK:
		_config.clear()
	_apply_display()
	for bus in VOLUME_BUSES:
		_apply_volume(bus)
	Strings.use_language(get_language())
	for action in REBINDABLE:
		for slot in [KEYS, BUTTONS]:
			var saved: Array = _read("input", _binding_key(action, slot), [])
			var codes := saved.filter(func(code: Variant) -> bool: return code is int)
			if not codes.is_empty():
				_bind(action, slot, codes)


func is_fullscreen() -> bool:
	return _read("display", "fullscreen", false)


func set_fullscreen(fullscreen: bool) -> void:
	_config.set_value("display", "fullscreen", fullscreen)
	_apply_display()
	_save()


## Linear volume, from 0.0 (muted) to 1.0.
func get_volume(bus: String) -> float:
	return clampf(_read("audio", bus, 1.0), 0.0, 1.0)


func set_volume(bus: String, value: float) -> void:
	_config.set_value("audio", bus, value)
	_apply_volume(bus)
	_save()


## A locale from the string table, or "" to follow the system language.
func get_language() -> String:
	return _read("language", "locale", "")


func set_language(locale: String) -> void:
	_config.set_value("language", "locale", locale)
	Strings.use_language(locale)
	_save()


## KEYS for a keyboard key, BUTTONS for a gamepad button, "" for anything else.
## Gamepad sticks stay bound as they are in project.godot.
func slot_of(event: InputEvent) -> String:
	if event is InputEventKey:
		return KEYS
	if event is InputEventJoypadButton:
		return BUTTONS
	return ""


func events_in(action: StringName, slot: String) -> Array:
	return InputMap.action_get_events(action).filter(func(event: InputEvent) -> bool: return slot_of(event) == slot)


## Binds the event to the action. If another action already uses it, that action
## takes this one's old binding, so no action ends up with nothing.
func rebind(action: StringName, event: InputEvent) -> void:
	var slot := slot_of(event)
	var code := _code_of(event)
	var previous := _codes(action, slot)
	for other in REBINDABLE:
		var codes := _codes(other, slot)
		if other != action and code in codes:
			codes.erase(code)
			_store_binding(other, slot, previous if codes.is_empty() else codes)
	_store_binding(action, slot, [code])
	_save()


func reset_bindings() -> void:
	for action in REBINDABLE:
		InputMap.action_erase_events(action)
		for event: InputEvent in _default_events[action]:
			InputMap.action_add_event(action, event)
	if _config.has_section("input"):
		_config.erase_section("input")
	_save()


func _apply_display() -> void:
	# A Movie Maker capture keeps the size and window its command line asked for.
	if OS.has_feature("movie"):
		return
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if is_fullscreen() else DisplayServer.WINDOW_MODE_WINDOWED)


func _apply_volume(bus: String) -> void:
	var index := AudioServer.get_bus_index(bus)
	if index < 0:
		return
	var value := get_volume(bus)
	AudioServer.set_bus_mute(index, value <= 0.0)
	AudioServer.set_bus_volume_db(index, linear_to_db(maxf(value, 0.0001)))


func _store_binding(action: StringName, slot: String, codes: Array) -> void:
	_bind(action, slot, codes)
	_config.set_value("input", _binding_key(action, slot), codes)


func _bind(action: StringName, slot: String, codes: Array) -> void:
	for event: InputEvent in events_in(action, slot):
		InputMap.action_erase_event(action, event)
	for code: int in codes:
		InputMap.action_add_event(action, _make_event(slot, code))


func _codes(action: StringName, slot: String) -> Array:
	return events_in(action, slot).map(_code_of)


func _code_of(event: InputEvent) -> int:
	return (event as InputEventKey).physical_keycode if event is InputEventKey else (event as InputEventJoypadButton).button_index


func _make_event(slot: String, code: int) -> InputEvent:
	var event: InputEvent
	if slot == KEYS:
		event = InputEventKey.new()
		event.physical_keycode = code
	else:
		event = InputEventJoypadButton.new()
		event.button_index = code
	event.device = -1 # Any keyboard or gamepad.
	return event


func _binding_key(action: StringName, slot: String) -> String:
	return "%s.%s" % [action, slot]


func _read(section: String, key: String, default: Variant) -> Variant:
	var value: Variant = _config.get_value(section, key, default)
	return value if typeof(value) == typeof(default) else default


func _save() -> void:
	var error := _config.save(PATH)
	if error != OK:
		push_error("Cannot save %s: %s" % [PATH, error_string(error)])
