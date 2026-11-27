# SPDX-License-Identifier: Apache-2.0
## Plays a Pixo Motion character (.pxmo) in Godot 4: set `file`, add it to a scene. look_at_point, look_away, set_mood, talk, hold, release, frame.
class_name PixoMotion
extends Node2D

signal line_ended

@export_file("*.pxmo") var file = ""
@export var canvas_size = Vector2i(512, 640)
@export var follow_mouse = false

const SHADER := preload("res://addons/pixo_motion/pixo_motion.gdshader")
const BROW_SHADER := preload("res://addons/pixo_motion/pixo_motion_brow.gdshader")
const KIND := {"face": 0, "ear": 0, "brow": 0, "pin": 0, "hairMid": 0, "body": 1, "ribbon": 2, "hairFront": 3, "hairBack": 4}
const MOODS := {
	"calm": {"eye": 0.96, "tilt": 0.0, "iris": 1.0, "by": 0.0, "bi": 0.0, "bb": 0.0, "mouth": "wavy0", "blush": 0.15, "arc": 0.0},
	"smile": {"eye": 1.0, "tilt": 0.0, "iris": 1.0, "by": -1.0, "bi": 0.0, "bb": 0.0, "mouth": "smile", "blush": 0.5, "arc": 0.0},
	"happy": {"eye": 1.0, "tilt": 0.0, "iris": 1.0, "by": -7.0, "bi": 0.0, "bb": 0.0, "mouth": "laugh", "blush": 1.0, "arc": 1.0},
	"angry": {"eye": 0.78, "tilt": 0.34, "iris": 0.95, "by": 9.0, "bi": 30.0, "bb": 4.0, "mouth": "pout", "blush": 0.2, "arc": 0.0},
	"sad": {"eye": 0.74, "tilt": -0.28, "iris": 1.0, "by": 2.0, "bi": -22.0, "bb": -2.0, "mouth": "wavy", "blush": 0.25, "arc": 0.0},
	"surprised": {"eye": 1.12, "tilt": 0.0, "iris": 0.74, "by": -14.0, "bi": 0.0, "bb": -2.0, "mouth": "gasp", "blush": 0.15, "arc": 0.0},
	"shy": {"eye": 0.72, "tilt": -0.08, "iris": 1.03, "by": -3.0, "bi": -9.0, "bb": 0.0, "mouth": "wavy", "blush": 1.5, "arc": 0.0},
}
const KF := 2.0  # face drawn at twice the model's size

var header: Dictionary
var raw: PackedByteArray
var pics = {}
var LY: Dictionary
var EYES: Dictionary
var HI: Dictionary
var GX: Array; var GY: Array; var BX: Array
var cx = 513.0
var chin = 560.0
var tint = null
var all_mats: Array[ShaderMaterial] = []
var looks = {}   # main material per mesh
var face_outline: MeshInstance2D
var probe = {}
var vp: SubViewport
var masks = {}
var face_vp: SubViewport
var brow_vp: SubViewport
var face_nodes = {}
var brow_node: Node2D
var view_s = 1.0
var view_c = Vector2.ZERO
var rigs = {}
var P = {"angleX": 0.0, "angleY": 0.0, "angleZ": 0.0, "bodyX": 0.0, "bodyZ": 0.0, "eyeOpenL": 1.0, "eyeOpenR": 1.0, "gazeX": 0.0, "gazeY": 0.0, "browY": 0.0, "mouthOpen": 0.0, "mouthRound": 0.0, "blush": 0.2, "breath": 0.0, "lightX": -0.55, "sleeve": 0.0}
var E = {"eye": 1.0, "tilt": 0.0, "iris": 1.0, "by": 0.0, "bi": 0.0, "bb": 0.0, "blush": 0.5, "arc": 0.0}
var mood = "smile"
var shown = "smile"
var held = {}
var look = {"x": 0.0, "y": 0.0, "on": false}
var S = {}
var time = 0.0
var next_blink = 1.5
var blink_at = -9.0
var prev = {}
var speak = null
var wn = 1.2
var wx = 0.0
var wy = 0.0
var seed_ = 11
var sac = Vector2.ZERO
var sac_at = 0.0
var last_look = Vector2.ZERO
var sleeve = Vector2.ZERO
var chains: Array = []        # every chain: {n, seg, k, k0, c, air, acc, dir, max, th, om}
var chain_row = {}           # strand name -> row
var back_row = 0
var ch_img: Image
var ch_tex: ImageTexture
var groups = {"lock": [], "bang": [], "side": [], "ahoge": []}

func _ready() -> void:
	if file != "": load_pxmo(file)

func _sec(key: String) -> PackedByteArray:
	var e: Dictionary = header.index[key]
	return raw.slice(int(e.o), int(e.o) + int(e.len))

func _i16_texture(key: String) -> ImageTexture:
	var b = _sec(key); var rows = int(ceil(b.size() / 2.0 / 4096.0)); b.resize(rows * 4096 * 2)
	return ImageTexture.create_from_image(Image.create_from_data(4096, rows, false, Image.FORMAT_RG8, b))

func _pic(name: String) -> Texture2D:
	if pics.has(name): return pics[name]
	if not header.textures.has(name): return null
	var img = Image.new(); img.load_webp_from_buffer(_sec(header.textures[name].s))
	pics[name] = ImageTexture.create_from_image(img); return pics[name]

func load_pxmo(path: String) -> void:
	var f = FileAccess.get_file_as_bytes(path)
	assert(f.slice(0, 4).get_string_from_ascii() == "PXMO", "not a Pixo Motion file")
	var hl = f.decode_u32(8)
	header = JSON.parse_string(f.slice(12, 12 + hl).get_string_from_utf8())
	raw = f.slice(12 + hl).decompress_dynamic(-1, FileAccess.COMPRESSION_DEFLATE)
	GX = header.grid.GX; GY = header.grid.GY; BX = header.grid.BX
	cx = float(header.look.CX); chin = float(header.look.CHIN); tint = header.look.hairTint
	LY = header.data.LAYERS.layers; EYES = header.data.LAYERS.eyes; HI = header.data.HAIR3.info
	for k in ["L", "R"]:  # the same smoothing of the eyelid curves the web player does
		for s in ["up", "low"]:
			var a: Array = EYES[k][s]
			for r in 8:
				var b = a.duplicate(true)
				for i in range(1, a.size() - 1): b[i] = [a[i][0], (a[i - 1][1] + 2 * a[i][1] + a[i + 1][1]) / 4.0]
				a = b
			EYES[k][s] = a
	for k in ["ax", "ay", "az", "bx", "bz", "gx", "gy"]: S[k] = Vector2.ZERO  # x = place, y = speed
	_build_chains()
	_build_face()
	_build_canvas()
	var pr: Dictionary = header.probes
	probe = {"n": int(pr.n), "rest": _sec(pr.rest.s).to_float32_array(), "hk": _sec(pr.hk.s), "hkk": float(pr.hk.k), "bk": _sec(pr.bk.s), "bkk": float(pr.bk.k)}

