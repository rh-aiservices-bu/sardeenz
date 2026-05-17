---
description: Execute implementation tasks using a Team of Agents for parallel execution of independent work streams
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Role

You are the **Team Lead / Orchestrator**. You do NOT write implementation code yourself. You create the task graph, spawn workers, validate checkpoints, and manage the team lifecycle.

## Outline

### Step 1: Initialize Feature Context

Run `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` from repo root. Parse FEATURE_DIR and AVAILABLE_DOCS. All paths must be absolute.

For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

### Step 2: Check Checklists (if FEATURE_DIR/checklists/ exists)

Scan all checklist files. Count `- [ ]` (incomplete) and `- [X]`/`- [x]` (complete) items.

- If any checklist is incomplete: display status table and ask user whether to proceed
- If all complete or no checklists directory: proceed automatically

### Step 3: Load Planning Artifacts

Read the following files to build your orchestration plan:

- **REQUIRED**: `tasks.md` — task list, phases, dependencies, parallel markers
- **REQUIRED**: `plan.md` — tech stack, architecture, file structure
- **IF EXISTS**: `data-model.md`, `contracts/`, `research.md`, `quickstart.md`

**You are loading these for orchestration decisions only.** Workers will read relevant sections themselves.

### Step 4: Project Setup Verification

Same as the standard implement skill: verify/create ignore files (.gitignore, .dockerignore, .eslintignore, .prettierignore, etc.) based on detected project tech stack from plan.md. See the standard `/speckit.implement` skill for the full pattern lists.

### Step 5: Analyze Dependency Graph

Parse `tasks.md` and build a dependency model:

1. **Identify phases** and their sequential dependencies (Phase N blocks Phase N+1 unless tasks.md specifies otherwise)
2. **Identify parallel opportunities** within and across phases:
   - Tasks marked `[P]` within a phase can run concurrently
   - User stories explicitly marked as parallelizable (e.g., "US1 and US2 can be developed in parallel")
   - Backend vs frontend task streams within a single user story
3. **Identify phase gate checkpoints** — points where validation must pass before proceeding
4. **Determine max concurrency** — how many workers are useful at peak parallelism (cap at 3 workers to balance throughput vs coordination overhead)

Output a brief dependency summary for the user showing:
- Phase execution order
- Parallel streams identified
- Estimated worker count per phase
- Phase gate validation strategy

### Step 5b: File Overlap Matrix (MANDATORY)

**This step is critical for preventing file conflicts.** Before creating any tasks:

1. **Extract target files** from every task in tasks.md (the file paths in each task description)
2. **Build a file-to-tasks matrix**: for each file, list all task IDs that modify it
3. **Identify contested files**: any file modified by 2+ tasks
4. **Detect cross-stream conflicts**: when tasks from parallel phases/streams (e.g., US1 and US2) target the same file
5. **Override [P] markers**: if two tasks marked `[P]` target the same file, they MUST be serialized (add blockedBy)
6. **Output the conflict table** to the user:

```
File Overlap Matrix:
| File | Tasks | Phases | Conflict? | Resolution |
|------|-------|--------|-----------|------------|
| cluster.ts | T011,T028-T030,T034-T036,T051,... | 2,5,6,7,8,9,10 | YES (US1+US2 parallel) | T051 blockedBy T036 |
| internal.ts | T010,T020-T022,T031-T033,... | 2,3,5,9 | NO (phases sequential) | Phase gates sufficient |
```

**If cross-stream file conflicts exist**, add explicit `blockedBy` constraints to serialize the conflicting tasks, even if they're in "parallel" phases. Document each override.

### Step 5c: Same-File Task Grouping (MANDATORY)

When 2+ **consecutive, sequential** (non-[P]) tasks in tasks.md modify the **same file**, group them into a **single TaskCreate**. This is mandatory, not optional.

**Why**: Workers re-read the file for each task. Grouping preserves context, reduces claim/read overhead, and eliminates intra-group race conditions.

**Examples of mandatory grouping:**
- T012 + T013 + T014 → one task (all `peer-discovery.ts`)
- T015 + T016 → one task (both `leader-election.ts`)
- T017 + T018 → one task (both `heartbeat.ts`)
- T044 + T045 + T046 + T047 + T048 + T049 → one task (all `proxy-router.ts`)

**Do NOT group** tasks that are in different phases, different user stories, or modify different files.

Estimated impact: reduces ~86 individual tasks to ~55-65 grouped tasks.

### Step 6: Create Team

```
TeamCreate:
  team_name: "implement-{feature-id}"  (e.g., "implement-004")
  description: "Implementation of {feature name} per tasks.md"
```

### Step 7: Populate Task Graph (Phased Creation)

Convert `tasks.md` into TaskCreate calls with proper dependency chains.

**IMPORTANT: Create tasks phase-by-phase, not all at once.** This preserves lead context and allows task descriptions to reference code from completed phases.

- Create Phase 1 tasks → execute Phase 1 → create Phase 2 tasks → execute → ...
- For parallel phases (e.g., Phase 5+6), create both phases' tasks together after the prerequisite gate passes

