# Discord Game Studio — MVP Specification

## 1. Project Overview

Build a local-first development orchestration system that allows a group of people to collaboratively develop a browser-based video game through a Discord channel.

The MVP should support this basic loop:

```text
Discord discussion
       ↓
Feature specification
       ↓
Human approval
       ↓
Git feature branch/worktree
       ↓
Cursor implementation agent
       ↓
Godot Web build
       ↓
Automated browser test
       ↓
Screenshots
       ↓
Discord result
       ↓
Human merge/reject
```

The system should be designed so that additional AI agents, richer planning, multiplayer collaboration, deployment, and autonomous repair can be added later.

---

# 2. MVP Goals

The MVP MUST demonstrate that a feature can travel through the entire pipeline without manually opening an IDE.

A successful demo should look like:

1. User discusses a feature in Discord.
2. User asks the bot to create a specification.
3. Bot creates a Markdown feature spec.
4. User approves the specification.
5. Bot creates an isolated Git worktree/branch.
6. Bot invokes Cursor CLI to implement the feature.
7. Bot builds the Godot game for Web.
8. Bot starts the game locally.
9. Bot launches Chromium through Playwright.
10. Automated test executes.
11. Playwright captures screenshots.
12. Bot posts the test result and screenshots to Discord.
13. Humans choose Merge or Reject.
14. Merge updates `main`.
15. Reject leaves `main` unchanged.

---

# 3. Explicit Non-Goals

Do NOT implement these in the MVP:

- Multiple simultaneous coding agents
- Autonomous feature discovery
- Autonomous merging
- Production cloud deployment
- Multiplayer
- Voice interaction
- AI-generated artwork
- AI-generated music
- Mobile builds
- Desktop builds
- Console builds
- Multiple game projects
- Complex authentication
- Web dashboard
- Automatic conflict resolution
- Fully autonomous bug fixing
- Long-term memory beyond the project database
- Automatic interpretation of every Discord message

These can be added after the basic pipeline works.

---

# 4. Technology

## Orchestrator

Use:

- Node.js
- TypeScript
- discord.js

## Persistence

Use:

- SQLite for MVP

The database should be replaceable with PostgreSQL later.

## Source Control

Use:

- Git
- Git worktrees

The orchestrator must never directly modify the main working tree during implementation.

## AI Coding Agent

Use:

- Cursor CLI

Cursor should be invoked as an external process from the orchestrator.

Do not automate the Cursor GUI.

The exact Cursor CLI command/configuration should be isolated in one module so it can be changed later.

## Game Engine

Use:

- Godot 4.x
- GDScript

Target platform:

- Web

Do not use C#.

## Browser Testing

Use:

- Playwright
- Chromium

## Build Environment

The MVP should run locally.

Docker support is desirable but not mandatory for the first implementation.

---

# 5. Repository Structure

The project should have this structure:

```text
discord-game-studio/
│
├── orchestrator/
│   ├── src/
│   │   ├── discord/
│   │   ├── features/
│   │   ├── planner/
│   │   ├── cursor/
│   │   ├── git/
│   │   ├── godot/
│   │   ├── testing/
│   │   ├── artifacts/
│   │   ├── database/
│   │   └── index.ts
│   │
│   ├── package.json
│   └── tsconfig.json
│
├── game/
│   ├── project.godot
│   ├── scenes/
│   ├── scripts/
│   ├── assets/
│   └── tests/
│
├── specs/
│   └── features/
│
├── runs/
│
├── AGENTS.md
├── README.md
└── .gitignore
```

The game repository and orchestrator may later become separate repositories, but keeping them together is acceptable for the MVP.

---

# 6. Discord Bot

Create a Discord bot with access to one configured development channel.

The bot should respond to slash commands.

Required commands:

```text
/feature
/spec
/implement
/status
/test
/merge
/reject
/revert
```

The MVP may initially use commands rather than attempting to understand arbitrary conversation.

---

# 7. `/feature`

Purpose:

Create a feature proposal from a human description.

Example:

```text
/feature description:"Add a double jump to the player"
```

Bot response:

```text
💡 Feature proposal created

ID: F-001
Title: Double Jump

Description:
Add a second jump that the player can perform while airborne.

Status: DRAFT

[Generate Spec]
```

The feature should be stored in the database.

---

# 8. `/spec`

Purpose:

Turn a feature proposal into an implementation specification.