func _viewport(size: Vector2i) -> SubViewport:
	var v = SubViewport.new(); v.size = size; v.transparent_bg = true; v.disable_3d = true
	v.render_target_update_mode = SubViewport.UPDATE_ALWAYS; add_child(v); return v

func _build_canvas() -> void:
	var W = canvas_size.x; var H = canvas_size.y
	view_s = max(H / 1230.0, min(H / 1100.0, W / 900.0)); view_c = Vector2(513.0, H / view_s / 2.0 - 70.0)
	vp = _viewport(canvas_size)
	for m in ["hair", "head", "fringe"]: masks[m] = _viewport(canvas_size / 2)
	rigs = {"main": Node2D.new(), "hair": Node2D.new(), "head": Node2D.new(), "fringe": Node2D.new()}
	for m in ["hair", "head", "fringe"]: masks[m].add_child(rigs[m])
	frame(view_s, view_c.y, view_c.x)
	vp.add_child(rigs.main)
	var order: Array = header.look.order.duplicate()
	if header.data.LAYERS.get("browUnder", false) and order.has("brow"):
		order.erase("brow")
		var at := order.size()
		for i in order.size():
			if str(order[i]).begins_with("H"): at = i; break
		order.insert(at, "brow")
	for k in order:
		var d: Dictionary = header.meshes[k]
		var mesh = _mesh(d)
		var mat = _material(d, k)
		var tex = _mesh_picture(k)
		if k == "face":
			face_outline = _instance(mesh, tex, mat.duplicate()); face_outline.material.set_shader_parameter("mode", 3); rigs.main.add_child(face_outline); all_mats.append(face_outline.material)
		var mi = _instance(mesh, tex, mat); mi.name = k; rigs.main.add_child(mi); looks[k] = mat; all_mats.append(mat)
		var front_hair = k.begins_with("H")
		var is_front: bool = front_hair and header.data.HAIR3.layers.get(k.substr(1), {}).get("front", false)
		for m in ["hair", "head", "fringe"]:
			var use: bool = (m == "hair" and front_hair) or (m == "head" and (front_hair or k == "ears" or k == "face")) or (m == "fringe" and is_front)
			if use:
				var mm: ShaderMaterial = mat.duplicate(); mm.set_shader_parameter("mode", 2); rigs[m].add_child(_instance(mesh, tex, mm)); all_mats.append(mm)
	_set_looks()
	var spr = Sprite2D.new(); spr.texture = vp.get_texture()
	var cm = CanvasItemMaterial.new(); cm.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA; spr.material = cm
	add_child(spr)

func _mesh(d: Dictionary) -> ArrayMesh:
	var n = int(d.n)
	var rest = _sec(d.rest.s).to_float32_array(); var uvf = _sec(d.uv.s).to_float32_array(); var nm = _sec(d.nm.s).to_float32_array()
	var e = _sec(d.e.s).to_float32_array() if d.has("e") else PackedFloat32Array()
	var tri = _sec(d.tri.s)
	var verts = PackedVector2Array(); verts.resize(n); var uvs = PackedVector2Array(); uvs.resize(n); var cols = PackedColorArray(); cols.resize(n)
	for i in n:
		verts[i] = Vector2(rest[i * 3], rest[i * 3 + 1]); uvs[i] = Vector2(uvf[i * 2], uvf[i * 2 + 1])
		cols[i] = Color(nm[i * 3] * 0.5 + 0.5, nm[i * 3 + 1] * 0.5 + 0.5, nm[i * 3 + 2] * 0.5 + 0.5, e[i] if e.size() > 0 else 0.0)
	var idx = PackedInt32Array(); idx.resize(tri.size() / 2)
	for i in idx.size(): idx[i] = tri.decode_u16(i * 2)
	var arrays = []; arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts; arrays[Mesh.ARRAY_TEX_UV] = uvs; arrays[Mesh.ARRAY_COLOR] = cols; arrays[Mesh.ARRAY_INDEX] = idx
	var mesh = ArrayMesh.new(); mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, Mesh.ARRAY_FLAG_USE_2D_VERTICES)
	return mesh

func _instance(mesh: ArrayMesh, tex: Texture2D, mat: ShaderMaterial) -> MeshInstance2D:
	var mi = MeshInstance2D.new(); mi.mesh = mesh; mi.texture = tex; mi.material = mat; return mi

func _mesh_picture(k: String) -> Texture2D:
	if k == "face": return face_vp.get_texture()
	if k == "brow": return brow_vp.get_texture()
	var names = {"hairBack": "h3back", "hairMid": "h3mid", "ears": "ears"}
	return _pic(names.get(k, "h3_" + k.substr(1) if k.begins_with("H") else k))

func _material(d: Dictionary, k: String) -> ShaderMaterial:
	var m = ShaderMaterial.new(); m.shader = SHADER
	m.set_shader_parameter("n", int(d.n)); m.set_shader_parameter("kind", KIND[d.kind]); m.set_shader_parameter("cx", cx); m.set_shader_parameter("chin", chin)
	m.set_shader_parameter("back_row", back_row); m.set_shader_parameter("ch_tex", ch_tex)
	if d.has("hk"): m.set_shader_parameter("hk_tex", _i16_texture(d.hk.s)); m.set_shader_parameter("hk_k", float(d.hk.k))
	if d.has("bk"): m.set_shader_parameter("bk_tex", _i16_texture(d.bk.s)); m.set_shader_parameter("bk_k", float(d.bk.k))
	if d.kind == "hairFront" and d.has("ids"): m.set_shader_parameter("sw_tex", _swing_texture(d)); m.set_shader_parameter("swing", true)
	if k == "face" or k == "brow": m.set_shader_parameter("premul", true)
	var hair = k == "hairBack" or k == "hairMid" or k.begins_with("H")
	if tint != null and hair:
		m.set_shader_parameter("tint", true)
		for j in 3: m.set_shader_parameter(["ca", "cb", "cc"][j], Vector3(tint[j][0], tint[j][1], tint[j][2]))
	m.set_shader_parameter("hm", float(header.look.hairMid))
	var sh: Array = header.data.HAIR3.shine; m.set_shader_parameter("hi_o", Vector3(sh[0], sh[1], sh[2]))
	m.set_shader_parameter("shade_tex", _pic("h3shade"))
	var face: Dictionary = LY.face; m.set_shader_parameter("mu", 2.0 * (513.0 - float(face.x)) / float(face.w))
	return m

