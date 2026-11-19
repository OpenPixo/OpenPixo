extends Control
## Draws the background and the characters on stage. A picture comes from
## res://art by name (game/story/library.gd); until one exists, a background is
## a soft gradient and a character a coloured silhouette, so a story plays
## before any art is made. Debug builds label each placeholder with its name.

const Library := preload("res://game/story/library.gd")

## Horizontal centre of each stage position, as a share of the width.
const POSITIONS := {"left": 0.24, "center": 0.5, "right": 0.76}
## A character picture's height as a share of the screen height.
const PORTRAIT_HEIGHT := 0.92
## How a character who is not speaking is tinted.
const DIMMED := Color(0.55, 0.57, 0.65)

var _background_name := ""
var _background: Texture2D
var _cast: Dictionary = {}
var _portraits: Dictionary = {}
var _characters: Dictionary = {}
var _language := ""
var _speaker := ""


## `speaker` is the character talking now; the others are drawn dimmer. "" lights everyone.
func show_stage(background: String, cast: Dictionary, characters: Dictionary, language: String, speaker := "") -> void:
	if background != _background_name or _background == null:
		_background_name = background
		_background = _load_background(background)
	_cast = cast.duplicate(true)
	_characters = characters
	_language = language
	_speaker = speaker if cast.has(speaker) else ""
	for id: String in _cast:
		var key := "%s_%s" % [id, _cast[id].expression]
		if not _portraits.has(key):
			var path := Library.portrait_path(id, _cast[id].expression)
			_portraits[key] = load(path) if path else null
	queue_redraw()


func _draw() -> void:
	var area := Rect2(Vector2.ZERO, size)
	if _background is GradientTexture2D:
		draw_texture_rect(_background, area, false)
	elif _background:
		draw_texture_rect_region(_background, area, _cover(_background.get_size(), area.size))
	if _background is GradientTexture2D and OS.is_debug_build() and _background_name:
		_label(Vector2(24, 40), "bg: %s" % _background_name, Color(1, 1, 1, 0.4))
	for id: String in _cast:
		_draw_character(id, _cast[id])


func _draw_character(id: String, on_stage: Dictionary) -> void:
	var centre_x: float = size.x * POSITIONS.get(on_stage.position, 0.5)
	var lit := _speaker.is_empty() or _speaker == id
	var texture: Texture2D = _portraits.get("%s_%s" % [id, on_stage.expression])
	if texture:
		var height := size.y * PORTRAIT_HEIGHT
		var width := height * texture.get_width() / texture.get_height()
		draw_texture_rect(texture, Rect2(centre_x - width / 2, size.y - height, width, height), false, Color.WHITE if lit else DIMMED)
		return
	# A silhouette, head and shoulders in the character's colour, lit from above.
	var colour := Library.character_color(_characters, id)
	if not lit:
		colour = colour * DIMMED
	var radius := size.y * 0.075
	var head := Vector2(centre_x, size.y * 0.42)
	var shoulders := head.y + radius * 1.55
	var half := radius * 2.1
	var body := PackedVector2Array()
	var shades := PackedColorArray()
	for step in 17:
		var angle := PI + PI * step / 16.0
		body.append(Vector2(centre_x + cos(angle) * half, shoulders + sin(angle) * radius * 0.9))
		shades.append(colour.lightened(0.08))
	body.append(Vector2(centre_x + half * 1.12, size.y))
	body.append(Vector2(centre_x - half * 1.12, size.y))
	shades.append(colour.darkened(0.55))
	shades.append(colour.darkened(0.55))
	draw_polygon(body, shades)
	draw_circle(head, radius + 3.0, colour.darkened(0.4))
	draw_circle(head, radius, colour.lightened(0.05))
	if OS.is_debug_build():
		var display_name := Library.character_name(_characters, id, _language)
		var expression: String = on_stage.expression if on_stage.expression else "neutral"
		_label(Vector2(centre_x - half, head.y - radius - 14), "%s · %s" % [display_name, expression], Color(1, 1, 1, 0.5 if lit else 0.3))


func _load_background(background: String) -> Texture2D:
	var path := Library.background_path(background) if background else ""
	if path:
		return load(path)
	var gradient := Gradient.new()
	var seed_value := hash(background) if background else 0
	var hue := fposmod(float(seed_value % 1000) / 1000.0, 1.0)
	gradient.set_color(0, Color.from_hsv(hue, 0.35, 0.34 if background else 0.08))
	gradient.set_color(1, Color.from_hsv(fposmod(hue + 0.08, 1.0), 0.45, 0.14 if background else 0.04))
	var texture := GradientTexture2D.new()
	texture.gradient = gradient
	texture.fill_from = Vector2(0.5, 0.0)
	texture.fill_to = Vector2(0.5, 1.0)
	return texture


## The part of a picture that covers the screen without stretching it.
func _cover(picture: Vector2, screen: Vector2) -> Rect2:
	var factor := maxf(screen.x / picture.x, screen.y / picture.y)
	var shown := screen / factor
	return Rect2((picture - shown) / 2, shown)


func _label(at: Vector2, text: String, colour: Color) -> void:
	draw_string(get_theme_default_font(), at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, colour)
