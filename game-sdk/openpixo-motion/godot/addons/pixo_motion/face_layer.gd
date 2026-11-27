# SPDX-License-Identifier: Apache-2.0
class_name FaceLayer
extends Node2D

var who: Node
var part := ""

func _init(owner_node: Node = null, which := "") -> void:
	who = owner_node; part = which

func _draw() -> void:
	if who: who.draw_layer(self, part)