func _set_looks() -> void:  # what each layer looks like, as the web player draws it
	var o = {
		"hairBack": {"mask": "head", "kc": 0.72, "sc": Vector3(0.66, 0.60, 0.72)},
		"body1": {"mask": "head", "kc": 0.62, "ks": 0.42, "th": 0.10, "so": 0.05, "sc": Vector3(0.80, 0.74, 0.84)},
		"body2": {"mask": "head", "kc": 0.62, "ks": 0.42, "th": 0.10, "so": 0.05, "sc": Vector3(0.80, 0.74, 0.84)},
		"ribbon": {"mask": "head", "kc": 0.3, "ks": 0.4, "th": 0.12, "so": 0.05, "sc": Vector3(0.8, 0.7, 0.78)},
		"ears": {"mask": "hair", "kc": 0.85, "sc": Vector3(0.935, 0.775, 0.755)},
		"face": {"mask": "hair", "kc": 0.85, "ks": 0.82, "sc": Vector3(0.935, 0.775, 0.755), "sdf": true},
		"hairMid": {"mask": "hair", "kc": 0.8, "ks": 0.6, "th": 0.10, "so": 0.035, "sc": Vector3(0.62, 0.56, 0.68)},
		"pin": {"ks": 0.5, "th": 0.1, "so": 0.1, "sc": Vector3(0.7, 0.7, 0.8)},
		"brow": {},
	}
	for k in looks:
		var m: ShaderMaterial = looks[k]
		var q: Dictionary = o.get(k, {})
		if k.begins_with("H"):
			var lay: Dictionary = header.data.HAIR3.layers.get(k.substr(1), {})
			var r: Array = lay.get("rect", [0, 0, 1, 1])
			q = {"ks": 0.70, "th": 0.10, "so": 0.035, "sc": Vector3(0.70, 0.64, 0.76), "kr": 0.30 if lay.get("front", false) else 0.0, "shine": true}
			m.set_shader_parameter("cr", Vector4(r[0], r[1], r[2], r[3]))
			if not lay.get("front", false): q.merge({"mask": "fringe", "kc": 0.62})
		if q.has("mask"): m.set_shader_parameter("mask_tex", masks[q.mask].get_texture())
		for key in ["kc", "ks", "th", "so", "kr"]:
			if q.has(key): m.set_shader_parameter(key, q[key])
		if q.has("sc"): m.set_shader_parameter("sc", q.sc)
		if q.get("sdf", false): m.set_shader_parameter("sdf", true)
		if q.get("shine", false): m.set_shader_parameter("hk", true); m.set_shader_parameter("shine_tex", _pic("h3shine"))
	face_outline.material.set_shader_parameter("mask_tex", null)

func _build_face() -> void:
	var F: Dictionary = LY.face
	face_vp = _viewport(Vector2i(int(round(float(F.w) * KF)), int(round(float(F.h) * KF))))
	var base = FaceLayer.new(self, "base"); face_vp.add_child(base); face_nodes.base = base
	for k in ["L", "R"]:
		var clip = Polygon2D.new(); clip.clip_children = CanvasItem.CLIP_CHILDREN_ONLY; face_vp.add_child(clip)
		var white = FaceLayer.new(self, "white" + k); clip.add_child(white)
		var inner = FaceLayer.new(self, "inner" + k); clip.add_child(inner)
		face_nodes["clip" + k] = clip; face_nodes["white" + k] = white; face_nodes["inner" + k] = inner
	var over = FaceLayer.new(self, "over"); face_vp.add_child(over); face_nodes.over = over
	var a: Dictionary = LY.browL; var b: Dictionary = LY.browR
	var bx = min(float(a.x), float(b.x)) - 14.0; var by = min(float(a.y), float(b.y)) - 34.0
	var brect = Rect2(bx, by, max(float(a.x) + float(a.w), float(b.x) + float(b.w)) + 14.0 - bx, max(float(a.y) + float(a.h), float(b.y) + float(b.h)) + 34.0 - by)
	brow_vp = _viewport(Vector2i(int(round(brect.size.x * KF)), int(round(brect.size.y * KF))))
	brow_node = FaceLayer.new(self, "brow"); brow_node.set_meta("rect", brect)
	var bm = ShaderMaterial.new(); bm.shader = BROW_SHADER
	if tint != null: bm.set_shader_parameter("tint", true); bm.set_shader_parameter("col", Vector3(tint[0][0], tint[0][1], tint[0][2]) * 0.8)
	brow_node.material = bm; brow_vp.add_child(brow_node)

func fx(v: float) -> float:
	return (v - float(LY.face.x)) * KF
func fy(v: float) -> float:
	return (v - float(LY.face.y)) * KF
func at(a: Array, x: float) -> float:
	if x <= a[0][0]: return a[0][1]
	var e: Array = a[a.size() - 1]
	if x >= e[0]: return e[1]
	var i = int(floor(x - a[0][0])); var k = x - a[0][0] - i
	return lerp(float(a[i][1]), float(a[min(a.size() - 1, i + 1)][1]), k)
func lay_rect(n: String, dx := 0.0, dy := 0.0) -> Rect2:
	var L: Dictionary = LY[n]
	return Rect2(fx(float(L.x) + dx), fy(float(L.y) + dy), float(L.w) * KF, float(L.h) * KF)

func eye_state(k: String) -> Dictionary:
	var open: float = P["eyeOpen" + k] * E.eye * ((1.0 - clamp(E.arc * 2.0, 0.0, 1.0)) if LY.has("arcL") else (1.0 - 0.65 * clamp(E.arc * 2.0, 0.0, 1.0)))
	var Q: Dictionary = EYES[k]; var c0 = 1.0 - open; var inner = 1.0 if k == "L" else -1.0
	var mid = (float(Q.x0) + float(Q.x1)) / 2.0; var hw = (float(Q.x1) - float(Q.x0)) / 2.0
	var c = func(x: float) -> float: return clamp(c0 + (E.tilt * inner * (x - mid) / hw * (1.0 - c0) if c0 < 0.9 else 0.0), -0.25, 1.0)
	var m = func(x: float) -> float: return at(Q.shut, x) - 1.0
	var uy = func(x: float) -> float: return lerp(at(Q.up, x), m.call(x), c.call(x))
	var dy = func(x: float) -> float: return lerp(at(Q.low, x) + 1.5, m.call(x) + 1.0, smoothstep(0.0, 1.0, clamp((c0 - 0.62) / 0.38, 0.0, 1.0)))
	return {"Q": Q, "c0": c0, "c": c, "uy": uy, "dy": dy, "arc": E.arc > 0.5 and LY.has("arcL")}

