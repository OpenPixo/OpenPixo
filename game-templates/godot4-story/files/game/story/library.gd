extends RefCounted
## Finds the story's files: one folder per language under res://story, the
## cast in res://story/characters.json, and art and sound by name. It names no
## autoload, so checks/story_check.gd can use it headless.

const Parser := preload("res://game/story/parser.gd")

const ROOT := "res://story"
const CHARACTERS := "res://story/characters.json"
const BACKGROUNDS := "res://art/backgrounds"
const PORTRAITS := "res://art/characters"
const MUSIC := "res://audio/music"
const SOUNDS := "res://audio/sfx"
const IMAGE_TYPES: PackedStringArray = ["png", "webp", "jpg"]
const AUDIO_TYPES: PackedStringArray = ["ogg", "mp3", "wav"]


## Language folders under res://story, such as "en" and "zh_CN", sorted.
static func languages() -> PackedStringArray:
	var found := DirAccess.get_directories_at(ROOT)
	found.sort()
	return found


## The folder to read for a locale: the same locale, the same language, English, then the first.
static func pick_language(locale: String) -> String:
	var available := languages()
	if locale in available:
		return locale
	var base := locale.get_slice("_", 0)
	for language in available:
		if language.get_slice("_", 0) == base:
			return language
	if "en" in available:
		return "en"
	return available[0] if available.size() > 0 else ""


## Every .story file of one language, read in file-name order, as one book.
static func load_book(language: String) -> Dictionary:
	var book := Parser.empty_book()
	var folder := ROOT.path_join(language)
	var files := DirAccess.get_files_at(folder)
	files.sort()
	for file in files:
		if file.get_extension() != "story":
			continue
		var path := folder.path_join(file)
		var text := FileAccess.get_file_as_string(path)
		if text.is_empty() and FileAccess.get_open_error() != OK:
			book.errors.append("%s: cannot read the file: %s" % [path, error_string(FileAccess.get_open_error())])
			continue
		Parser.parse_into(book, text, path)
	if book.order.is_empty():
		book.errors.append("%s: no .story file with a label in it" % folder)
	return book


## {id: {"name": {locale: text}, "color": "#rrggbb"}}, or {} with a pushed error.
static func load_characters() -> Dictionary:
	if not FileAccess.file_exists(CHARACTERS):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(CHARACTERS))
	if not parsed is Dictionary:
		push_error("%s is not a JSON object" % CHARACTERS)
		return {}
	return parsed


## The character's name in a language, falling back to their first name listed, then the id.
static func character_name(characters: Dictionary, id: String, language: String) -> String:
	var names: Variant = characters.get(id, {}).get("name", {})
	if names is String:
		return names
	if names is Dictionary and not names.is_empty():
		return str(names.get(language, names.values()[0]))
	return id


static func character_color(characters: Dictionary, id: String) -> Color:
	var value: Variant = characters.get(id, {}).get("color", "")
	return Color.from_string(str(value), Color(0.82, 0.86, 0.94))


static func background_path(name: String) -> String:
	return _first(BACKGROUNDS.path_join(name), IMAGE_TYPES)


## The picture for a character's expression, or their plain picture when it has none.
static func portrait_path(character: String, expression: String) -> String:
	var exact := _first(PORTRAITS.path_join("%s_%s" % [character, expression]), IMAGE_TYPES) if expression else ""
	return exact if exact else _first(PORTRAITS.path_join(character), IMAGE_TYPES)


static func music_path(name: String) -> String:
	return _first(MUSIC.path_join(name), AUDIO_TYPES)


static func sound_path(name: String) -> String:
	return _first(SOUNDS.path_join(name), AUDIO_TYPES)


static func _first(stem: String, types: PackedStringArray) -> String:
	for type in types:
		var path := "%s.%s" % [stem, type]
		if ResourceLoader.exists(path):
			return path
	return ""