**Task creation rules:**

1. **One TaskCreate per grouped task unit** (see Step 5c for grouping rules)
2. **Set `blockedBy`** based on:
   - Phase ordering: all Phase N+1 tasks blocked by the Phase N gate task
   - **[P] tasks**: blocked by the phase gate AND the last non-[P] task preceding them within the phase. Example: if Phase 2 has T006 (non-[P]), T007 [P], T008 [P], T009 [P], then T007/T008/T009 are ALL `blockedBy: [T006]`
   - Non-[P] tasks: blocked by their predecessor within the phase
   - **Cross-stream file conflicts**: blockedBy constraints from Step 5b override parallel markers
   - Cross-phase explicit dependencies from tasks.md dependency section
3. **Include in each task description:**
   - The original task ID(s) from tasks.md (e.g., "T012, T013, T014")
   - Exact file paths to create/modify
   - Which spec artifacts to reference with absolute paths (e.g., "read `{FEATURE_DIR}/data-model.md` PeerInfo entity")
   - **Context loading checklist** for complex tasks: ordered list of source files the worker MUST read before implementing (including files created by earlier tasks)
   - Acceptance criteria derived from the task description
   - **The absolute path to FEATURE_DIR** so workers can read specs themselves
4. **Create phase gate tasks** — synthetic validation tasks at the end of each phase:
   - Subject: "GATE: Phase {N} validation"
   - Description: "Run build commands in workspace order: `npm run build -w packages/types && npm run build -w packages/utils && npm run build -w apps/backend` (add `&& npm run build -w apps/frontend` if frontend tasks were in this phase). Then run `npm run lint`. Verify phase checkpoint criteria from tasks.md."
   - These gate tasks are blocked by all tasks in their phase
   - All next-phase tasks are blocked by the gate task

### Step 8: Spawn Workers

Spawn `general-purpose` agents as team members.

**Spawning strategy:**

- **Sequential phases** (most phases): Spawn 1 worker
- **Parallel phases** (e.g., US1 + US2 streams): Spawn 2 workers (one per stream)
- **High-parallelism testing phases**: Spawn up to 3 workers
- **Never exceed 3 workers** — the dependency graph rarely supports more than 2 truly independent streams, and coordination overhead grows quadratically

**IMPORTANT — Lead-assigned task dispatch:** The lead MUST assign tasks to specific workers using TaskUpdate with `owner`, rather than letting workers self-claim. This eliminates race conditions where two workers claim the same task. Workers should only self-claim when explicitly told "check TaskList and pick your next task."

**Worker prompt template:**

```
You are a worker agent on team "{team_name}". Your name is "{worker-name}".

## Your Workflow

1. Wait for the lead to assign you a task (you will receive a message)
2. Call TaskGet with the assigned task ID to read full requirements
3. Read the spec/design files referenced in the task description (absolute paths provided)
4. Read ALL source files listed in the task's "Context Loading Checklist" (if present)
5. Read any existing files before modifying them — NEVER edit a file you haven't read
6. Implement the task following the description and acceptance criteria
7. After implementation, verify your work:
   - If you created/modified TypeScript files: run `npx tsc --noEmit` in the relevant workspace
   - If a task involves packages/types: run `npm run build -w packages/types`
   - Do NOT run `npm install` unless the task explicitly requires it
8. Mark the task completed: TaskUpdate with status: "completed"
9. Send a message to "lead" confirming completion with a brief summary of what you did
10. Wait for the lead to assign your next task
11. Repeat until you receive a shutdown request

## Rules

- ALWAYS read files before editing them
- ALWAYS use absolute paths
- Follow existing code patterns and conventions in the project
- Reference the project's CLAUDE.md at /workspace/CLAUDE.md for project-specific rules
- If you encounter a blocker, message "lead" immediately with details — do NOT guess
- Do NOT create new files unless the task explicitly calls for it
- Do NOT modify files outside the scope of your current task
- Do NOT run `npm install` unless your task specifically adds a dependency
- Do NOT mark tasks.md checkboxes — the lead handles progress tracking
- When implementing, read existing code in the same directory to match patterns (class structure, logger injection, export style)
```

**Worker naming convention:** Use descriptive names based on their assigned stream:
- `backend-1`, `backend-2` — for backend implementation streams
- `frontend-1` — for frontend implementation
- `tester-1`, `tester-2` — for testing phases

### Step 9: Orchestration Loop

As Team Lead, your main loop is:

```
WHILE tasks remain incomplete:
  1. Wait for teammate messages (automatic delivery)

  2. On task completion message:
     a. Acknowledge the worker
     b. Check TaskList — are there unblocked tasks for this worker?
        - YES: Assign the next task via TaskUpdate(owner) + DM with task ID
        - NO: Is a phase gate now unblocked? Execute validation (Step 10)
     c. Every 5 task completions: report progress to user

  3. On worker "waiting for work" message:
     a. Check TaskList for unblocked, unowned tasks
     b. If available: assign via TaskUpdate(owner) + DM
     c. If no tasks available: shutdown the worker (SendMessage shutdown_request)

  4. On worker "blocker" message:
     a. Assess the blocker — read the relevant file if needed
     b. If it's a missing dependency: check if another worker is handling it
     c. If it's a bug in prior work: create a fix task, assign to a worker
     d. If it requires user input: ask the user

  5. On phase gate completion:
     a. Create next phase's tasks (phased creation — Step 7)
     b. Assign first tasks to available workers
     c. Scale workers up/down for new phase's parallelism
     d. Report phase completion to user

  6. Context checkpoint (every 10 task completions):
     a. Summarize completed work to the user
     b. List remaining phases and task counts
     c. This keeps the lead's context focused on what's ahead, not behind
```