func _face_frame() -> void:
	for k in ["L", "R"]:
		var s = eye_state(k); var Q: Dictionary = s.Q; var c0: float = s.c0
		var poly = PackedVector2Array(); var x = float(Q.x0) - 1.0
		while x <= float(Q.x1) + 1.0: poly.append(Vector2(fx(x), fy(s.uy.call(x) - 2.0))); x += 1.0
		x = float(Q.x1) + 1.0
		while x >= float(Q.x0) - 1.0: poly.append(Vector2(fx(x), fy(s.dy.call(x) + (-c0 * 14.0 if c0 < 0.0 else 0.0)))); x -= 1.0
		var clip: Polygon2D = face_nodes["clip" + k]; clip.polygon = poly
		clip.visible = c0 < 0.97 and not s.arc
		face_nodes["eye" + k] = s
	for n in face_nodes.values():
		if n is FaceLayer: n.queue_redraw()
	brow_node.queue_redraw()

func draw_layer(node: Node2D, part: String) -> void:  # called from FaceLayer._draw
	if part == "base":
		node.draw_texture_rect(_pic("face"), Rect2(Vector2.ZERO, face_vp.size), false)
		var a = clamp(E.blush * 0.75 + P.blush * 0.6, 0.0, 1.0)
		if LY.has("blush"): node.draw_texture_rect(_pic("blush"), lay_rect("blush"), false, Color(1, 1, 1, a))
	elif part.begins_with("white"):
		var k = part.substr(5); var s: Dictionary = face_nodes.get("eye" + k, {})
		if s.is_empty(): return
		node.draw_texture_rect(_pic("white" + k), lay_rect("white" + k), false)
		if s.c0 < 0.0: node.draw_texture_rect(_pic("white" + k), lay_rect("white" + k, 0.0, -s.c0 * 12.0), false)
	elif part.begins_with("inner"):
		var k = part.substr(5); var s: Dictionary = face_nodes.get("eye" + k, {})
		if s.is_empty(): return
		var Q: Dictionary = s.Q; var L: Dictionary = LY["irisD" + k]; var sc: float = E.iris
		var icx: float = Q.iris[0]; var icy: float = Q.iris[1]
		var px: float = P.gazeX * 13.0 - P.angleX * 0.07; var py: float = P.gazeY * 9.0 + P.angleY * 0.05
		node.draw_texture_rect(_pic("irisD" + k), Rect2(fx(icx + (float(L.x) - icx) * sc + px), fy(icy + (float(L.y) - icy) * sc + py + (1.0 - sc) * -3.0), float(L.w) * sc * KF, float(L.h) * sc * KF), false)
		var band = PackedVector2Array(); var x = float(Q.x0) - 1.0
		while x <= float(Q.x1) + 1.0: band.append(Vector2(fx(x), fy(s.uy.call(x) - 4.0))); x += 1.0
		x = float(Q.x1) + 1.0
		while x >= float(Q.x0) - 1.0: band.append(Vector2(fx(x), fy(s.uy.call(x) + 5.0 + 4.0 * clamp(s.c.call(x) * 2.0, 0.0, 1.0)))); x -= 1.0
		if Geometry2D.triangulate_polygon(band).size() > 0: node.draw_colored_polygon(band, Color(70 / 255.0, 40 / 255.0, 60 / 255.0, 0.20))
		if LY.has("glint" + k):
			var G: Dictionary = LY["glint" + k]
			node.draw_texture_rect(_pic("glint" + k), Rect2(fx(float(G.x) + px * 0.42 - P.angleX * 0.05), fy(float(G.y) + py * 0.42 + P.angleY * 0.04), float(G.w) * KF, float(G.h) * KF), false)
	elif part == "over":
		for k in ["L", "R"]:
			var s: Dictionary = face_nodes.get("eye" + k, {})
			if s.is_empty(): continue
			var c0: float = s.c0; var Q: Dictionary = s.Q
			if s.arc:
				var t = clamp((E.arc - 0.5) * 4.0, 0.0, 1.0)
				if LY.has("arc" + k): node.draw_texture_rect(_pic("arc" + k), lay_rect("arc" + k, 0.0, (1.0 - t) * -4.0), false)
				continue
			if c0 < 0.97:
				if LY.has("low" + k): node.draw_texture_rect(_pic("low" + k), lay_rect("low" + k, 0.0, -c0 * 14.0 if c0 < 0.0 else 0.0), false, Color(1, 1, 1, clamp(1.0 - (c0 - 0.55) * 4.0, 0.0, 1.0)))
				var A: Dictionary = LY["lash" + k]; var src: Texture2D = _pic("lash" + k); var sx = src.get_width() / float(A.w); var st = 0.5; var x = 0.0
				while x < float(A.w):
					var xx = float(A.x) + x + st / 2.0; var xc = clamp(xx, float(Q.x0) + 2.0, float(Q.x1) - 2.0)
					var over = float(Q.x0) - xx if xx < float(Q.x0) else (xx - float(Q.x1) if xx > float(Q.x1) else 0.0)
					var d: float = (s.uy.call(xc) - at(Q.up, xc)) * (1.0 - clamp(over / 30.0, 0.0, 1.0) * 0.5)
					var cc = clamp(s.c.call(xc), 0.0, 1.0); var outer = clamp(((float(Q.x0) + 24.0 - xx) if k == "L" else (xx - (float(Q.x1) - 24.0))) / 40.0, 0.0, 1.0)
					var hk = 1.0 - 0.36 * cc - 0.30 * cc * outer; var base = at(Q.up, xc) - float(A.y)
					node.draw_texture_rect_region(src, Rect2(fx(float(A.x) + x), fy(float(A.y) + d + base * (1.0 - hk)), st * KF + 0.6, float(A.h) * KF * hk), Rect2(x * sx, 0, st * sx, src.get_height()))
					x += st
			elif LY.has("shut" + k):
				node.draw_texture_rect(_pic("shut" + k), lay_rect("shut" + k), false)
			if LY.has("crease" + k): node.draw_texture_rect(_pic("crease" + k), lay_rect("crease" + k, 0.0, c0 * 9.0), false, Color(1, 1, 1, 0.75 * clamp(1.0 - c0 * 0.8, 0.0, 1.0)))
		_mouth(node)
	elif part == "brow":
		var R: Rect2 = node.get_meta("rect")
		for side in ["L", "R"]:
			var L: Dictionary = LY["brow" + side]; var im: Texture2D = _pic("brow" + side); var sx = im.get_width() / float(L.w); var inL = side == "L"; var x = 0.0
			while x < float(L.w):
				var q = (x + 0.25) / float(L.w); var t = q if inL else 1.0 - q
				var dy: float = E.by - P.browY * 8.0 + E.bi * (t - 0.35) + E.bb * sin(PI * t); var dx: float = (1.0 if inL else -1.0) * max(0.0, E.bi) * 0.2 * t
				node.draw_texture_rect_region(im, Rect2((float(L.x) + x + dx - R.position.x) * KF, (float(L.y) + dy - R.position.y) * KF, 0.5 * KF + 0.6, float(L.h) * KF), Rect2(x * sx, 0, 0.5 * sx, im.get_height()))
				x += 0.5

