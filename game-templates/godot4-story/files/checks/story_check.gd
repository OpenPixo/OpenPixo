extends SceneTree
## Checks the whole story without opening a window. Run it after every story edit:
##
##     godot --headless --path . --script checks/story_check.gd
##
## (After a fresh copy, run `godot --headless --path . --import --quit` once first.)
## It prints each problem with its file and line and exits 1, or prints
## "STORY CHECK passed" and exits 0. It checks, for every language under story/:
## the text parses; a "start" label exists; every jump, condition and choice
## leads to a label; speakers and @show name a character in characters.json;
## conditions read only variables something sets; every label can be reached;
## and every language has the same labels and commands as the first one. Then it
## plays every choice to prove that no choice can leave the player with nothing
## to pick and that every ending can be reached. Missing art and sound are notes,
## not problems: the game draws placeholders until they exist.

const Library := preload("res://game/story/library.gd")
const Parser := preload("res://game/story/parser.gd")
const Runner := preload("res://game/story/runner.gd")

## Playthrough states to try before giving up on proving every ending.
const MAX_STATES := 50000

var _problems: PackedStringArray = []
var _notes: PackedStringArray = []


func _initialize() -> void:
	var characters := Library.load_characters()
	var languages := Library.languages()
	if languages.is_empty():
		_problems.append("res://story has no language folder, such as story/en")
	var first := {}
	var first_language := ""
	for language in languages:
		var book := Library.load_book(language)
		_problems.append_array(book.errors)
		if not book.errors.is_empty():
			continue
		_check_book(book, characters)
		if first.is_empty():
			first = book
			first_language = language
		else:
			_compare(first_language, first, language, book)
	var states := 0
	var endings := 0
	if not first.is_empty() and _problems.is_empty():
		endings = _ending_ids(first).size()
		states = _play_everything(first)
		_note_missing_files(first)
	for note in _notes:
		print("note: ", note)
	if _problems.is_empty():
		print("STORY CHECK passed: %d language(s) %s, %d label(s), %d ending(s), %d playthrough state(s) tried" % [
			languages.size(), ", ".join(languages), first.get("order", []).size(), endings, states])
		quit(0)
		return
	for problem in _problems:
		printerr("problem: ", problem)
	printerr("STORY CHECK failed: %d problem(s)" % _problems.size())
	quit(1)


func _check_book(book: Dictionary, characters: Dictionary) -> void:
	var labels: Dictionary = book.labels
	if not labels.has(Runner.START):
		_problems.append("%s: there is no \"== %s\" label; the story begins there" % [_first_file(book), Runner.START])
	var set_variables := {}
	var read: Array = []
	for label: String in book.order:
		for command: Dictionary in labels[label]:
			var where := "%s:%d" % [command.file, command.line]
			for target in _targets(command):
				if not labels.has(target):
					_problems.append("%s: there is no label \"%s\"" % [where, target])
			var character: String = command.get("speaker", command.get("character", ""))
			if not character.is_empty() and not characters.has(character):
				_problems.append("%s: no character \"%s\" in story/characters.json" % [where, character])
			if command.kind in ["set", "add"]:
				set_variables[command.variable] = true
			if command.kind == "if":
				read.append([where, command.condition])
			for option: Dictionary in command.get("options", []):
				if option.condition != null:
					read.append([where, option.condition])
	for item: Array in read:
		for variable in Parser.condition_variables(item[1]):
			if not set_variables.has(variable):
				_problems.append("%s: the condition reads \"%s\", but no @set or @add sets it" % [item[0], variable])
	if labels.has(Runner.START):
		var reached := {Runner.START: true}
		var queue: Array = [Runner.START]
		while not queue.is_empty():
			var label: String = queue.pop_back()
			for next in _exits(book, label):
				if labels.has(next) and not reached.has(next):
					reached[next] = true
					queue.append(next)
		for label: String in book.order:
			if not reached.has(label):
				var commands: Array = labels[label]
				var line: int = commands[0].line - 1 if commands.size() > 0 else 0
				_problems.append("%s: the label \"%s\" is never reached from \"%s\"" % [_label_file(book, label, line), label, Runner.START])


## A translation keeps every label and command and changes only the text.
func _compare(first_language: String, first: Dictionary, language: String, book: Dictionary) -> void:
	for label: String in first.order:
		if not book.labels.has(label):
			_problems.append("story/%s has no label \"%s\", which story/%s has" % [language, label, first_language])
	for label: String in book.order:
		if not first.labels.has(label):
			_problems.append("story/%s has the label \"%s\", which story/%s does not" % [language, label, first_language])
			continue
		var expected: Array = first.labels[label]
		var found: Array = book.labels[label]
		for i in maxi(expected.size(), found.size()):
			if i >= found.size():
				_problems.append("%s:%d: story/%s goes on with %s here" % [expected[i].file, expected[i].line, language, _describe(expected[i])])
				break
			if i >= expected.size():
				_problems.append("%s:%d: %s is not in story/%s" % [found[i].file, found[i].line, _describe(found[i]), first_language])
				break
			if Parser.shape(expected[i]) != Parser.shape(found[i]):
				_problems.append("%s:%d: %s, but %s:%d has %s; only the text may differ between languages" % [
					found[i].file, found[i].line, _describe(found[i]), expected[i].file, expected[i].line, _describe(expected[i])])
				break