### Step 10: Phase Gate Validation

When a phase gate task becomes actionable, execute validation yourself (as lead):

**Validation steps:**
1. Run workspace builds in dependency order:
   ```
   npm run build -w packages/types && npm run build -w packages/utils && npm run build -w apps/backend
   ```
   Add `&& npm run build -w apps/frontend` if frontend files were modified in the phase.
2. Run `npm run lint` (if configured)
3. Check the phase checkpoint criteria from tasks.md

**On validation failure — diagnosis process:**
1. Parse the error output — TypeScript errors include `file:line:column`
2. Map the error file to the task that last modified it (check git blame or your task-to-file mapping from Step 5b)
3. Create a fix task with:
   - The error output
   - The file path
   - Context about what the original task was supposed to do
4. The fix task blocks the gate; the gate blocks all next-phase tasks
5. Assign the fix task to a worker (preferably the one who wrote the original code, if still active)

**On validation success:**
- Mark the gate task as completed
- Proceed to create next phase's tasks (Step 7, phased creation)
- Report phase completion to user
- Adjust worker count for next phase's parallelism needs

### Step 11: Dynamic Worker Scaling

Monitor the task graph and scale workers:

- **Scale up** when entering a parallel phase: spawn additional workers BEFORE creating that phase's tasks, so workers are ready when tasks are created
- **Scale down** when entering a sequential phase: shutdown excess workers
- **Shutdown idle workers** gracefully via SendMessage type: "shutdown_request"
- **Never leave workers idle for more than 1 completed phase** — shut them down and respawn when needed
- **Typical scaling pattern**: 1 worker → (sequential phases) → 2 workers → (parallel phase) → 1 worker → (sequential) → 3 workers → (testing phase)

### Step 12: Progress Tracking

The lead (not workers) manages progress in tasks.md:

- After each phase gate passes, mark all completed tasks as `[X]` in `{FEATURE_DIR}/tasks.md` in a single edit
- This prevents file conflicts from multiple workers writing to tasks.md simultaneously
- Commit after each phase gate: `git add -A && git commit -m "feat({feature}): complete Phase {N} — {phase description}"`
- These per-phase commits create clean rollback points

### Step 13: Completion

When all tasks are complete:

1. Run final validation: `npm run build && npm run lint && npm run test`
2. Report final summary to user:
   - Total tasks completed
   - Phases completed
   - Any issues encountered and how they were resolved
   - Files created/modified
3. Shutdown all workers via SendMessage type: "shutdown_request"
4. Wait for all shutdown confirmations
5. Clean up: TeamDelete

## Key Differences from Single-Agent Implementation

| Aspect | Single Agent | Team Implementation |
|--------|-------------|-------------------|
| Execution | Sequential, one task at a time | Parallel workers on independent streams |
| Context | Single window, gets compressed | Each worker has fresh context per task |
| Parallelism | Only parallel tool calls | True parallel agents on different files |
| Validation | End-of-phase manual checks | Automated gate tasks in dependency graph |
| Scaling | Fixed single agent | Dynamic worker count based on phase |
| Failure handling | Halt everything | Isolate failure, other workers continue |
| Progress | Implicit via conversation | Explicit via shared task list |
| Rollback | No clean points | Per-phase commits |

## Anti-Patterns to Avoid

1. **Do NOT implement code yourself as Team Lead** — your job is orchestration
2. **Do NOT spawn more than 3 workers** — coordination overhead grows quadratically; most task plans have at most 2 truly independent streams
3. **Do NOT skip phase gates** — they catch integration issues early
4. **Do NOT let workers self-claim tasks** — the lead assigns tasks to prevent race conditions (no atomic claim mechanism exists)
5. **Do NOT let workers modify the same file simultaneously** — the Step 5b file overlap matrix MUST be computed before task creation. Override [P] markers when tasks share a file.
6. **Do NOT broadcast when a DM suffices** — broadcasts are expensive (N messages for N workers)
7. **Do NOT create all tasks upfront** — create tasks phase-by-phase to preserve lead context and allow task descriptions to reference code from completed phases
8. **Do NOT skip the file overlap matrix (Step 5b)** — this is the single most important step for preventing file conflicts. Cross-stream conflicts on shared files (e.g., `cluster.ts` across US1+US2) will cause silent data loss.
9. **Do NOT let workers update tasks.md checkboxes** — the lead does this in bulk after each phase gate to avoid write conflicts
10. **Do NOT skip per-phase commits** — they create rollback points for debugging regressions discovered in later phases
