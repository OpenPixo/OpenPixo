# SPDX-License-Identifier: Apache-2.0
# Plays a character whose gear can be changed: one flat picture per part and ready-made corner positions per frame. Godot 4.
class_name PixoCharacter extends Node2D

## The moment a blow lands.
signal hit
## A motion that does not repeat is over.
signal finished(motion: String)

## Which group of `wear` an armour layer belongs to.
const LAYERS := { "head+": "head", "torso+": "body", "armN+": "arm", "armF+": "arm", "legN+": "leg", "legF+": "leg", "weapon": "weapon", "bow": "weapon", "staff": "weapon", "string": "weapon", "shot": "weapon", "shield": "shield", "cape": "cape" }
## Seconds a new motion takes to blend in.
const BLEND := 0.09
const STEPS := 8.0

var data: Dictionary
## What it wears, by slot: head, body, arm, leg, weapon, cape, shield. `data.items` lists what there is. Change it with put_on and take_off.
var wear := {}
var motion := "idle"
var time := 0.0
var speed := 1.0

var _pictures := {}
var _positions := {}
var _indices := {}
var _colours := {}
var _uv := {}
var _hands := {}
var _last := {}
var _from := {}
var _since := 9.0
var _played := ""
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

## How what is in the hands is used: spear, staff, bow, launcher, shield, fists. Empty for a weapon that is swung, or in a package that has nothing else.
func type() -> String:
	if not data.has("types"): return ""
	var weapon: String = wear.get("weapon", "")
	if weapon == "": return "fists"
	if data.types.has(weapon): return data.types[weapon]
	return "shield" if wear.get("shield", "") != "" else ""

## The motion that is really played with what is in the hands: with a bow, attack is the motion bow/attack.
func _key() -> String:
	var own := type() + "/" + motion
	return own if data.motions.has(own) else motion

## What the weapon shoots, for a game that flies it. The texture points up, `tail` is its rear end on it, `size` pixels of this node for one of its
## pixels; it leaves from `from` towards `direction`. Empty for what is not shot.
func shot() -> Dictionary:
	var weapon: String = wear.get("weapon", "")
	if not data.get("shots", {}).has(weapon): return {}
	var s: Dictionary = data.shots[weapon]
	var p: Dictionary = data.pics[s.picture]
	var b := blade()
	# a staff is held upright and what it fires flies forward
	return { "texture": _pictures[s.picture], "tail": Vector2(s.tail[0] - p.x, s.tail[1] - p.y), "size": float(s.size), "from": b[0] if type() == "bow" else b[1], "direction": Vector2.RIGHT if type() == "staff" else (b[1] - b[0]).normalized() }

## Grip and tip of the weapon now, in this node's space: for hit boxes and trails. Empty without a weapon.
func blade() -> PackedVector2Array:
	var weapon: String = wear.get("weapon", "")
	if weapon == "": return PackedVector2Array()
	var list: Array = data.blades[weapon]
	var i := (int(data.motions[_key()].from) + int(_place().x)) * 4
	return PackedVector2Array([Vector2(list[i], list[i + 1]) / STEPS, Vector2(list[i + 2], list[i + 3]) / STEPS])

func _process(dt: float) -> void:
	if data.is_empty(): return
	time += dt * speed
	_since += dt
	var m: Dictionary = data.motions[_key()]
	if _key() != _played:
		# other hands: what is carried changes at once, so nothing is blended
		if _played.get_slice("/", _played.get_slice_count("/") - 1) == motion and time > dt:
			_since = 9.0
			if not m.loop: time = 0.0
		_played = _key()
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
	var m: Dictionary = data.motions[_key()]
	var n := int(m.count)
	var u: float = fmod(time, m.seconds) / m.seconds * n if m.loop else minf(time / m.seconds, 1.0) * (n - 1)
	var a := mini(int(u), n - 1)
	return Vector3(a, (a + 1) % n if m.loop else mini(a + 1, n - 1), u - a)

