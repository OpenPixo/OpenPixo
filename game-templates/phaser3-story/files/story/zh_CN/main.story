# 示例故事，每个命令都用到一次。换成你自己的故事。
# 格式见 README.md。每个语言文件夹的标签和命令必须一样、顺序一样，只有文字不同。

== start
@bg station_night
@music night_wind
末班车四分钟前开走了。站台的灯嗡嗡作响。
@wait 0.6
@show ren calm right
ren: 你看起来像是刚目送一班车开走的人。
? 你怎么回答？
- “是啊。还有下一班吗？” -> ask
- “我没事。我喜欢待在这儿。” -> pretend

== ask
ren: 要等到早上了。不过候车室有个炉子。
@jump waiting_room

== pretend
@add trust 1
ren: 撒谎的人一般会挑个暖和点的谎。进来吧。

== waiting_room
@bg waiting_room
@sfx door
@show ren left
@show iko shy right
已经有人在里面了，手里拿着一封没贴邮票的信。
iko: ……你也要等到早上吗？
- 问问那封信 -> letter
- 别打扰她 -> quiet
- 告诉阿仁，你刚才说没事是骗他的 -> confess if trust >= 1

== letter
@set asked_letter = true
@add trust 1
@show iko smile
iko: 是写给我姐姐的。我每次都故意错过那班车。
@jump dawn

== confess
@add trust 1
ren: 我知道。所以才叫你进来。
@jump dawn

== quiet
你搓着手取暖。谁都没说话，但并不尴尬。

== dawn
@bg station_dawn
@music stop
@if asked_letter and trust >= 2 -> together
@if trust >= 2 -> keeper
@hide
首班车进站了。你一个人上了车，身后的灯熄了。
@end alone 清晨的列车

== together
iko: 我坐这班走。你愿意陪我坐吗？
@end together 两张车票

== keeper
@hide iko
ren: 有空再来。炉子一直烧着。
@end keeper 站长的炉子
