---
name: vektor-loop
description: >-
  Autonomous goal-based engineering loop for Vektor Terminal (tdmdne/Screener).
  Drives iterative plan -> implement -> verify -> audit -> self-improve cycles using
  .agents/PLAYBOOK.md, .agents/LOOP-STATE.md, and .agents/toolbox/ until DONE MEANS passes 100%.
---

# Vektor Autonomous Loop Engineering Skill

Follow this protocol whenever running an autonomous build, refactor, or UI-polish loop on `tdmdne/Screener`.

## Core Files (Read First Every Iteration)
1. `AGENTS.md` (hard rules: §0 Zero Frontend Logic, §3 No Paywalls, §6 Institutional UI)
2. `STATE.md` (repo-wide status)
3. `.agents/PLAYBOOK.md` (goal, rules, toolbox references, `DONE MEANS` proof checklist, learned rules)
4. `.agents/LOOP-STATE.md` (current iteration, active queue, audit scores, blockers)

## Iteration Cycle
1. **Select Next Queue Item:** Pick the highest-priority unchecked item in `.agents/LOOP-STATE.md`.
2. **Branch Hygiene:** Ensure work is on a feature branch (NEVER `main`). Never run `git push` or create a PR without Tyler's explicit confirmation.
3. **Delegate & Parallelize Cleanly:**
   - Use `backend-architect` for `workers/market/`, `shared/`, `functions/`, and Node/contract tests.
   - Use `ui-craftsman` (with `apple-institutional-design` skill) for visual/UX/CSS/presentation overhauls.
   - Never assign overlapping files to parallel agents.
4. **Verify via Toolbox (Proof Gate):**
   - Run `npm.cmd test` (or targeted + full suite on Windows PowerShell).
   - Run Playwright visual + DOM audit (`1440×900` desktop & `375×812` phone) via `qa-auditor`.
   - Visually inspect screenshots against `apple-institutional-design/SKILL.md`.
   - Check third-party network egress & banned client math identifiers.
5. **Self-Improve the Playbook:**
   - Whenever an agent hits a subtle bug, test quirk, or visual regression, append a crisp 1-line rule to **Learned Guardrails** in `.agents/PLAYBOOK.md` so the system permanently improves.
6. **Update State & Loop:**
   - Update `.agents/LOOP-STATE.md` (and `STATE.md` / `docs/architecture/TASKS.md` when a milestone closes).
   - If any `DONE MEANS` criterion fails, fix and repeat immediately.
   - Stop ONLY when all `DONE MEANS` criteria pass 100% (or when hitting a Tyler confirmation gate: `git push`, paid spend, or OAuth login).