Example:

```text
/spec F-001
```

The planning agent should generate:

```text
specs/features/F-001.md
```

Example structure:

```markdown
# F-001 — Double Jump

## Goal

Allow the player to jump twice before touching the ground.

## Gameplay Requirements

- Player can perform a normal jump.
- Player can perform one additional jump while airborne.
- The second jump resets when the player touches the ground.
- The player cannot perform a third jump.
- Existing movement must remain functional.

## Controls

Space:
- First press = normal jump
- Second press while airborne = double jump

## Acceptance Criteria

- [ ] Player can jump from the ground.
- [ ] Player can jump once while airborne.
- [ ] Third jump is impossible.
- [ ] Jump counter resets after landing.
- [ ] Existing movement still works.
- [ ] Works in browser build.

## Technical Notes

Use the existing player movement system.

Do not rewrite unrelated systems.

## Test Plan

1. Launch game.
2. Move player.
3. Jump.
4. Jump again while airborne.
5. Attempt third jump.
6. Land.
7. Verify another double jump is possible.

## Open Questions

None.
```

The generated spec must be posted to Discord in a concise summary.

The user must explicitly approve the specification before implementation.

---

# 9. Feature State Machine

Each feature has exactly one state.

Supported states:

```text
DRAFT
SPEC_READY
APPROVED
IMPLEMENTING
BUILDING
TESTING
PASSED
FAILED
READY_FOR_REVIEW
MERGED
REJECTED
REVERTED
```

Allowed transitions:

```text
DRAFT
  ↓
SPEC_READY
  ↓
APPROVED
  ↓
IMPLEMENTING
  ↓
BUILDING
  ↓
TESTING
  ├── FAILED
  │     ↓
  │   IMPLEMENTING
  │
  └── PASSED
        ↓
  READY_FOR_REVIEW
        ├── MERGED
        └── REJECTED
```

After `MERGED`:

```text
MERGED
   ↓
REVERTED
```

The orchestrator must reject invalid state transitions.

---

# 10. Approval

A feature must never automatically enter implementation.

Discord should display:

```text
📋 F-001 — Double Jump

Specification ready.

Acceptance criteria:
✓ Ground jump
✓ Airborne second jump
✓ No third jump
✓ Reset on landing
✓ Browser compatible

Ready to implement?

[Approve] [Request Changes] [Reject]
```

Only `Approve` starts implementation.

---

# 11. Git Isolation

When implementation starts:

```text
main
  │
  └── feature/F-001-double-jump
```

Create a Git worktree for the feature.

Example conceptual structure:

```text
worktrees/
    F-001/
```

The coding agent operates exclusively inside that worktree.

The main checkout must remain untouched.

Store:

- branch name
- worktree path
- commit hash
- feature ID

in the database.

---

# 12. Cursor Agent

The orchestrator must invoke Cursor CLI as a child process.

Cursor receives:

1. Feature specification
2. Project instructions
3. Repository path
4. Explicit implementation instructions

The agent should be told:

```text
You are implementing one isolated game feature.

Read:
- AGENTS.md
- specs/features/F-XXX.md

Implement ONLY the requested feature.

Requirements:

1. Follow the specification.
2. Do not modify unrelated systems.
3. Do not change project architecture unless necessary.
4. Do not add dependencies without justification.
5. Run available tests.
6. Ensure the game can be exported to Web.
7. Do not modify secrets or credentials.
8. Do not modify the orchestrator.
9. When implementation is complete, provide a concise summary.
```

The orchestrator should capture:

- stdout
- stderr
- exit code
- execution duration

Store these in:

```text
runs/F-001/
```

---

# 13. AGENTS.md

Create an `AGENTS.md` in the repository.

It should contain the permanent project rules.

Minimum rules:

```markdown
# Game Development Rules

## Engine

Godot 4.x.

## Language

GDScript only.

## Target

Browser/Web only.

## Architecture

Prefer small scenes and reusable components.

Do not rewrite existing systems unless required.

## Feature Isolation

Only modify files necessary for the requested feature.

Do not modify unrelated gameplay.

## Testing

Every feature must have a reproducible test procedure.

## Browser Compatibility

The game must successfully export and run in Chromium.

## Security

Never expose secrets.

Never modify credentials.

## Git

Work only in the assigned feature branch/worktree.

Never commit generated secrets or credentials.
```

---

# 14. Build System

