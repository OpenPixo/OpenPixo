// SPDX-License-Identifier: Apache-2.0
shader_type canvas_item;
render_mode blend_mix;

uniform sampler2D hk_tex : filter_nearest;   // head keyforms, int16 as RG8 bytes, 4096 wide: [key][point][xyz]
uniform sampler2D bk_tex : filter_nearest;   // body keyforms, int16 as RG8 bytes, 4096 wide: [key][point][xy]
uniform sampler2D sw_tex : filter_nearest;   // per point swing data, RGBAF, 4096 wide, 3 texels a point: (chain row, weight, t, width)
uniform sampler2D ch_tex : filter_nearest;   // chains this frame, RGBAF 33 x chains: (offset x, offset y, bend, tuft?)
uniform float hk_k = 1.0;
uniform float bk_k = 1.0;
uniform int n = 1;
uniform int kind = 0;                        // 0 head, 1 body, 2 ribbon, 3 front hair, 4 back hair
uniform bool swing = false;
uniform int back_row = 0;                    // first of the 5 back hair chains; ribbons follow
uniform ivec4 hkey;
uniform vec4 hw;
uniform ivec2 bkey;
uniform float bw;
uniform vec2 neck;
uniform float rz;
uniform float angle_x;
uniform float angle_y;
uniform float breath;
uniform float body_z;
uniform float sleeve;
uniform float cx = 513.0;
uniform float chin = 560.0;
uniform float push = 0.0;
uniform mat3 R = mat3(1.0);
uniform int mode = 0;                        // 0 normal, 2 mask (alpha only), 3 face outline
uniform bool premul = false;                 // picture drawn live (face, brows): stored premultiplied
uniform bool tint = false;
uniform vec3 ca;
uniform vec3 cb;
uniform vec3 cc;
uniform float hm = 0.5;
uniform vec3 L = vec3(-0.5, -0.45, 0.67);
uniform float ks = 0.0;
uniform float th = 0.15;
uniform float so = 0.03;
uniform vec3 sc = vec3(0.8, 0.75, 0.85);
uniform bool sdf = false;
uniform float ph = 0.0;
uniform float mu = 1.0;
uniform sampler2D shade_tex : filter_linear;
uniform sampler2D mask_tex : filter_linear;
uniform float kc = 0.0;
uniform vec2 off;
uniform float kr = 0.0;
uniform bool hk = false;
uniform sampler2D shine_tex : filter_linear;
uniform vec4 cr = vec4(0.0, 0.0, 1.0, 1.0);
uniform vec2 sh_off;
uniform vec3 hi_o = vec3(1.0);

varying vec3 nn;
varying float ee;

float s16(sampler2D t, int L_) {
	vec2 v = texelFetch(t, ivec2(L_ % 4096, L_ / 4096), 0).rg;
	float u = round(v.r * 255.0) + round(v.g * 255.0) * 256.0;
	return u >= 32768.0 ? u - 65536.0 : u;
}
float ease(float t) { return t * t * (3.0 - 2.0 * t); }
float bump(float y, float cy, float r) { return exp(-((y - cy) * (y - cy)) / (2.0 * r * r)); }
vec4 chain(int row, float t) { float u = clamp(t, 0.0, 1.0) * 32.0; int a = int(floor(u)); int b = min(32, a + 1); return mix(texelFetch(ch_tex, ivec2(a, row), 0), texelFetch(ch_tex, ivec2(b, row), 0), u - float(a)); }

vec3 turned(int i, vec2 rest) {
	vec3 d = vec3(0.0);
	for (int k = 0; k < 4; k++) { int b = (hkey[k] * n + i) * 3; d += vec3(s16(hk_tex, b), s16(hk_tex, b + 1), s16(hk_tex, b + 2)) * hw[k]; }
	d *= hk_k;
	return vec3(rest + d.xy, d.z);
}
vec2 bodied(int i, vec2 rest, vec2 o) {
	int b0 = (bkey.x * n + i) * 2, b1 = (bkey.y * n + i) * 2;
	vec2 d = vec2(s16(bk_tex, b0), s16(bk_tex, b0 + 1)) * (1.0 - bw) + vec2(s16(bk_tex, b1), s16(bk_tex, b1 + 1)) * bw;
	vec2 p = rest + o + d * bk_k;
	float x0 = rest.x, y0 = rest.y, w = ease(clamp((1480.0 - y0) / 780.0, 0.0, 1.0)), dx = x0 - cx, nn_ = clamp((640.0 - y0) / 170.0, 0.0, 1.0);
	p.x += angle_x * 0.3 * nn_;
	p.y += -5.5 * breath * w - 2.5 * breath * clamp((abs(dx) - 120.0) / 160.0, 0.0, 1.0) * clamp((960.0 - y0) / 120.0, 0.0, 1.0) * clamp((y0 - 640.0) / 60.0, 0.0, 1.0);
	p.x += dx * 0.008 * breath * bump(y0, 960.0, 170.0);
	float sl = clamp((abs(dx) - 210.0) / 130.0, 0.0, 1.0) * clamp((y0 - 930.0) / 420.0, 0.0, 1.0);
	p.x += sleeve * 9.0 * pow(sl, 1.3);
	float a = radians(body_z * 0.5) * w; vec2 e = p - vec2(cx, 1536.0);
	return vec2(cx, 1536.0) + vec2(e.x * cos(a) - e.y * sin(a), e.x * sin(a) + e.y * cos(a));
}
vec2 headed(vec3 t, vec2 o) {
	float dx = t.x + o.x - cx, dy = t.y + o.y - (chin + 13.0);
	return neck + vec2(dx * cos(rz) - dy * sin(rz) + angle_x * 0.3, -15.0 + dx * sin(rz) + dy * cos(rz) - angle_y * 0.1);
}
vec2 strands(int i) {  // the hair swing at one point: each chain it hangs from, weighted
	vec2 o = vec2(0.0);
	for (int s = 0; s < 3; s++) {
		int L_ = i * 3 + s; vec4 q = texelFetch(sw_tex, ivec2(L_ % 4096, L_ / 4096), 0);
		if (q.y <= 0.004) continue;
		vec4 c = chain(int(q.x), q.z);
		if (c.w > 0.5) { o += vec2(-c.x, c.y) * q.y; continue; }
		float f = min(1.0, q.z * 3.0), w = q.w;
		o += vec2(c.x * f + (w * cos(c.z) - w) * f, c.y * f - w * sin(c.z) * f) * q.y;
	}
	return o;
}

