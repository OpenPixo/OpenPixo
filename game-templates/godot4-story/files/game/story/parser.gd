extends RefCounted
## Turns .story text into commands. It touches no nodes and no autoloads, so
## checks/story_check.gd can use it from a headless --script run. README.md
## describes the format.
##
## The result of parsing is a "book": {"labels": {name: [command, ...]},
## "order": [label names in file order], "errors": ["file:line: problem", ...]}.
## Every command is a Dictionary with "kind", "file" and "line".

const POSITIONS: PackedStringArray = ["left", "center", "right"]
const COMMANDS: PackedStringArray = ["bg", "show", "hide", "music", "sfx", "wait", "set", "add", "jump", "if", "end"]
## Keys that hold text a translation changes. Everything else must match in every language.
const TEXT_KEYS: PackedStringArray = ["text", "prompt", "title", "file", "line"]


static func empty_book() -> Dictionary:
	return {"labels": {}, "order": [], "errors": []}


## Adds one file's labels to `book`. Labels are shared across all files of a language.
static func parse_into(book: Dictionary, text: String, file: String) -> void:
	var labels: Dictionary = book.labels
	var errors: Array = book.errors
	var identifier := _regex("^[A-Za-z_][A-Za-z0-9_]*$")
	var speaker := _regex("^([a-z_][a-z0-9_]*):\\s*(.*)$")
	var label := ""
	var choice: Dictionary = {}
	var lines := text.split("\n")
	for i in lines.size():
		var raw := lines[i].strip_edges()
		var number := i + 1
		var where := "%s:%d" % [file, number]
		if raw.is_empty() or raw.begins_with("#"):
			continue
		if raw == "-" or raw.begins_with("- "):
			if label.is_empty():
				errors.append("%s: a choice is outside a label; start the file with a line like \"== start\"" % where)
				continue
			if choice.is_empty():
				choice = _command("choice", file, number)
				choice.prompt = ""
				choice.options = []
				labels[label].append(choice)
			var option := _parse_option(raw.substr(1).strip_edges(), where, errors, identifier)
			if not option.is_empty():
				choice.options.append(option)
			continue
		choice = {}
		if raw.begins_with("=="):
			var name := raw.trim_prefix("==").trim_suffix("==").strip_edges()
			if identifier.search(name) == null:
				errors.append("%s: \"%s\" is not a label name; use letters, digits and _" % [where, name])
				label = ""
			elif labels.has(name):
				errors.append("%s: label \"%s\" is already defined" % [where, name])
				label = ""
			else:
				labels[name] = []
				book.order.append(name)
				label = name
			continue
		if label.is_empty():
			errors.append("%s: this line is outside a label; start the file with a line like \"== start\"" % where)
			continue
		var commands: Array = labels[label]
		if raw.begins_with("?"):
			choice = _command("choice", file, number)
			choice.prompt = raw.substr(1).strip_edges()
			choice.options = []
			commands.append(choice)
			continue
		if raw.begins_with("@"):
			var command := _parse_command(raw.substr(1).strip_edges(), file, number, errors, identifier)
			if not command.is_empty():
				commands.append(command)
			continue
		var line := _command("line", file, number)
		line.speaker = ""
		line.text = raw
		if raw.begins_with(":"):
			line.text = raw.substr(1).strip_edges()
		else:
			var found := speaker.search(raw)
			if found:
				line.speaker = found.get_string(1)
				line.text = found.get_string(2).strip_edges()
		if line.text.is_empty():
			errors.append("%s: this line has no text" % where)
			continue
		commands.append(line)
	for name: String in labels:
		for command: Dictionary in labels[name]:
			if command.kind == "choice" and command.options.is_empty():
				errors.append("%s:%d: a choice needs at least one \"- text -> label\" line" % [command.file, command.line])


## The part of a command a translation must keep: everything except its text.
static func shape(command: Dictionary) -> String:
	var copy := command.duplicate(true)
	for key in TEXT_KEYS:
		copy.erase(key)
	if copy.has("options"):
		for option: Dictionary in copy.options:
			option.erase("text")
	return var_to_str(copy)


static func parse_condition(text: String, where: String, errors: Array) -> Variant:
	text = text.strip_edges()
	if text.is_empty():
		errors.append("%s: the condition is empty" % where)
		return null
	for joiner in ["or", "and"]:
		var parts := _split_word(text, joiner)
		if parts.size() > 1:
			var node: Array = [joiner]
			for part in parts:
				var child: Variant = parse_condition(part, where, errors)
				if child == null:
					return null
				node.append(child)
			return node
	if text.begins_with("not "):
		var inner: Variant = parse_condition(text.substr(4), where, errors)
		return null if inner == null else ["not", inner]
	var compare := _regex("^([A-Za-z_][A-Za-z0-9_]*)\\s*(==|!=|>=|<=|>|<)\\s*(.+)$").search(text)
	if compare:
		return ["compare", compare.get_string(1), compare.get_string(2), parse_value(compare.get_string(3))]
	if _regex("^[A-Za-z_][A-Za-z0-9_]*$").search(text):
		return ["flag", text]
	errors.append("%s: cannot read the condition \"%s\"; write it like \"trust >= 2\", \"met_ren\" or \"not met_ren\"" % [where, text])
	return null


