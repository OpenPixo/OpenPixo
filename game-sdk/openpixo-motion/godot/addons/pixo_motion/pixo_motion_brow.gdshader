// SPDX-License-Identifier: Apache-2.0
shader_type canvas_item;
uniform bool tint = false;
uniform vec3 col = vec3(0.2);
void fragment() {
	vec4 c = texture(TEXTURE, UV) * COLOR;
	COLOR = tint ? vec4(col, c.a * 0.9) : c;
}