void vertex() {
	int i = VERTEX_ID;
	vec2 rest = VERTEX;
	nn = R * (COLOR.rgb * 2.0 - 1.0);
	ee = COLOR.a;
	vec2 p;
	if (kind == 1) {
		p = bodied(i, rest, vec2(0.0));
	} else if (kind == 2) {
		vec2 b = bodied(i, rest, vec2(0.0));
		float t = clamp((rest.y - 886.0) / 240.0, 0.0, 1.0), k = clamp(abs(rest.x - cx) / 26.0, 0.0, 1.0);
		vec4 c = chain(back_row + (rest.x < cx ? 5 : 6), t);
		p = b + vec2(c.x * mix(0.4, 1.0, k), c.y);
	} else if (kind == 3) {
		vec2 o = swing ? strands(i) : vec2(0.0);
		vec2 hd = headed(turned(i, rest), o);
		if (rest.y >= 560.0) { float k = 1.0 - 0.60 * ease(clamp((rest.y - 560.0) / 330.0, 0.0, 1.0)); p = mix(bodied(i, rest, o), hd, k); } else p = hd;
	} else if (kind == 4) {
		vec2 hd = headed(turned(i, rest), vec2(0.0)), bd = bodied(i, rest, vec2(0.0));
		float k = 1.0 - 0.9 * clamp((rest.y - 450.0) / 450.0, 0.0, 1.0);
		float KX[5] = float[](250.0, 380.0, 513.0, 650.0, 775.0); int j = 0;
		while (j < 3 && rest.x > KX[j + 1]) j++;
		float m = ease(clamp((rest.x - KX[j]) / (KX[j + 1] - KX[j]), 0.0, 1.0)), t = (rest.y - 480.0) / 950.0;
		vec2 o = mix(chain(back_row + j, t).xy, chain(back_row + j + 1, t).xy, m);
		p = mix(bd, hd, k) + o;
	} else {
		p = headed(turned(i, rest), vec2(0.0));
	}
	VERTEX = p + vec2(push, 0.0);
}

void fragment() {
	vec4 q = texture(TEXTURE, UV);
	if (mode == 3) { if (q.a < 0.5) discard; COLOR = vec4(0.17, 0.09, 0.10, smoothstep(0.5, 0.9, q.a)); }
	else if (mode == 2) { COLOR = vec4(1.0, 1.0, 1.0, q.a); }
	else {
		if (q.a < 0.003) discard;
		vec3 r = premul ? q.rgb / q.a : q.rgb;
		float l = dot(r, vec3(0.30, 0.45, 0.25)), sv = hk ? texture(shine_tex, cr.xy + UV * cr.zw + sh_off).a : 0.0;
		vec3 hic = hi_o;
		if (tint) {
			float q0 = 0.39 * hm, q1 = 0.853 * hm, q2 = 1.72 * hm;
			vec3 m = l < q0 ? mix(ca * 0.35, ca, l / q0) : (l < q1 ? mix(ca, cb, (l - q0) / (q1 - q0)) : mix(cb, cc, min(1.0, (l - q1) / (q2 - q1))));
			r = mix(r, m, 0.94); hic = cc;
		}
		vec3 nv = normalize(nn);
		float d = dot(nv, L) + (hk ? (l - 0.82 * hm) * 0.55 * 0.33 / hm : 0.0);
		float shd = ks * (1.0 - smoothstep(th - so, th + so, d));
		if (sdf) { vec2 u2 = ph < 0.0 ? vec2(mu - UV.x, UV.y) : UV; float t = texture(shade_tex, u2).r * 140.0; shd = ks * (1.0 - smoothstep(abs(ph) - 1.6, abs(ph) + 1.6, t)); }
		float csh = kc > 0.0 ? kc * smoothstep(0.25, 0.75, texture(mask_tex, SCREEN_UV + off).a) : 0.0;
		r = mix(r, r * vec3(0.86, 0.80, 0.82) + vec3(0.16, 0.075, 0.05), ee);
		float tot = max(shd, csh);
		r *= mix(vec3(1.0), sc, tot);
		r = mix(r, hic, sv * 0.92 * (1.0 - tot * 0.75) * (hk ? 1.0 : 0.0));
		if (kr > 0.0) { float rim = pow(1.0 - clamp(nv.z, 0.0, 1.0), 3.0) * smoothstep(0.0, 0.6, dot(nv.xy, L.xy)); r += kr * rim * vec3(0.55, 0.5, 0.5); }
		COLOR = vec4(clamp(r, 0.0, 1.0), q.a);
	}
}