func _put(node: Node2D, n: String, sx := 1.0, sy := 1.0, top = null) -> void:
	if not LY.has("mouth_" + n): n = "smile"
	var L: Dictionary = LY["mouth_" + n]
	node.draw_texture_rect(_pic("mouth_" + n), Rect2(fx(float(L.x) + float(L.w) / 2.0 - float(L.w) * sx / 2.0), fy(top if top != null else float(L.y)), float(L.w) * sx * KF, float(L.h) * sy * KF), false)

func _mouth(node: Node2D) -> void:
	var M0: Dictionary = MOODS[shown]; var o: float = P.mouthOpen; var S0: Dictionary = LY.mouth_smile
	if o > 0.1:
		var q = clamp((o - 0.1) / 0.9, 0.0, 1.0)
		if P.mouthRound > 0.5: _put(node, "oh", lerp(0.85, 1.12, q), lerp(0.5, 1.1, q), float(S0.y) + lerp(3.0, -5.0, q))
		else: _put(node, "ah", lerp(0.50, 0.74, q), lerp(0.24, 0.78, q), float(S0.y) + lerp(0.0, -11.0, q))
		return
	if M0.mouth == "wavy0": _put(node, "smile", 0.62, 0.55, float(S0.y) + 3.0)
	else: _put(node, M0.mouth)

func _chain(n: int, seg: float, o: Dictionary) -> Dictionary:
	var c = {"n": n, "seg": seg, "k": 40.0, "k0": 60.0, "c": 4.2, "air": 0.05, "acc": 0.0035, "dir": 1.0, "max": 0.6}
	c.merge(o, true); c.th = []; c.om = []
	for i in n: c.th.append(0.0); c.om.append(0.0)
	return c

func _build_chains() -> void:
	var names: Array = header.data.HAIR3.names; var i = 0
	var locks = names.filter(func(n): return HI[n].g == "lock"); var bangs = names.filter(func(n): return HI[n].g == "bang" or HI[n].g == "top")
	var sides = names.filter(func(n): return HI[n].g == "side"); var tufts = names.filter(func(n): return HI[n].g == "ahoge")
	for n in locks:
		chains.append(_chain(5, (float(HI[n].tip) - float(HI[n].root)) / 5.0, {"k": 66.0 - i % 2 * 5, "k0": 60.0 + i % 2 * 6, "c": 4.6 - i % 2 * 0.2, "air": 0.030, "acc": 0.0018, "max": 0.24})); chain_row[n] = chains.size() - 1; i += 1
	i = 0
	for n in bangs:
		var Lb = float(HI[n].tip) - float(HI[n].root); var side: bool = HI[n].g == "top"
		chains.append(_chain(3, Lb / 3.0, {"k": (92.0 if side else 150.0) + (i * 5) % 22, "k0": (100.0 if side else 172.0) + (i * 4) % 19, "c": 6.2 if side else 9.5, "air": 0.030 if side else 0.042, "acc": 0.003 if side else 0.005, "max": 0.13 if side else 0.17})); chain_row[n] = chains.size() - 1; i += 1
	for n in sides: chains.append(_chain(3, (float(HI[n].tip) - float(HI[n].root)) / 3.0, {"k": 120.0, "k0": 150.0, "c": 7.0, "air": 0.012, "acc": 0.0012, "max": 0.05})); chain_row[n] = chains.size() - 1
	for n in tufts: chains.append(_chain(3, max(20.0, (float(HI[n].root) - float(HI[n].tip)) / 3.0), {"k": 120.0, "k0": 130.0, "c": 6.0, "air": 0.14, "acc": 0.011, "max": 0.9, "tuft": true})); chain_row[n] = chains.size() - 1
	groups = {"lock": locks, "bang": bangs, "side": sides, "ahoge": tufts}
	back_row = chains.size()
	var HB: Array = header.data.HAIR3.back
	for j in 5: chains.append(_chain(5, (float(HB[1]) + float(HB[3]) - 480.0) / 5.0, {"k": 46.0 + j % 2 * 8, "k0": 64.0, "c": 4.4, "air": 0.034, "acc": 0.0018, "max": 0.26}))
	chains.append(_chain(3, 80.0, {"k": 60.0, "k0": 72.0, "c": 5.0, "air": 0.075, "acc": 0.003, "max": 0.32}))
	chains.append(_chain(3, 80.0, {"k": 56.0, "k0": 76.0, "c": 5.0, "air": 0.075, "acc": 0.003, "max": 0.32}))
	ch_img = Image.create(33, chains.size(), false, Image.FORMAT_RGBAF); ch_tex = ImageTexture.create_from_image(ch_img)
	for n in HI:  # centre line of every strand, to read its width from it
		var a: Array = HI[n].cx; HI[n]["_cx"] = a

func _at_cx(n: String, y: float) -> float:
	var a: Array = HI[n]._cx
	if y <= a[0][0]: return a[0][1]
	for i in range(1, a.size()):
		if y <= a[i][0]: return lerp(float(a[i - 1][1]), float(a[i][1]), (y - a[i - 1][0]) / (a[i][0] - a[i - 1][0]))
	return a[a.size() - 1][1]