func _draw() -> void:
	if data.is_empty(): return
	var from := int(data.motions[_key()].from)
	var place := _place()
	var frame := from + int(place.x)
	var weapon: String = wear.get("weapon", "")
	var face: String = data.faces[int(data.face[frame])]
	var hands := type()
	var shield: bool = wear.get("shield", "") != "" and not data.get("twoHanded", []).has(hands)
	var ahead: bool = data.get("farHand", []).has(hands)
	var done := {}
	for slot: String in data.orders[int(data.order[frame])]:
		var part := slot.trim_suffix("+")
		var track := part
		var picture := part
		var expression := ""
		if slot == "hair" and wear.get("cape", "") != "": continue
		if slot == "shield" and not shield: continue
		if (slot == "weapon" and ahead) or (slot == "staff" and hands != "staff") or ((slot == "bow" or slot == "string" or slot == "shot") and hands != "bow"): continue
		var far := part == "armF" or part == "creaseF"
		if far:
			track = part + ("" if shield else weapon.trim_prefix("weapon"))
			# whatever it holds, the far hand is the near one's fist
			if hands != "": picture = part.trim_suffix("F") + "N"
		if slot == "head":
			expression = face
			track = "head" if wear.get("head", "") != "" else "bare"
			picture = ("face/" if track == "head" else "head/") + face
		elif LAYERS.has(slot):
			var item: String = wear.get(LAYERS[slot], "")
			if item == "": continue
			if slot == "string" or slot == "shot":
				track = slot + weapon.trim_prefix("weapon")
				picture = track
			elif slot == "weapon" or slot == "bow" or slot == "staff" or slot == "shield" or slot == "cape":
				track = item
				picture = item
			else:
				picture = item + "/" + (picture if far else part)
				if slot == "head+": expression = face
		if not _positions.has(track) or not _pictures.has(picture): continue
		if not done.has(track): done[track] = _corners(track, from, place)
		RenderingServer.canvas_item_add_triangle_array(get_canvas_item(), _indices[track], done[track], _colours[track], _places(track, picture, expression, slot == "head+"), PackedInt32Array(), PackedFloat32Array(), _pictures[picture].get_rid())

func _corners(track: String, from: int, place: Vector3) -> PackedVector2Array:
	var c := int(data.tracks[track].rows) * int(data.tracks[track].cols)
	var all: PackedVector2Array = _positions[track]
	var a := (from + int(place.x)) * c
	var b := (from + int(place.y)) * c
	var out := _mix(track, all.slice(a, a + c), all.slice(b, b + c), place.z)
	if _since < BLEND and _from.has(track): out = _mix(track, _from[track], out, smoothstep(0.0, 1.0, _since / BLEND))
	_last[track] = out
	return out

## The moment between two. Corners go straight from one to the other, but a weapon is stiff: it turns about the hand and keeps its shape.
func _mix(track: String, a: PackedVector2Array, b: PackedVector2Array, k: float) -> PackedVector2Array:
	var out := a.duplicate()
	var held: bool = data.blades.has(track) and int(data.tracks[track].rows) > 1
	if not held and (int(data.tracks[track].rows) != 2 or int(data.tracks[track].cols) != 2):
		for i in out.size(): out[i] = out[i].lerp(b[i], k)
		return out
	var end := (int(data.tracks[track].rows) - 1) * int(data.tracks[track].cols)
	if not _hands.has(track):
		# where on the weapon the hand is, seen along its first column of corners; whatever else is stiff turns about its middle
		var all: PackedVector2Array = _positions[track]
		var about: Vector2 = Vector2(data.blades[track][0], data.blades[track][1]) / STEPS if held else (all[0] + all[3]) / 2.0
		_hands[track] = (about - all[0]).rotated(-(all[end] - all[0]).angle())
	var from := (a[end] - a[0]).angle()
	var to := (b[end] - b[0]).angle()
	var hand: Vector2 = a[0] + _hands[track].rotated(from)
	var at: Vector2 = hand.lerp(b[0] + _hands[track].rotated(to), k)
	var turn := angle_difference(from, to) * k
	for i in out.size(): out[i] = at + (a[i] - hand).rotated(turn)
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
