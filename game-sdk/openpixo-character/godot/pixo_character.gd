# SPDX-License-Identifier: Apache-2.0
# Plays a character whose gear can be changed: one flat picture per part and ready-made corner positions per frame. Godot 4.
class_name PixoCharacter extends Node2D

## The moment a blow lands.
signal hit
## A motion that does not repeat is over.
signal finished(motion: String)

## Which group of `wear` an armour layer belongs to.
const LAYERS := { "head+": "head", "torso+": "body", "armN+": "arm", "armF+": "arm", "legN+": "leg", "legF+": "leg", "weapon": "weapon", "cape": "cape" }
## Seconds a new motion takes to blend in.
const BLEND := 0.09
const STEPS := 8.0

var data: Dictionary
## What it wears, by slot: head, body, arm, leg, weapon, cape. `data.items` lists what there is. Change it with put_on and take_off.
var wear := {}
var motion := "idle"
var time := 0.0
var speed := 1.0

var _pictures := {}
var _positions := {}
var _indices := {}
var _colours := {}
var _uv := {}
var _last := {}
var _from := {}
var _since := 9.0
var _told_hit := false
var _told_end := false

## Reads a package, such as "res://characters/mail-carrier". False when there is none.
func open(dir: String) -> bool:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir + "/hero.json"))
	if not parsed is Dictionary or parsed.get("format") != "pixo-hero" or int(parsed.get("version", 0)) != 1:
		push_error("%s holds no character package of version 1" % dir)
		return false
	data = parsed
	var bin := _bytes(dir)
	if bin.is_empty():
		push_error("%s misses its positions" % dir)
		return false
	for n in data.pics:
		var image := Image.new()
		if image.load_png_from_buffer(FileAccess.get_file_as_bytes(dir + "/" + data.pics[n].file)) != OK:
			push_error("%s misses %s" % [dir, data.pics[n].file])
			return false
		image.convert(Image.FORMAT_RGBA8)
		image.fix_alpha_edges()
		image.generate_mipmaps()
		_pictures[n] = ImageTexture.create_from_image(image)
	for n in data.tracks:
		var track: Dictionary = data.tracks[n]
		var raw := bin.slice(int(track.at), int(track.at) + int(track.bytes)).decompress(int(track.raw), FileAccess.COMPRESSION_DEFLATE)
		var corners := int(track.rows) * int(track.cols)
		var all := PackedVector2Array()
		all.resize(int(data.frames) * corners)
		for i in all.size():
			var v := Vector2(raw.decode_s16(i * 4), raw.decode_s16(i * 4 + 2)) / STEPS
			all[i] = v if i < corners else all[i - corners] + v
		_positions[n] = all
		_indices[n] = _triangles(int(track.rows), int(track.cols))
		_colours[n] = PackedColorArray([Color(track.tint[0], track.tint[1], track.tint[2])])
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC # folded elbows squeeze a picture in one direction
	wear = data.items.start.duplicate()
	if not data.motions.has(motion): motion = data.motions.keys()[0]
	return true

## The positions: as they are, or as text, because an exported game takes along only kinds of files Godot knows.
func _bytes(dir: String) -> PackedByteArray:
	if FileAccess.file_exists(dir + "/hero.bin"): return FileAccess.get_file_as_bytes(dir + "/hero.bin")
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir + "/hero-bin.json"))
	return Marshalls.base64_to_raw(parsed.data) if parsed is Dictionary and parsed.get("format") == "pixo-hero-bin" else PackedByteArray()

## Puts a piece on: put_on("weapon", "weapon3"). One that this character does not have is refused.
func put_on(slot: String, item: String) -> bool:
	if not data.items.has(slot) or not data.items[slot].has(item): return false
	wear[slot] = item
	return true

func take_off(slot: String) -> void:
	wear.erase(slot)

## Changes into a saved outfit.
func put_on_outfit(outfit: String) -> bool:
	for o in data.get("outfits", []):
		if o.name == outfit:
			wear = o.wear.duplicate()
			return true
	return false

## Starts a motion from its beginning; with `restart` off, one that is playing goes on.
func play(what: String, restart := true) -> bool:
	if not data.motions.has(what): return false
	if what == motion and not restart: return true
	motion = what
	time = 0.0
	_told_hit = false
	_told_end = false
	_from = _last.duplicate()
	_since = 0.0
	return true

