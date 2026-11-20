extends RefCounted
## Plays a book from game/story/parser.gd: where the story is, its variables,
## and what is on stage. It touches no nodes, so the scene (game/game.gd) draws
## what it says and checks/story_check.gd can play every path headless.
##
## step() runs commands until one needs the player and returns it: a "line",
## a "choice", a "wait" or an "end". The scene shows it, then calls next() for
## a line or a wait, or choose() for a choice.

const LOG_LIMIT := 200
const START := "start"

var book: Dictionary = {}
var label := ""
var index := 0
var variables: Dictionary = {}
## Background name, "" for none.
var background := ""
## Music name, "" for silence.
var music := ""
## Character id -> {"expression": String, "position": String}, in the order they appeared.
var cast: Dictionary = {}
## Sound effects step() reached since the scene last took them.
var pending_sounds: PackedStringArray = []
## What the player has read, as [label, index] or [label, index, option index] for a choice.
var history: Array = []
## Problems met while playing, such as a jump to a missing label.
var problems: PackedStringArray = []


func _init(story_book: Dictionary = {}) -> void:
	book = story_book


func start(from := START) -> void:
	label = from
	index = 0
	variables = {}
	background = ""
	music = ""
	cast = {}
	history = []
	pending_sounds = []


## The command the story is waiting on, running every command before it.
func step() -> Dictionary:
	# A story that only loops through jumps and conditions never reaches the player.
	for guard in 10000:
		var commands: Array = book.labels.get(label, [])
		if index >= commands.size():
			if not _fall_through():
				return {"kind": "end", "id": "", "title": ""}
			continue
		var command: Dictionary = commands[index]
		match command.kind:
			"line", "choice", "wait", "end":
				return command
			"set":
				variables[command.variable] = command.value
			"add":
				variables[command.variable] = _number(variables.get(command.variable, 0.0)) + command.amount
			"jump":
				_go(command.target)
				continue
			"if":
				if evaluate(command.condition):
					_go(command.target)
					continue
			"bg":
				background = "" if command.name == "none" else command.name
			"music":
				music = "" if command.name == "stop" else command.name
			"sfx":
				pending_sounds.append(command.name)
			"show":
				var previous: Dictionary = cast.get(command.character, {})
				cast[command.character] = {
					"expression": command.expression if command.expression else previous.get("expression", ""),
					"position": command.position if command.position else previous.get("position", "center"),
				}
			"hide":
				if command.character.is_empty():
					cast.clear()
				else:
					cast.erase(command.character)
		index += 1
	problems.append("the story at %s loops without reaching a line" % label)
	return {"kind": "end", "id": "", "title": ""}


## After a line or a wait: remember it and move on.
func next() -> Dictionary:
	var current := step()
	if current.kind == "line":
		_remember([label, index])
	if current.kind in ["line", "wait"]:
		index += 1
	return step()


## The options of the current choice the player may pick now, each with its "index" in the choice.
func options() -> Array:
	var current := step()
	if current.kind != "choice":
		return []
	var open: Array = []
	for i in current.options.size():
		var option: Dictionary = current.options[i]
		if option.condition == null or evaluate(option.condition):
			open.append({"index": i, "text": option.text, "target": option.target})
	return open


## Picks an option of the current choice by its index in the choice.
func choose(option_index: int) -> Dictionary:
	var current := step()
	if current.kind != "choice" or option_index < 0 or option_index >= current.options.size():
		return current
	_remember([label, index, option_index])
	_go(current.options[option_index].target)
	return step()


## Skips a choice that has no option open, so the story cannot get stuck.
func skip_choice() -> Dictionary:
	if step().kind == "choice":
		problems.append("a choice at %s had no option the player could pick" % label)
		index += 1
	return step()


func evaluate(condition: Variant) -> bool:
	if not condition is Array or condition.is_empty():
		return false
	match condition[0]:
		"flag":
			return _truthy(variables.get(condition[1], false))
		"not":
			return not evaluate(condition[1])
		"and":
			return condition.slice(1).all(evaluate)
		"or":
			return condition.slice(1).any(evaluate)
		"compare":
			return _compare(variables.get(condition[1], null), condition[2], condition[3])
	return false


## The command a history entry points at, or {} when the book no longer has it.
func command_at(entry: Array) -> Dictionary:
	var commands: Array = book.labels.get(entry[0], [])
	return commands[entry[1]] if entry[1] < commands.size() else {}


func to_save() -> Dictionary:
	return {
		"label": label, "index": index, "variables": variables.duplicate(true), "background": background,
		"music": music, "cast": cast.duplicate(true), "history": history.duplicate(true),
	}


## Restores a saved position. False when the save does not fit this story.
func from_save(data: Variant) -> bool:
	if not data is Dictionary or not book.labels.has(str(data.get("label", ""))):
		return false
	label = data.label
	index = int(data.get("index", 0))
	variables = data.get("variables", {}) if data.get("variables") is Dictionary else {}
	background = str(data.get("background", ""))
	music = str(data.get("music", ""))
	cast = data.get("cast", {}) if data.get("cast") is Dictionary else {}
	history = []
	for entry: Variant in data.get("history", []):
		if entry is Array and entry.size() >= 2 and book.labels.has(str(entry[0])):
			history.append([str(entry[0]), int(entry[1])] + ([int(entry[2])] if entry.size() > 2 else []))
	return true


func _go(target: String) -> void:
	if not book.labels.has(target):
		problems.append("no label \"%s\" (from %s)" % [target, label])
		label = ""
		index = 0
		return
	label = target
	index = 0


## Running off a label's last line goes on to the next label in file order.
func _fall_through() -> bool:
	var order: Array = book.order
	var at := order.find(label)
	if at < 0 or at + 1 >= order.size():
		return false
	label = order[at + 1]
	index = 0
	return true


func _remember(entry: Array) -> void:
	history.append(entry)
	if history.size() > LOG_LIMIT:
		history = history.slice(history.size() - LOG_LIMIT)


func _compare(value: Variant, operator: String, expected: Variant) -> bool:
	if expected is float:
		var number := _number(value)
		match operator:
			"==": return is_equal_approx(number, expected)
			"!=": return not is_equal_approx(number, expected)
			">=": return number >= expected
			"<=": return number <= expected
			">": return number > expected
			"<": return number < expected
	var left: Variant = value if value != null else ("" if expected is String else false)
	match operator:
		"==": return typeof(left) == typeof(expected) and left == expected
		"!=": return typeof(left) != typeof(expected) or left != expected
	return false


func _truthy(value: Variant) -> bool:
	match typeof(value):
		TYPE_NIL:
			return false
		TYPE_BOOL:
			return value
		TYPE_INT, TYPE_FLOAT:
			return value != 0
		TYPE_STRING:
			return not value.is_empty()
	return true


func _number(value: Variant) -> float:
	if value is float or value is int:
		return float(value)
	if value is bool:
		return 1.0 if value else 0.0
	return 0.0
