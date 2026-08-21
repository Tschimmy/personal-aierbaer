---
name: clickup-aierbaer-solve
version: 1.2.0
description: "Analyze a ClickUp task/issue and generate a markdown report suggesting possible solutions. Reads a pre-fetched task context file (description, comments, metadata) provided by the caller, reasons about root cause, and proposes concrete fixes. Use when user says \"solve\", \"clickup solve\", \"suggest solution\", \"analyze issue\", \"fix this ticket\", or wants automated solution proposals for a ClickUp task."
allowed-tools: Bash(curl:*), Bash(jq:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(cat:*), Bash(mysql:*), Read, Write
context: current
agent: general-purpose
user-invocable: true
---

# ClickUp Aierbaer Solve Skill

Analyze a ClickUp task and generate a structured markdown report that proposes **possible solutions** to the problem described in the ticket.

## Input

The caller provides the task **already fetched** — you do not query the ClickUp API yourself:
- A **context file path** containing the task info (name, status, priority, description, comments, tags, list/folder/space, URL). This is the primary input.
- An **output path** for the report.

The dashboard trigger fetches the task detail once (it holds the ClickUp token) and writes this context file, so the skill stays token-free and does no duplicate API calls.

If invoked manually without a context file, accept the task info inline in the prompt. Only fall back to the ClickUp API (`curl` with `$CLICKUP_TOKEN`) if neither is available.

## Process

### 1. Read Task Context

```bash
cat "<CONTEXT_FILE_PATH>"
```

The context file contains everything you need: task name, status, priority, description (markdown), comments, tags, and location (space/folder/list). Read it fully before reasoning.

### 2. Check Existing Solutions

Before analyzing from scratch, search the **existing reports directory** the caller
provides in the prompt ("Existing reports directory: <DIR>") for related, already-
handled issues:

```bash
# Search prior reports by keywords from the task (error messages, feature names, area)
rg -li "<keyword>" "<REPORTS_DIR>"
```

**Prioritize reports that contain a `## Resolution` section** — that records the
**actual** fix that worked (which option was chosen and why), so it is far more
trustworthy than an unverified proposal.

If a matching report exists:
- Read it and check whether the same root cause applies.
- If it has a `## Resolution`, reuse that fix: state in the **Verdict** that this was
  already solved, reference the report, and keep any new proposal minimal.
- If it only has proposals (no Resolution yet), reference it under "Related" and
  build on it instead of starting over.

Even partial matches are valuable — same area, same module, similar symptom.
Mention them under "Related" in the report.

### 3. Understand the Problem

From the description, comments, list/folder/space and tags, determine:

- **What is broken / requested?** Restate the problem in one or two sentences.
- **Is it a bug, feature, or investigation?** Bugs need root-cause; features need design; investigations need findings.
- **What system/area is affected?** Map ticket language to code areas.
- **What context is missing?** Note assumptions and open questions.

### 4. Ground in the Codebase (when relevant)

If the task references code, files, endpoints, error messages, or symbols, search the relevant repo(s) to ground the proposal in reality instead of guessing.

```bash
# Example: search for an error string or symbol mentioned in the ticket
rg -n "<error string or symbol>" --glob '!node_modules' <repo path>
```

Prefer concrete file paths + line references in the report. If no repo context is available or applicable, reason from the description alone and say so.

### 5. Verify Database Tables (when the solution touches the DB)

If your proposed solution references, queries, or modifies database tables, **do not assume the table exists or is named as you guessed**. Use the **mysql skill** to verify against the local eversports database (`~/.claude/skills/mysql/SKILL.md`).

```bash
# Does the table exist? (case-insensitive fuzzy check on the guessed name)
mysql -h 127.0.0.1 -P 3306 -u root eversports -t -e "SHOW TABLES LIKE '%<guessed_fragment>%'"

# Inspect the real schema before proposing columns/joins
mysql -h 127.0.0.1 -P 3306 -u root eversports -t -e "DESCRIBE <real_table_name>"
```

Rules:
- Confirm every table you name in the report actually exists. If it does not, find the **real** table name via `SHOW TABLES LIKE ...` and use that instead.
- Verify column names via `DESCRIBE` before referencing them in queries or migration steps.
- READ-ONLY only: `SHOW TABLES`, `DESCRIBE`, `SELECT ... LIMIT`. Never `INSERT/UPDATE/DELETE/DROP/ALTER`.
- In the report, state what you verified (e.g. "confirmed table `booking_customer` exists; the ticket's `bookingCustomers` was a guess"). If the DB is unreachable, say the table names are unverified assumptions.

### 6. Generate the Report

Write the report to the specified output path as markdown.

**Report Format:**

```markdown
# Solution Proposal: <TASK NAME>

**Task:** [<TASK_ID>](<URL>)
**Status:** <STATUS>  ·  **Priority:** <PRIORITY>
**Location:** <SPACE> / <FOLDER> / <LIST>
**Analyzed:** <TIMESTAMP>

## Problem

<1-2 sentence restatement of the problem in plain language>

<Any key details from description + comments that matter>

## Type

<Bug | Feature | Investigation> — <one line why>

## Root Cause / Analysis

<For bugs: most likely root cause(s), grounded in code refs where possible>
<For features: the core design decision(s) required>
<For investigations: what the data/description implies>

## Proposed Solutions

### Option A: <short title> (recommended)

<What to do, concretely. File paths + functions where known.>

**Effort:** <S/M/L>  ·  **Risk:** <low/med/high>

**Steps:**
1. ...
2. ...

### Option B: <short title> (alternative)

<Alternative approach and when to prefer it>

**Effort:** <S/M/L>  ·  **Risk:** <low/med/high>

## Open Questions

- <Anything blocking a confident answer — missing repro, unclear scope, etc.>

## Verdict

<One-paragraph recommendation: which option, and the smallest next step to unblock.>
```

### 7. Guidelines

- Always restate the problem first — proves you understood the ticket.
- Give **at least one concrete, actionable** solution. Prefer 2 (recommended + alternative) when the tradeoff is real.
- Ground claims in code with `file:line` refs whenever the repo is available; never invent file paths.
- Never assume DB table/column names — verify with the mysql skill (`SHOW TABLES LIKE`, `DESCRIBE`) and report the real names when your guess was wrong.
- Be explicit about assumptions and missing context in **Open Questions** — a good report can say "need repro steps" rather than bluffing.
- Keep effort/risk estimates honest and short.
- If the task is too vague to solve, say exactly what info would unblock it.
- Write as if handing the report to the engineer who will implement it.
