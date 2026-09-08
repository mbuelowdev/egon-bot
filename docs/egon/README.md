# Egon handoff pack

Start here. This directory is the implementation contract for Egon. The bot is **not** built yet.

## Read order

1. This file
2. [SPEC.md](SPEC.md) — product, invariants, env, commands, state machine. SPEC wins on conflict.
3. Only the **next unfinished** milestone work order:
   - [MILESTONE-1.md](MILESTONE-1.md) — Discord bot + commands + Docker skeleton
   - [MILESTONE-2.md](MILESTONE-2.md) — Cursor planner + implementer + Q&A + usage presence
   - [MILESTONE-3.md](MILESTONE-3.md) — Godot web export, serve, tester loop, accept/reject/pivot
   - [MILESTONE-4.md](MILESTONE-4.md) — game scenarios, machine-executable checks, agent-free suite
   - [MILESTONE-5.md](MILESTONE-5.md) — asset library, human asset portal, spec §4 assets

## How to use with a new agent

Implement **one milestone per session** unless the human explicitly says otherwise. Stop when that milestone's Done-when checklist is complete.

Paste-ready prompts:

```
Implement only docs/egon/MILESTONE-1.md. Follow docs/egon/SPEC.md. Stop when its Done-when checklist is complete.
```

```
Implement only docs/egon/MILESTONE-2.md. Follow docs/egon/SPEC.md. Stop when its Done-when checklist is complete.
```

```
Implement only docs/egon/MILESTONE-3.md. Follow docs/egon/SPEC.md. Stop when its Done-when checklist is complete.
```

```
Implement only docs/egon/MILESTONE-4.md. Follow docs/egon/SPEC.md. Stop when its Done-when checklist is complete.
```

```
Implement only docs/egon/MILESTONE-5.md. Follow docs/egon/SPEC.md. Stop when its Done-when checklist is complete.
```

Do not invent a new design doc. Do not restate SPEC invariants inside a milestone except as a pointer.
