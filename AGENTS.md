# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds


## Pipeline Protocol — THE GATE

All non-trivial work goes through the build pipeline. **No pipeline build step = no code.**

### Before You Write a Single Line

Check if a build step is open and assigned to you:

```bash
bd kv get pipeline.wisp        # Get the current pipeline mol ID
bd mol current <wisp-id>       # See where we are in the pipeline
```

If no build step is `[ready]` or `[in_progress]` for you — **stop**. Talk to Nagatha or Bill.

### Agent Startup Checklist (when a build step IS open)

```bash
bd update <build-step-id> --status=in_progress   # Claim the step
bd agent state <your-agent-id> working           # Register as active
bd kv set pipeline.wisp <wisp-id>               # Confirm wisp ref
# Every 30 min during long sessions:
bd agent heartbeat <your-agent-id>
```

Read `CLAUDE.md` fully before writing any code. The spec is the contract.

### During the Build

- `go test ./... must pass` before every commit (or `cargo test` for Rust)
- `golangci-lint run` must be clean (or `cargo clippy`)
- Small, focused commits — one concern per commit
- Open PR against `main` when done: `gh pr create`

### Session Close Protocol (MANDATORY — do not skip)

```bash
bd agent state <your-agent-id> done    # Mark yourself inactive
bd sync                                # Sync beads DB
git push                               # Push is NOT optional
bd close <build-step-id>              # Close the build step
```

Work is **not done** until `git push` succeeds and the build step is closed. Unpushed = stranded.

