# Recorded OpenCode CLI output (verbatim)

Every `.jsonl` here is byte-for-byte stdout from a real `opencode run --format json --auto`, the
binary bundled with the app, talking to a local fake model. No account or credits are involved.

| file | what it contains |
| --- | --- |
| `repeated-successful-bash.jsonl` | The fake model repeats one identical `bash` call 7 times, one per reply, and every call succeeds. |
| `opencode-1.18.35-auto-compaction.jsonl` | One `glob` call reports 190,010 tokens against a 200,000 / 16,384 limit, so OpenCode compacts. Local paths are replaced with `project`; nothing else is changed. |

What this recording showed: `permission.doom_loop` does not catch this, set to `deny` or left unset.
OpenCode only counts identical calls inside one reply, and a stuck agent repeats across replies. That
is why the credits agent relies on the daemon's tool-loop guard instead.

What the compaction recording showed: the summary arrives as ordinary `text` ("reply 2"), and only the
synthetic `compaction_continue` text after that step shows what it was, so a parser has to hold a
turn-ending step's text to keep the summary out of the chat. Measured with the same setup, 183,500 tokens
do not compact and 183,700 do, which fits OpenCode's rule of context limit minus output limit (183,616).