The orchestrator needs a Godot build module.

Input:

```text
feature worktree
```

Output:

```text
runs/F-001/build/
```

The build process should:

1. Validate the Godot project.
2. Export a Web build.
3. Store build logs.
4. Return success/failure.

Expected output:

```text
runs/F-001/build/
    index.html
    ...
```

The exact Godot CLI invocation should be isolated inside:

```text
orchestrator/src/godot/GodotBuilder.ts
```

Do not scatter shell commands throughout the application.

---

# 15. Local Game Server

After a successful build, start a local HTTP server.

Example:

```text
http://127.0.0.1:<dynamic-port>
```

Do not use `file://`.

The server must:

- start automatically
- return its port
- expose the Web build
- be killable by the orchestrator
- terminate when the run finishes

The server should not expose the game to the public internet.

---

# 16. Playwright Tester

Create a tester module:

```text
orchestrator/src/testing/PlaywrightTester.ts
```

It must:

1. Launch Chromium.
2. Open the game URL.
3. Wait for the game to load.
4. Execute the feature's test procedure.
5. Capture screenshots.
6. Collect console errors.
7. Record test results.
8. Close Chromium.

Screenshots should be stored under:

```text
runs/F-001/screenshots/
```

Example:

```text
startup.png
after-jump.png
after-double-jump.png
after-third-jump.png
```

---

# 17. Test Definition

Each feature specification must contain a test plan.

For MVP, the test plan can be translated into a feature-specific Playwright test manually.

Example:

```text
game/tests/F-001.spec.ts
```

Example conceptual test:

```text
launch game

assert game loaded

press Space

assert player leaves ground

press Space

assert player performs second jump

press Space

assert player does not perform third jump

capture screenshots
```

The MVP does NOT need an AI agent to dynamically generate Playwright tests.

That can be added later.

---

# 18. Test Report

Each run generates:

```text
runs/F-001/test-report.json
```

Example:

```json
{
  "feature": "F-001",
  "status": "passed",
  "tests": [
    {
      "name": "player can double jump",
      "status": "passed"
    },
    {
      "name": "third jump is prevented",
      "status": "passed"
    }
  ],
  "consoleErrors": [],
  "screenshots": [
    "startup.png",
    "double-jump.png",
    "third-jump.png"
  ]
}
```

---

# 19. Discord Test Result

After testing, the bot posts:

```text
🧪 F-001 — TEST RESULT

Status: ✅ PASSED

Tests:
✅ Player can jump
✅ Player can double jump
✅ Third jump prevented
✅ Jump resets after landing

Browser:
Chromium

Console errors:
0

Build:
SUCCESS

Git:
feature/F-001-double-jump
Commit: abc1234

Screenshots:
[attached screenshots]

Ready for review.

[Merge] [Reject]
```

If testing fails:

```text
🔴 F-001 — TEST FAILED

Failed:
❌ Third jump was possible

Console errors:
0

Screenshots:
[attached]

The feature has NOT been merged.
```

---

# 20. Human Review

After successful testing, the feature enters:

```text
READY_FOR_REVIEW
```

Discord provides:

```text
🎮 F-001 — READY FOR REVIEW

Implementation: complete
Build: passed
Tests: passed

[Merge] [Reject]
```

No automatic merge.

---

# 21. Merge

When the user clicks `Merge`:

1. Verify feature is `READY_FOR_REVIEW`.
2. Verify branch exists.
3. Verify tests passed.
4. Merge branch into `main`.
5. Record merge commit.
6. Mark feature `MERGED`.
7. Delete feature worktree.
8. Optionally delete feature branch.

Discord:

```text
🟢 F-001 MERGED

Double Jump

Commit:
abc1234

Main branch updated.
```

---

# 22. Reject

When user clicks `Reject`:

1. Mark feature `REJECTED`.
2. Do not modify `main`.
3. Preserve logs/artifacts.
4. Remove worktree.
5. Optionally preserve branch.

Discord:

```text
⚪ F-001 REJECTED

Double Jump was not merged.

Main branch unchanged.
```

---

# 23. Revert

After a feature has been merged:

```text
/revert F-001
```

The orchestrator should:

1. Verify F-001 is merged.
2. Identify the merge/feature commit.
3. Create a revert commit.
4. Run the build.
5. Run tests.
6. Report the result.

Do not rewrite Git history.

Use a normal Git revert.