## true and false, numbers, "quoted text", or a bare word as text.
static func parse_value(text: String) -> Variant:
	text = text.strip_edges()
	if text == "true":
		return true
	if text == "false":
		return false
	if text.is_valid_float():
		return text.to_float()
	if text.length() >= 2 and text.begins_with("\"") and text.ends_with("\""):
		return text.substr(1, text.length() - 2)
	return text


## Variable names a condition reads.
static func condition_variables(condition: Variant) -> PackedStringArray:
	var names: PackedStringArray = []
	if condition is Array:
		match condition[0]:
			"flag":
				names.append(condition[1])
			"compare":
				names.append(condition[1])
			_:
				for child: Variant in condition.slice(1):
					names.append_array(condition_variables(child))
	return names


static func _parse_option(body: String, where: String, errors: Array, identifier: RegEx) -> Dictionary:
	var arrow := body.rfind("->")
	if arrow < 0:
		errors.append("%s: write a choice as \"- what the player picks -> label\"" % where)
		return {}
	var option := {"text": body.substr(0, arrow).strip_edges(), "condition": null}
	var rest := body.substr(arrow + 2).strip_edges()
	var guard := rest.find(" if ")
	option.target = rest if guard < 0 else rest.substr(0, guard).strip_edges()
	if guard >= 0:
		option.condition = parse_condition(rest.substr(guard + 4), where, errors)
	if option.text.is_empty():
		errors.append("%s: the choice has no text before ->" % where)
		return {}
	if identifier.search(option.target) == null:
		errors.append("%s: \"%s\" is not a label name" % [where, option.target])
		return {}
	return option


static func _parse_command(body: String, file: String, number: int, errors: Array, identifier: RegEx) -> Dictionary:
	var where := "%s:%d" % [file, number]
	var words := body.split(" ", false)
	var name := words[0] if words.size() > 0 else ""
	var args := words.slice(1)
	var rest := body.substr(name.length()).strip_edges()
	var command := _command(name, file, number)
	match name:
		"bg", "music", "sfx":
			if args.size() != 1:
				errors.append("%s: @%s takes one name, like \"@%s %s\"" % [where, name, name, {"bg": "classroom", "music": "rain", "sfx": "door"}[name]])
				return {}
			command.name = args[0]
		"show":
			if args.is_empty():
				errors.append("%s: @show needs a character, like \"@show ren happy left\"" % where)
				return {}
			command.character = args[0]
			command.expression = ""
			command.position = ""
			for word in args.slice(1):
				if word in POSITIONS:
					command.position = word
				elif command.expression.is_empty():
					command.expression = word
				else:
					errors.append("%s: @show takes a character, an expression and one of left, center, right" % where)
					return {}
		"hide":
			if args.size() > 1:
				errors.append("%s: @hide takes one character, or nothing to hide everyone" % where)
				return {}
			command.character = args[0] if args.size() == 1 else ""
		"wait":
			if args.size() != 1 or not args[0].is_valid_float() or args[0].to_float() <= 0.0:
				errors.append("%s: @wait takes seconds, like \"@wait 0.5\"" % where)
				return {}
			command.seconds = args[0].to_float()
		"set":
			var assignment := _regex("^([A-Za-z_][A-Za-z0-9_]*)\\s*(?:=\\s*|\\s+)(.+)$").search(rest)
			if assignment == null:
				errors.append("%s: write @set like \"@set met_ren = true\"" % where)
				return {}
			command.variable = assignment.get_string(1)
			command.value = parse_value(assignment.get_string(2))
		"add":
			if args.size() != 2 or identifier.search(args[0]) == null or not args[1].is_valid_float():
				errors.append("%s: write @add like \"@add trust 1\" or \"@add trust -1\"" % where)
				return {}
			command.variable = args[0]
			command.amount = args[1].to_float()
		"jump":
			if args.size() != 1 or identifier.search(args[0]) == null:
				errors.append("%s: @jump takes one label, like \"@jump ending\"" % where)
				return {}
			command.target = args[0]
		"if":
			var arrow := rest.rfind("->")
			var target := rest.substr(arrow + 2).strip_edges() if arrow >= 0 else ""
			if arrow < 0 or identifier.search(target) == null:
				errors.append("%s: write @if like \"@if trust >= 2 -> good_end\"" % where)
				return {}
			command.condition = parse_condition(rest.substr(0, arrow), where, errors)
			if command.condition == null:
				return {}
			command.target = target
		"end":
			var ending := _regex("^([A-Za-z_][A-Za-z0-9_]*)?\\s*(.*)$").search(rest)
			command.id = ending.get_string(1)
			command.title = ending.get_string(2).strip_edges()
		_:
			errors.append("%s: unknown command @%s; the commands are @%s" % [where, name, ", @".join(COMMANDS)])
			return {}
	return command


static func _command(kind: String, file: String, number: int) -> Dictionary:
	return {"kind": kind, "file": file, "line": number}


static func _split_word(text: String, word: String) -> PackedStringArray:
	return text.split(" %s " % word, false)


static func _regex(pattern: String) -> RegEx:
	var regex := RegEx.new()
	regex.compile(pattern)
	return regex