## Plays every option of every choice. Returns how many states it tried.
func _play_everything(book: Dictionary) -> int:
	var seen := {}
	var reached := {}
	var stuck := {}
	var start := Runner.new(book)
	start.start()
	var stack: Array = [start.to_save()]
	while not stack.is_empty() and seen.size() < MAX_STATES:
		var runner := Runner.new(book)
		runner.from_save(stack.pop_back())
		var current := runner.step()
		var key := "%s|%d|%s" % [runner.label, runner.index, var_to_str(runner.variables)]
		if seen.has(key):
			continue
		seen[key] = true
		for problem in runner.problems:
			if not problem in _problems:
				_problems.append(problem)
		match current.kind:
			"line", "wait":
				runner.next()
				stack.append(runner.to_save())
			"choice":
				var open := runner.options()
				if open.is_empty():
					stuck["%s:%d" % [current.file, current.line]] = true
				for option: Dictionary in open:
					var branch := Runner.new(book)
					branch.from_save(runner.to_save())
					branch.choose(option.index)
					stack.append(branch.to_save())
			"end":
				reached[current.id] = true
	for where: String in stuck:
		_problems.append("%s: in some playthrough none of this choice's options can be picked" % where)
	if not stack.is_empty():
		_notes.append("stopped after %d playthrough states, so not every ending was proven reachable" % MAX_STATES)
		return seen.size()
	for id in _ending_ids(book):
		if not reached.has(id):
			_problems.append("%s: the ending \"%s\" can never be reached" % [_ending_where(book, id), id])
	return seen.size()


func _note_missing_files(book: Dictionary) -> void:
	var noted := {}
	for label: String in book.order:
		for command: Dictionary in book.labels[label]:
			var note := ""
			match command.kind:
				"bg":
					if command.name != "none" and not Library.background_path(command.name):
						note = "no picture for the background \"%s\": add %s/%s.png" % [command.name, Library.BACKGROUNDS, command.name]
				"show":
					if not Library.portrait_path(command.character, command.expression):
						note = "no picture for \"%s\": add %s/%s.png%s" % [command.character, Library.PORTRAITS, command.character,
							" or %s_%s.png" % [command.character, command.expression] if command.expression else ""]
				"music":
					if command.name != "stop" and not Library.music_path(command.name):
						note = "no music \"%s\": add %s/%s.ogg" % [command.name, Library.MUSIC, command.name]
				"sfx":
					if not Library.sound_path(command.name):
						note = "no sound \"%s\": add %s/%s.ogg" % [command.name, Library.SOUNDS, command.name]
			if note and not noted.has(note):
				noted[note] = true
				_notes.append(note)


## Labels a label can lead to, including the next label when it runs off its end.
func _exits(book: Dictionary, label: String) -> Array:
	var commands: Array = book.labels[label]
	var exits: Array = []
	for command: Dictionary in commands:
		exits.append_array(_targets(command))
	var last: Dictionary = commands.back() if commands.size() > 0 else {}
	if not (last.get("kind") in ["jump", "end", "choice"]):
		var at: int = book.order.find(label)
		if at + 1 < book.order.size():
			exits.append(book.order[at + 1])
	return exits


func _targets(command: Dictionary) -> Array:
	match command.kind:
		"jump", "if":
			return [command.target]
		"choice":
			return command.options.map(func(option: Dictionary) -> String: return option.target)
	return []


func _ending_ids(book: Dictionary) -> Array:
	var ids: Array = []
	for label: String in book.order:
		for command: Dictionary in book.labels[label]:
			if command.kind == "end" and command.id and not command.id in ids:
				ids.append(command.id)
	return ids


func _ending_where(book: Dictionary, id: String) -> String:
	for label: String in book.order:
		for command: Dictionary in book.labels[label]:
			if command.kind == "end" and command.id == id:
				return "%s:%d" % [command.file, command.line]
	return "story"


func _describe(command: Dictionary) -> String:
	match command.kind:
		"line":
			return "a line by %s" % command.speaker if command.speaker else "a narration line"
		"choice":
			return "a choice leading to %s" % ", ".join(_targets(command))
	var words: PackedStringArray = ["@" + command.kind]
	for key in ["name", "character", "expression", "position", "seconds", "variable", "value", "amount", "target", "id"]:
		if command.has(key) and str(command[key]) != "":
			words.append(str(command[key]))
	return "\"%s\"" % " ".join(words)


func _first_file(book: Dictionary) -> String:
	for label: String in book.order:
		if book.labels[label].size() > 0:
			return book.labels[label][0].file
	return "story"


func _label_file(book: Dictionary, label: String, line: int) -> String:
	var commands: Array = book.labels[label]
	return "%s:%d" % [commands[0].file, line] if commands.size() > 0 else "label \"%s\"" % label
