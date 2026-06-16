# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Start Reminder

At the start of every new work session, remind the user to sync with upstream before creating any branch or making any changes:

```
git checkout main && git pull origin main && git status
```

Do **not** run this automatically. Ask the user first: "Would you like me to run `git checkout main && git pull origin main && git status` before we begin?"

@AGENTS.md