## Grip and tip of the weapon now, in this node's space: for hit boxes and trails. Empty without a weapon.
func blade() -> PackedVector2Array:
	var weapon: String = wear.get("weapon", "")
	if weapon == "": return PackedVector2Array()
	var list: Array = data.blades[weapon]
	var i := (int(data.motions[motion].from) + int(_place().x)) * 4
	return PackedVector2Array([Vector2(list[i], list[i + 1]) / STEPS, Vector2(list[i + 2], list[i + 3]) / STEPS])

func _process(dt: float) -> void:
	if data.is_empty(): return
	time += dt * speed
	_since += dt
	var m: Dictionary = data.motions[motion]
	if m.loop and time >= m.seconds:
		time = fmod(time, m.seconds)
		_told_hit = false
	if not _told_hit and m.has("hit") and time >= m.hit:
		_told_hit = true
		hit.emit()
	if not _told_end and not m.loop and time >= m.seconds:
		_told_end = true
		finished.emit(motion)
	queue_redraw()

## Frame, next frame and how far it is between them.
func _place() -> Vector3:
	var m: Dictionary = data.motions[motion]
	var n := int(m.count)
	var u: float = fmod(time, m.seconds) / m.seconds * n if m.loop else minf(time / m.seconds, 1.0) * (n - 1)
	var a := mini(int(u), n - 1)
	return Vector3(a, (a + 1) % n if m.loop else mini(a + 1, n - 1), u - a)

func _draw() -> void:
	if data.is_empty(): return
	var from := int(data.motions[motion].from)
	var place := _place()
	var frame := from + int(place.x)
	var weapon: String = wear.get("weapon", "")
	var face: String = data.faces[int(data.face[frame])]
	var done := {}
	for slot: String in data.orders[int(data.order[frame])]:
		var part := slot.trim_suffix("+")
		var track := part
		var picture := part
		var expression := ""
		if slot == "hair" and wear.get("cape", "") != "": continue
		if part == "armF" or part == "creaseF": track = part + weapon.trim_prefix("weapon")
		if slot == "head":
			expression = face
			track = "head" if wear.get("head", "") != "" else "bare"
			picture = ("face/" if track == "head" else "head/") + face
		elif LAYERS.has(slot):
			var item: String = wear.get(LAYERS[slot], "")
			if item == "": continue
			if slot == "weapon" or slot == "cape":
				track = item
				picture = item
			else:
				picture = item + "/" + part
				if slot == "head+": expression = face
		if not _positions.has(track) or not _pictures.has(picture): continue
		if not done.has(track): done[track] = _corners(track, from, place)
		RenderingServer.canvas_item_add_triangle_array(get_canvas_item(), _indices[track], done[track], _colours[track], _places(track, picture, expression, slot == "head+"), PackedInt32Array(), PackedFloat32Array(), _pictures[picture].get_rid())

func _corners(track: String, from: int, place: Vector3) -> PackedVector2Array:
	var c := int(data.tracks[track].rows) * int(data.tracks[track].cols)
	var all: PackedVector2Array = _positions[track]
	var a := (from + int(place.x)) * c
	var b := (from + int(place.y)) * c
	var out := all.slice(a, a + c)
	for i in c: out[i] = out[i].lerp(all[b + i], place.z)
	if _since < BLEND and _from.has(track):
		var before: PackedVector2Array = _from[track]
		var mix := smoothstep(0.0, 1.0, _since / BLEND)
		for i in c: out[i] = before[i].lerp(out[i], mix)
	_last[track] = out
	return out

## Where the corners lie on a cropped picture. Every expression has its own place in its drawing; helmets follow the calm one.
func _places(track: String, picture: String, expression: String, helmet: bool) -> PackedVector2Array:
	var key := track + "|" + picture + "|" + expression + ("+" if helmet else "")
	if _uv.has(key): return _uv[key]
	var t: Dictionary = data.tracks[track]
	var p: Dictionary = data.pics[picture]
	var source: Array = t.uvs[expression] if expression != "" and t.has("uvs") and t.uvs[expression] != null else t.uv
	var shift := Vector2(p.x, p.y)
	if helmet and t.has("off"): shift += Vector2(t.off[expression][0], t.off[expression][1])
	var out := PackedVector2Array()
	for i in source.size() / 2: out.append((Vector2(source[i * 2], source[i * 2 + 1]) - shift) / Vector2(p.w, p.h))
	_uv[key] = out
	return out

func _triangles(rows: int, cols: int) -> PackedInt32Array:
	var out := PackedInt32Array()
	for r in rows - 1:
		for q in cols - 1:
			var a := r * cols + q
			out.append_array(PackedInt32Array([a, a + 1, a + cols + 1, a, a + cols + 1, a + cols]))
	return out
