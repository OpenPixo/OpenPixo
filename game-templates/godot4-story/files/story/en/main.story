# A sample story that uses every command once. Replace it with your own.
# The format is in README.md. Every language folder must have the same labels
# and commands in the same order; only the text changes.

== start
@bg station_night
@music night_wind
The last train left four minutes ago. The platform lamp hums.
@wait 0.6
@show ren calm right
ren: You look like someone who just watched a train leave.
? What do you say?
- "I did. Is there another one?" -> ask
- "I'm fine. I like it here." -> pretend

== ask
ren: Not until morning. But the waiting room has a stove.
@jump waiting_room

== pretend
@add trust 1
ren: Liars usually pick a warmer lie. Come inside.

== waiting_room
@bg waiting_room
@sfx door
@show ren left
@show iko shy right
Someone is already there, holding a letter with no stamp.
iko: ...Are you stuck until morning too?
- Ask about the letter -> letter
- Leave her be -> quiet
- Tell Ren you lied about being fine -> confess if trust >= 1

== letter
@set asked_letter = true
@add trust 1
@show iko smile
iko: It's for my sister. I keep missing the train on purpose.
@jump dawn

== confess
@add trust 1
ren: I know. That's why I asked you in.
@jump dawn

== quiet
You warm your hands. Nobody speaks. It isn't uncomfortable.

== dawn
@bg station_dawn
@music stop
@if asked_letter and trust >= 2 -> together
@if trust >= 2 -> keeper
@hide
The first train pulls in. You board alone, and the lamp goes out behind you.
@end alone The Morning Train

== together
iko: I'll take this one. Will you sit with me?
@end together Two Tickets

== keeper
@hide iko
ren: Come back sometime. The stove is always on.
@end keeper The Keeper's Stove