func _swing_texture(d: Dictionary) -> ImageTexture:  # per point: up to 3 chains it hangs from, with weight, place along the strand and distance from its centre
	var n = int(d.n); var rest = _sec(d.rest.s).to_float32_array(); var rows = int(ceil(n * 3 / 4096.0))
	var f = PackedFloat32Array(); f.resize(rows * 4096 * 4)
	for i in n:
		var x = rest[i * 3]; var y = rest[i * 3 + 1]; var id: Array = d.ids[i]; var used = 0
		for q in id[0].size():
			var nm: String = id[0][q]; var w: float = id[1][q]
			if w <= 0.004 or not chain_row.has(nm) or used >= 3: continue
			var I: Dictionary = HI[nm]; var t: float; var wd = 0.0
			if I.g == "ahoge": t = clamp((float(I.root) - y) / (float(I.root) - float(I.tip)), 0.0, 1.0)
			else: t = clamp((y - float(I.root)) / (float(I.tip) - float(I.root)), 0.0, 1.0); wd = x - _at_cx(nm, y)
			var o = (i * 3 + used) * 4; f[o] = chain_row[nm]; f[o + 1] = w; f[o + 2] = t; f[o + 3] = wd; used += 1
	return ImageTexture.create_from_image(Image.create_from_data(4096, rows, false, Image.FORMAT_RGBAF, f.to_byte_array()))

func _chain_step(c: Dictionary, dt: float, vx: float, ax: float, tgt: float, wind: float) -> void:
	for i in c.n:
		var up: float = c.th[i - 1] if i > 0 else tgt; var w = 1.0 + i * 0.25
		var al: float = -(c.k if i > 0 else c.k0) * (c.th[i] - up) - 9.0 * c.th[i] - c.c * c.om[i] - c.air * w * vx - c.acc * ax + wind * w
		c.om[i] += al * dt; c.th[i] = clamp(c.th[i] + c.om[i] * dt, -c.max, c.max)
		if i > 0 and c.n > 2:
			var d: float = c.th[i] - c.th[i - 1]; var m: float = c.max * 0.42
			if abs(d) > m: c.th[i] = c.th[i - 1] + sign(d) * m; c.om[i] *= 0.6

func _chain_table() -> void:  # 33 samples of every chain's offset and bend along its length
	for r in chains.size():
		var c: Dictionary = chains[r]; var Sn: int = c.n * 4; var X = PackedFloat32Array(); var Y = PackedFloat32Array(); X.resize(Sn + 1); Y.resize(Sn + 1)
		for i in Sn:
			var u = (i + 0.5) / 4.0 - 0.5; var j = clampi(int(floor(u)), 0, c.n - 1); var a: float = lerp(float(c.th[j]), float(c.th[min(c.n - 1, j + 1)]), clamp(u - j, 0.0, 1.0))
			X[i + 1] = X[i] + c.seg / 4.0 * sin(a); Y[i + 1] = Y[i] + c.seg / 4.0 * (1.0 - cos(a))
		for s in 33:
			var t = s / 32.0; var e = t * Sn; var fl = mini(int(floor(e)), Sn - 1); var fr = e - fl
			var ox: float = lerp(X[fl], X[fl + 1], fr); var oy: float = -lerp(Y[fl], Y[fl + 1], fr) * c.dir
			var uu = clamp(t * c.n - 0.5, 0.0, c.n - 1.0); var k = int(floor(uu)); var bend: float = lerp(float(c.th[k]), float(c.th[min(c.n - 1, k + 1)]), uu - k) * min(1.0, t * 2.5)
			ch_img.set_pixel(s, r, Color(ox, oy, bend, 1.0 if c.get("tuft", false) else 0.0))
	ch_tex.update(ch_img)

func _gw(G: Array, v: float) -> Vector2:
	v = clamp(v, G[0], G[G.size() - 1]); var i = 0
	while i < G.size() - 2 and v > G[i + 1]: i += 1
	return Vector2(i, (v - G[i]) / (G[i + 1] - G[i]))

func _probe_body(i: int, hb: Vector2) -> Vector2:
	var n: int = probe.n; var b: PackedByteArray = probe.bk; var k: float = probe.bkk
	var x0: float = probe.rest[i * 3]; var y0: float = probe.rest[i * 3 + 1]; var d = Vector2.ZERO
	for s in 2:
		var key = int(hb.x) + s; var w = hb.y if s == 1 else 1.0 - hb.y; var o = ((key * n + i) * 2) * 2
		d += Vector2(b.decode_s16(o), b.decode_s16(o + 2)) * w * k
	var p = Vector2(x0, y0) + d
	var w = smoothstep(0.0, 1.0, clamp((1480.0 - y0) / 780.0, 0.0, 1.0)); var nn = clamp((640.0 - y0) / 170.0, 0.0, 1.0); var dx = x0 - cx
	p.x += P.angleX * 0.3 * nn; p.y += -5.5 * P.breath * w - 2.5 * P.breath * clamp((abs(dx) - 120.0) / 160.0, 0.0, 1.0) * clamp((960.0 - y0) / 120.0, 0.0, 1.0) * clamp((y0 - 640.0) / 60.0, 0.0, 1.0)
	var a = deg_to_rad(P.bodyZ * 0.5) * w; var e = p - Vector2(cx, 1536.0)
	return Vector2(cx, 1536.0) + Vector2(e.x * cos(a) - e.y * sin(a), e.x * sin(a) + e.y * cos(a))

func _probe_head(i: int, keys: Vector4i, ws: Vector4, nk: Vector2, rz: float) -> Vector2:
	var n: int = probe.n; var b: PackedByteArray = probe.hk; var k: float = probe.hkk; var d = Vector2.ZERO
	for s in 4:
		var o = ((keys[s] * n + i) * 3) * 2; d += Vector2(b.decode_s16(o), b.decode_s16(o + 2)) * ws[s] * k
	var t = Vector2(probe.rest[i * 3], probe.rest[i * 3 + 1]) + d; var dx = t.x - cx; var dy = t.y - (chin + 13.0)
	return nk + Vector2(dx * cos(rz) - dy * sin(rz) + P.angleX * 0.3, -15.0 + dx * sin(rz) + dy * cos(rz) - P.angleY * 0.1)

func _rnd() -> float:
	seed_ = (seed_ * 16807) % 2147483647
	return seed_ / 2147483647.0

