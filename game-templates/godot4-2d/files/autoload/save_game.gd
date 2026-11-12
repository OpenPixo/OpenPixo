extends Node
## The player's progress, in user://save.json. Never save under res://, which
## is read-only in an exported game.
##
## A node that has progress to keep joins the "saved" group and implements
## save_state(), which copies its state into `data`. It reads `data` back in
## _ready(). Keep values JSON-safe: numbers, strings, arrays and dictionaries.

const PATH := "user://save.json"
## Raise this when the save format changes, and migrate older data in load_game().
const VERSION := 1

var data: Dictionary = {}


func exists() -> bool:
	return FileAccess.file_exists(PATH)


func start_new() -> void:
	data = {"version": VERSION}


func load_game() -> bool:
	if not exists():
		return false
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATH))
	if not parsed is Dictionary or int(parsed.get("version", 0)) > VERSION:
		push_warning("Ignoring an unreadable save: %s" % PATH)
		return false
	data = parsed
	return true


## Collects state from the "saved" group and writes it. Writing to a temporary
## file first means a failed write cannot damage the previous save.
func save() -> bool:
	if data.is_empty():
		return false
	get_tree().call_group("saved", "save_state")
	var temporary := PATH + ".tmp"
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null:
		push_error("Cannot write %s: %s" % [temporary, error_string(FileAccess.get_open_error())])
		return false
	file.store_string(JSON.stringify(data, "\t"))
	var written := file.get_error() == OK
	file.close()
	var error := DirAccess.rename_absolute(temporary, PATH) if written else ERR_FILE_CANT_WRITE
	if error != OK:
		push_error("Cannot save %s: %s" % [PATH, error_string(error)])
	return error == OK


func _notification(what: int) -> void:
	# Closing the window saves too, not only the menu's quit buttons.
	if what == NOTIFICATION_WM_CLOSE_REQUEST:
		save()