Discord:

```text
↩️ F-001 REVERTED

Double Jump has been reverted from main.

Revert commit:
def5678
```

---

# 24. Database

Use SQLite.

Minimum tables:

## features

```text
id
title
description
status
spec_path
branch_name
worktree_path
commit_hash
merge_commit_hash
created_at
updated_at
```

## runs

```text
id
feature_id
type
status
started_at
finished_at
logs_path
```

## test_results

```text
id
run_id
status
report_path
```

## artifacts

```text
id
run_id
type
path
```

---

# 25. Run Model

Every implementation/build/test operation should have a run ID.

Example:

```text
run_20260905_001
```

Directory:

```text
runs/F-001/run_20260905_001/
    cursor.log
    build.log
    test-report.json
    screenshots/
        startup.png
        double-jump.png
```

Never overwrite previous runs.

This provides a basic development history.

---

# 26. Configuration

Use environment variables.

Example:

```text
DISCORD_TOKEN=
DISCORD_CHANNEL_ID=
PROJECT_ROOT=
GAME_ROOT=
CURSOR_COMMAND=
DATABASE_PATH=
```

Do not commit `.env`.

Provide:

```text
.env.example
```

Never send these values to the AI agent or Discord.

---

# 27. Error Handling

Every external process must have:

- timeout
- exit-code handling
- stdout capture
- stderr capture
- cleanup

Processes that must be cleaned up:

```text
Cursor
Godot build
HTTP server
Chromium
Playwright
```

If a process crashes, the orchestrator must still attempt cleanup.

---

# 28. Concurrency

The MVP supports only:

```text
ONE ACTIVE IMPLEMENTATION
```

If another implementation is requested while one is running:

```text
⏳ Another feature is currently being implemented.

Feature:
F-001 — Double Jump

Please wait until it completes.
```

Do not implement parallel agents yet.

The architecture should nevertheless make it possible later.

---

# 29. Security Requirements

The Cursor agent has access to the game repository.

It must NOT have access to:

- Discord bot token
- database credentials
- cloud credentials
- SSH keys
- personal files

The game project should not contain secrets.

The orchestrator must validate all paths before passing them to shell commands.

Do not construct unsafe shell commands by concatenating arbitrary Discord input.

Prefer `spawn()`/argument arrays rather than shell interpolation.

---

# 30. Logging

All major events should be logged.

Example:

```text
[15:00:01] Feature F-001 created
[15:00:08] Specification generated
[15:01:12] Feature approved
[15:01:13] Creating worktree
[15:01:14] Starting Cursor
[15:05:42] Cursor finished
[15:05:43] Starting Godot build
[15:05:59] Build succeeded
[15:06:01] Starting browser
[15:06:17] Tests passed
[15:06:18] Screenshots captured
[15:06:20] Discord result posted
```

---

# 31. Discord UI

Prefer Discord buttons over requiring commands for state transitions.

Example:

```text
SPEC READY

F-001 — Double Jump

[Approve] [Request Changes] [Reject]
```

Then:

```text
IMPLEMENTATION COMPLETE

[Run Tests] [Reject]
```

Then:

```text
TEST PASSED

[Merge] [Reject] [View Logs]
```

Buttons should be disabled when their action is no longer valid.

---

# 32. Planner Architecture

The planner should be an abstraction:

```typescript
interface Planner {
  createSpec(feature: Feature): Promise<FeatureSpec>;
}
```

Initially it may use an LLM API directly.

Do not hard-code the rest of the application to a particular model provider.

Later we should be able to replace:

```text
Planner
```

with:

```text
OpenAIPlanner
CursorPlanner
LocalPlanner
HumanPlanner
```

without changing the feature state machine.

---

# 33. Coding Agent Architecture

Create an abstraction:

```typescript
interface CodingAgent {
  implement(input: ImplementationRequest): Promise<ImplementationResult>;
}
```

Initial implementation:

```text
CursorCodingAgent
```

The rest of the orchestrator must not depend directly on Cursor CLI details.

---

# 34. Tester Architecture

Create:

```typescript
interface GameTester {
  test(input: TestRequest): Promise<TestResult>;
}
```

Initial implementation:

```text
PlaywrightGameTester
```

Later we can add:

```text
AIVisualTester
HumanTester
PerformanceTester
```

---

# 35. Git Architecture

Create:

