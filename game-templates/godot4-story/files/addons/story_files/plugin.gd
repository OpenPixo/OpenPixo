@tool
extends EditorPlugin
## Godot exports only files it knows as resources, so the .story files under
## res://story would be missing from an exported game (characters.json is a
## resource and is exported anyway). This adds them to every export preset. It
## is enabled in project.godot under [editor_plugins].

var _export := StoryExport.new()


func _enter_tree() -> void:
	add_export_plugin(_export)


func _exit_tree() -> void:
	remove_export_plugin(_export)


class StoryExport extends EditorExportPlugin:
	const ROOT := "res://story"

	func _get_name() -> String:
		return "StoryFiles"

	func _export_begin(_features: PackedStringArray, _is_debug: bool, _path: String, _flags: int) -> void:
		_add_folder(ROOT)

	func _add_folder(folder: String) -> void:
		for file in DirAccess.get_files_at(folder):
			if file.get_extension() == "story":
				var path := folder.path_join(file)
				add_file(path, FileAccess.get_file_as_bytes(path), false)
		for child in DirAccess.get_directories_at(folder):
			_add_folder(folder.path_join(child))
