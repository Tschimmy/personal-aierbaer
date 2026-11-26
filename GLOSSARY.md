# Personal Aierbaer

A personal support desk: it turns the support tickets assigned to one engineer into AI-drafted solution reports, and remembers which fix actually worked so later solves can reuse it.

## Tickets and the inbox

**Ticket**:
One support request from ClickUp that the engineer may have to answer or fix.
_Avoid_: task (except when talking about ClickUp itself), issue

**Owner**:
The engineer a **Ticket** is assigned to, as set in ClickUp's "Owner" field. The app only shows Tickets of one Owner.
_Avoid_: assignee

**Inbox**:
The list of open **Tickets** for the configured **Owner**, with each Ticket's **Report** and **Resolution** state.
_Avoid_: queue, task list

## Solving

**Solve**:
One run of the **Solve skill** on a **Ticket** that produces a **Report**. A Solve that ends without a Report has failed.
_Avoid_: analyze, run

**Auto-solve**:
A **Solve** started by the app, once, for a new **Ticket** that has no **Report** yet.

**Solve skill**:
The Claude Code skill (`clickup-aierbaer-solve`) that tells the agent how to analyze a **Ticket** and write its **Report**.
_Avoid_: prompt

**API skill**:
The Claude Code skill (`aierbaer-api`) that teaches other coding agents how to use the **Local API**.

**Model**:
The Claude model a **Solve** runs on, picked by alias (`opus`, `sonnet`, `haiku`).

**Repository**:
The product codebase a **Solve** reads to ground its **Report**.
_Avoid_: project, workspace

## Reports and the memory loop

**Report**:
The markdown document a **Solve** writes for one **Ticket**: Problem, Type, Root cause, **Options**, Open questions and a **Verdict**. Only the newest Report of a Ticket counts.
_Avoid_: solution, proposal, analysis

**Option**:
One proposed fix inside a **Report**, labelled by letter ("Option A", "Option B"). Option A is the recommended one.
_Avoid_: solution, alternative

**Verdict**:
The **Report**'s closing recommendation of which **Option** to take, or which earlier **Resolution** to reuse.

**Resolution**:
The engineer's record of how a **Ticket** was really fixed: the **Chosen option**, the date and free notes. It lives at the end of the Ticket's **Report**.
_Avoid_: solution, real reason, status

**Chosen option**:
The **Option** a **Resolution** names as the real fix, or "Other" when none of the Options fit.

**Resolved**:
A **Ticket** whose newest **Report** has a **Resolution**. Independent of the Ticket's status in ClickUp.
_Avoid_: solved, done, closed

**Reports directory**:
The folder that holds every **Report**. It is also the memory a **Solve** searches for earlier **Resolutions**.
_Avoid_: memory repo, history

## Integration

**Local API**:
The HTTP interface on localhost that lets other tools read the **Inbox**, **Reports** and **Resolutions** and start a **Solve**.

**API token**:
The shared secret every **Local API** call except health must send.

**Deep link**:
An `aierbaer://` URL that brings the app to front and opens or **Solves** one **Ticket**.

**Runtime config**:
The settings the **Local API** acts with (ClickUp access, **Owner**, **Model**, **Repository**, **Reports directory**), handed over by the app's UI.