```typescript
interface GitService {
  createFeatureWorktree(...);
  commit(...);
  merge(...);
  revert(...);
  removeWorktree(...);
}
```

All Git operations should be centralized here.

Do not execute random Git commands throughout the codebase.

---

# 36. Orchestrator

Create a central service:

```typescript
class FeatureOrchestrator {
  plan(featureId)
  approve(featureId)
  implement(featureId)
  build(featureId)
  test(featureId)
  merge(featureId)
  reject(featureId)
  revert(featureId)
}
```

The orchestrator is responsible for enforcing the state machine.

Discord should call the orchestrator.

It should NOT contain business logic.

Example:

```text
Discord interaction
       ↓
FeatureOrchestrator
       ↓
GitService
       ↓
CodingAgent
       ↓
GodotBuilder
       ↓
GameTester
       ↓
ArtifactManager
       ↓
Discord
```

---

# 37. MVP Acceptance Test

The MVP is complete only when the following works end-to-end.

Start with a simple Godot game.

The game contains:

- player
- floor
- basic movement
- camera
- visible background

In Discord:

```text
/feature Add a double jump to the player
```

Then:

```text
/spec F-001
```

Approve it.

Then:

```text
/implement F-001
```

The system must automatically:

```text
create worktree
       ↓
run Cursor
       ↓
modify Godot project
       ↓
commit implementation
       ↓
export Web build
       ↓
start local server
       ↓
launch Chromium
       ↓
run test
       ↓
take screenshots
       ↓
post result to Discord
```

The Discord channel should contain the screenshots showing the implemented feature.

Then click:

```text
[Merge]
```

The feature must be merged into `main`.

Then:

```text
/revert F-001
```

The system must revert it.

This is the MVP.

---

# 38. Recommended Implementation Order

Implement in this exact order.

## Step 1 — Discord skeleton

Create bot.

Implement:

```text
/status
```

Verify Discord connectivity.

---

## Step 2 — Git service

Implement:

```text
create branch
create worktree
commit
merge
revert
remove worktree
```

Test independently.

---

## Step 3 — Cursor adapter

Implement:

```text
CursorCodingAgent
```

Give it a trivial task.

Verify it can modify the game repository.

---

## Step 4 — Godot builder

Implement:

```text
GodotBuilder
```

Verify:

```text
Godot project → Web build
```

---

## Step 5 — Browser runner

Implement:

```text
local server
Playwright
Chromium
screenshot
```

Verify the unmodified game can be opened and photographed automatically.

---

## Step 6 — Feature pipeline

Connect:

```text
feature
→ worktree
→ Cursor
→ build
→ test
→ screenshots
```

---

## Step 7 — Discord reporting

Send:

```text
implementation status
build status
test status
screenshots
```

to Discord.

---

## Step 8 — Human approval

Add:

```text
Approve
Merge
Reject
Revert
```

buttons.

---

## Step 9 — Planner

Add:

```text
feature description
→ LLM
→ Markdown spec
```

Only after the technical pipeline works.

---

# 39. Future Architecture

The MVP should leave room for:

```text
                   DISCORD
                       │
                       ▼
                 ORCHESTRATOR
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
       PLANNER       CODER          QA
          │            │             │
          ▼            ▼             ▼
        SPEC        CURSOR       PLAYWRIGHT
                       │             │
                       └──────┬──────┘
                              ▼
                           GODOT
                              │
                              ▼
                           WEB GAME
                              │
                              ▼
                         SCREENSHOTS
                              │
                              ▼
                           DISCORD
```

Eventually add:

```text
AI Game Designer
AI Level Designer
AI Art Director
AI QA Agent
AI Playtester
AI Code Reviewer
AI Release Manager
```

But all of these should plug into the same orchestrator/state-machine architecture.

---

# 40. Design Principle

The most important architectural rule is:

> **LLMs propose and reason. Deterministic software executes and controls state. Humans approve important product decisions.**

Therefore:

```text
LLM:
"What should we build?"

LLM:
"How should this feature work?"

LLM:
"How should I implement it?"

LLM:
"Does this look correct?"

Orchestrator:
"Are you allowed to do that?"

Orchestrator:
"Which branch?"

Orchestrator:
"Did the build succeed?"

Orchestrator:
"Did the tests pass?"

Orchestrator:
"Can this be merged?"

Human:
"Do we actually want this game feature?"
```

This separation should be preserved throughout the project.