func _go(k: String, target: float, w: float, z: float, dt: float) -> float:
	var s: Vector2 = S[k]; s.y += (w * w * (target - s.x) - 2.0 * z * w * s.y) * dt; s.x += s.y * dt; S[k] = s; return s.x

func _blink(t: float) -> float:
	if t < 0.0: return 1.0
	if t < 0.075: return 1.0 - smoothstep(0.0, 1.0, t / 0.075)
	if t < 0.115: return 0.0
	if t < 0.27: return smoothstep(0.0, 1.0, (t - 0.115) / 0.155)
	return 1.0

func _h(n: float) -> float:
	var z = sin(n * 127.1 + 3.7) * 43758.5
	return z - floor(z)

func _step(dt: float) -> void:
	time += dt; var t = time; var M0: Dictionary = MOODS[mood]
	for k in E: E[k] += (float(M0[k]) - E[k]) * (1.0 - exp(-13.0 * dt))
	if shown != mood and time - blink_at > 0.06: shown = mood
	if not look.on and t > wn: wn = t + 1.5 + _rnd() * 2.6; wx = (_rnd() * 2 - 1) * 0.5; wy = (_rnd() * 2 - 1) * 0.3
	var X_: float = look.x if look.on else wx; var Y_: float = look.y if look.on else wy
	if t > sac_at: sac_at = t + 0.5 + _rnd() * 1.4; sac = Vector2((_rnd() * 2 - 1) * 0.07, (_rnd() * 2 - 1) * 0.05)
	last_look += (Vector2(X_, Y_) - last_look) * (1.0 - exp(-6.0 * dt))
	if Vector2(X_, Y_).distance_to(last_look) > 0.55 and t - blink_at > 1.1: blink_at = t; next_blink = t + 1.6 + _rnd() * 3
	_go("gx", clamp(X_ * 1.2 + sac.x, -1, 1), 22, 0.95, dt); _go("gy", clamp(Y_ * 1.15 + sac.y, -1, 1), 22, 0.95, dt)
	_go("ax", X_ * 29, 7.2, 0.74, dt); _go("ay", -Y_ * 24 - min(7.0, abs(S.ax.y) * 0.055), 7, 0.8, dt)
	_go("az", X_ * 9 + clamp(S.ax.y * 0.045, -7, 7) + sin(t * 0.85) * 2.4 + (9.0 if mood == "shy" else 0.0) + (sin(t * 5) * 4 if mood == "happy" else 0.0), 4.6, 0.78, dt)
	_go("bx", X_ * 8.5, 3.6, 0.8, dt); _go("bz", X_ * 3.2 + sin(t * 0.7) * 1.1, 2.9, 0.85, dt)
	if t > next_blink: blink_at = t; next_blink = t + (0.34 if _rnd() < 0.16 else 2 + _rnd() * 3.2)
	var b = _blink(t - blink_at); var mo = 0.0; var ro = 0.0
	if speak != null:
		var u: float = t - speak.t0
		if u > speak.d: speak = null; line_ended.emit()
		else:
			var i = int(floor(u / 0.135)); var q = fmod(u / 0.135, 1.0); var a = 0.0 if _h(i) < 0.13 else 0.30 + 0.65 * _h(i + 50)
			mo = a * pow(sin(PI * q), 0.7); ro = 1.0 if _h(i + 9) < 0.36 else 0.0; mo *= smoothstep(0.0, 1.0, clamp((speak.d - u) / 0.15, 0.0, 1.0))
	var breath = 0.5 - 0.5 * cos(t * 1.9)
	var auto = {"angleX": clamp(S.ax.x, -32, 32), "angleY": clamp(S.ay.x + (sin(t * 5.6) * 2.6 if speak != null else 0.0) + (breath - 0.5) * 1.6, -30, 30), "angleZ": S.az.x, "bodyX": S.bx.x, "bodyZ": S.bz.x,
		"gazeX": S.gx.x, "gazeY": S.gy.x + (0.4 if mood == "shy" else 0.0), "eyeOpenL": b, "eyeOpenR": b, "browY": 0.25 + 0.3 * sin(t * 4.1) if speak != null else -0.12 * (1 - b),
		"mouthOpen": mo, "mouthRound": ro, "blush": 0.2, "breath": breath, "lightX": -0.55}
	for k in auto: P[k] = held[k] if held.has(k) else auto[k]
	var W_ = _keys(); var nk = _probe_body(0, W_.hb)
	var pts = {"l": _probe_head(1, W_.keys, W_.ws, nk, W_.rz), "r": _probe_head(2, W_.keys, W_.ws, nk, W_.rz), "f": _probe_head(3, W_.keys, W_.ws, nk, W_.rz), "k": _probe_head(4, W_.keys, W_.ws, nk, W_.rz), "t": _probe_head(5, W_.keys, W_.ws, nk, W_.rz), "c": _probe_body(6, W_.hb)}
	if prev.is_empty():
		for k in pts: prev[k] = {"p": pts[k], "v": 0.0}
	var V = {}; var A = {}
	for k in pts:
		var v: float = (pts[k].x - prev[k].p.x) / dt; var v2: float = prev[k].v + (v - prev[k].v) * 0.5
		V[k] = v2; A[k] = clamp((v2 - prev[k].v) / dt, -5000, 5000); prev[k] = {"p": pts[k], "v": v2}
	var gust = func(ph: float) -> float: return sin(t * 1.25 + ph) * 0.9 + sin(t * 2.1 + 1 + ph * 1.7) * 0.6 + sin(t * 0.43 + ph) * 0.8
	var roll = -deg_to_rad(P.angleZ * 0.4) * 0.5
	for it in 2:
		var d = dt / 2.0
		for n in groups.bang: _chain_step(chains[chain_row[n]], d, V.f, A.f, 0.0, gust.call((float(HI[n].x) - 300.0) / 190.0) * 0.8)
		for n in groups.side: _chain_step(chains[chain_row[n]], d, V.l, A.l, 0.0, gust.call(float(HI[n].x) / 200.0) * 0.8)
		for n in groups.lock:
			var r: bool = float(HI[n].x) > cx
			_chain_step(chains[chain_row[n]], d, V.r if r else V.l, A.r if r else A.l, roll, gust.call(0.9 if r else 0.0) * 1.2)
		for j in 5: _chain_step(chains[back_row + j], d, V.k, A.k, roll * 0.7, gust.call(j * 0.6 + 0.4) * 0.9)
		_chain_step(chains[back_row + 5], d, V.c, A.c, 0.0, gust.call(0.2) * 1.6); _chain_step(chains[back_row + 6], d, V.c, A.c, 0.0, gust.call(1.0) * 1.6)
		for n in groups.ahoge: _chain_step(chains[chain_row[n]], d, V.t, A.t, 0.0, gust.call(1.4) * 2.4)
		sleeve.y += (-50 * sleeve.x - 6 * sleeve.y - V.c * 0.04 + gust.call(0.3) * 2) * d; sleeve.x += sleeve.y * d
	P.sleeve = clamp(sleeve.x, -1, 1)

