extends Node
## Loads every player-facing string from res://i18n/strings.csv into Godot's
## translation system. A scene sets a control's text to a key ("MENU_NEW_GAME")
## and Godot translates it; a script calls tr("MENU_NEW_GAME"). To add a
## language, add a column to the table. It appears in Settings on its own.

const TABLE := "res://i18n/strings.csv"
const NAME_KEY := "LANGUAGE_NAME"

## Locale codes in table order, such as "en" and "zh_CN".
var locales: PackedStringArray = []
var _names := {}


func _enter_tree() -> void:
	var file := FileAccess.open(TABLE, FileAccess.READ)
	if file == null:
		push_error("Cannot read %s: %s" % [TABLE, error_string(FileAccess.get_open_error())])
		return
	var header := file.get_csv_line()
	var translations: Array[Translation] = []
	for column in range(1, header.size()):
		var translation := Translation.new()
		translation.locale = header[column].strip_edges()
		translations.append(translation)
		locales.append(translation.locale)
	while not file.eof_reached():
		var row := file.get_csv_line()
		var key := row[0].strip_edges()
		if key.is_empty():
			continue
		for column in range(1, mini(row.size(), header.size())):
			if not row[column].is_empty():
				translations[column - 1].add_message(key, row[column])
	for translation in translations:
		_names[translation.locale] = translation.get_message(NAME_KEY)
		TranslationServer.add_translation(translation)


func language_name(locale: String) -> String:
	return str(_names.get(locale, locale))


## An empty locale, or one the table does not have, follows the system language.
func use_language(locale: String) -> void:
	TranslationServer.set_locale(locale if locale in locales else OS.get_locale())