func _keys() -> Dictionary:
	var hx = _gw(GX, P.angleX); var hy = _gw(GY, P.angleY); var hb = _gw(BX, P.bodyX); var nx = GX.size(); var a = int(hy.x) * nx + int(hx.x)
	return {"keys": Vector4i(a, a + 1, a + nx, a + nx + 1), "ws": Vector4((1 - hx.y) * (1 - hy.y), hx.y * (1 - hy.y), (1 - hx.y) * hy.y, hx.y * hy.y), "hb": hb, "rz": deg_to_rad(P.angleZ * 0.4 + P.bodyZ * 0.42)}

func _mat3(a: float, b: float, r: float) -> Basis:
	var ca = cos(a); var sa = sin(a); var cb = cos(b); var sb = sin(b); var cr = cos(r); var sr = sin(r)
	var m = [[ca, 0.0, sa], [sa * sb, cb, -ca * sb], [-sa * cb, sb, ca * cb]]; var cols = []
	for c in 3: cols.append(Vector3(cr * m[0][c] - sr * m[1][c], sr * m[0][c] + cr * m[1][c], m[2][c]))
	return Basis(cols[0], cols[1], cols[2])

func _render() -> void:
	var W_ = _keys(); var nk = _probe_body(0, W_.hb); var gx = 0.72; var gy = 0.66
	var RH = _mat3(deg_to_rad(P.angleX * gx), deg_to_rad(P.angleY * gy), deg_to_rad(P.angleZ * 0.4)); var RB = _mat3(deg_to_rad(P.bodyX * 1.75), 0.0, deg_to_rad(P.bodyZ * 0.4))
	var lx: float = P.lightX; var ll = Vector3(lx, -0.5, 0.74).normalized(); var lo = -sign(lx) * min(1.0, abs(lx) / 0.55)
	var ph = rad_to_deg(atan2(-lx, 0.74)) + P.angleX * gx * 0.92
	var hw: float = float(header.data.HAIR3.W) / float(header.data.HAIR3.Z); var hh: float = float(header.data.HAIR3.H) / float(header.data.HAIR3.Z)
	var shx = Vector2(sin(deg_to_rad(P.angleX * gx)) * 40.0 / hw, -sin(deg_to_rad(P.angleY * gy)) * 84.0 / hh)
	_chain_table()
	for m in all_mats:
		m.set_shader_parameter("hkey", W_.keys); m.set_shader_parameter("hw", W_.ws)
		m.set_shader_parameter("bkey", Vector2i(int(W_.hb.x), int(W_.hb.x) + 1)); m.set_shader_parameter("bw", W_.hb.y)
		m.set_shader_parameter("neck", nk); m.set_shader_parameter("rz", W_.rz)
		m.set_shader_parameter("angle_x", P.angleX); m.set_shader_parameter("angle_y", P.angleY)
		m.set_shader_parameter("breath", P.breath); m.set_shader_parameter("body_z", P.bodyZ); m.set_shader_parameter("sleeve", P.sleeve)
		m.set_shader_parameter("R", RH); m.set_shader_parameter("L", ll); m.set_shader_parameter("ph", ph); m.set_shader_parameter("sh_off", shx)
	for k in ["body1", "body2", "ribbon"]:
		if looks.has(k): looks[k].set_shader_parameter("R", RB)
	var W = float(canvas_size.x); var H = float(canvas_size.y); var u = Vector2(view_s / W, view_s / H)
	var offs = {"hairBack": Vector2(15 * lo, 22), "body1": Vector2(13 * lo, 24 - P.angleY * 0.3), "body2": Vector2(13 * lo, 24 - P.angleY * 0.3), "ribbon": Vector2(13 * lo, 24),
		"ears": Vector2(5.5 * lo + P.angleX * 0.06, 11 - P.angleY * 0.28), "face": Vector2(5.5 * lo + P.angleX * 0.06, 11 - P.angleY * 0.28), "hairMid": Vector2(6 * lo, 10)}
	for k in looks:
		var f: Vector2 = offs.get(k, Vector2(6 * lo, 9 - P.angleY * 0.15) if k.begins_with("H") else Vector2.ZERO)
		looks[k].set_shader_parameter("off", Vector2(-f.x * u.x, -f.y * u.y))
	var turn: float = P.angleX * gx
	face_outline.visible = abs(turn) > 3.0
	face_outline.material.set_shader_parameter("push", sign(turn) * 1.5 * clamp((abs(turn) - 3.0) / 8.0, 0.0, 1.0))
	_face_frame()

func _process(dt: float) -> void:
	if all_mats.is_empty(): return
	if follow_mouse: look_at_point(get_local_mouse_position(), true)
	dt = clamp(dt, 1e-4, 0.05)
	_step(dt / 2.0); _step(dt / 2.0)
	_render()

func look_at_point(p: Vector2, local := false) -> void:
	var lp = p if local else to_local(p)
	look.on = true; look.x = clamp(lp.x / (canvas_size.x * 0.42), -1, 1); look.y = clamp((lp.y + canvas_size.y * 0.14) / (canvas_size.y * 0.45), -1, 1)
func look_away() -> void:
	look.on = false; wn = 0.0
func set_mood(name: String) -> void:
	if MOODS.has(name):
		mood = name; blink_at = time
func talk(seconds := 2.5) -> void:
	speak = {"t0": time, "d": seconds}
func hold(p: Dictionary) -> void:
	held.merge(p, true)
func release(keys: Array = []) -> void:
	if keys.is_empty(): held.clear()
	else:
		for k in keys: held.erase(k)
func frame(s: float, yc: float, xc := 513.0) -> void:
	view_s = s; view_c = Vector2(xc, yc)
	if rigs.is_empty(): return
	rigs.main.scale = Vector2(s, s); rigs.main.position = Vector2(canvas_size) / 2.0 - view_c * s
	for m in ["hair", "head", "fringe"]: rigs[m].scale = rigs.main.scale / 2.0; rigs[m].position = rigs.main.position / 2.0
