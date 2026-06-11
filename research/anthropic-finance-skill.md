# Anthropic Finance "Profession" Skill — Research & Install Report

_Date: 2026-06-11_

## TL;DR

Anthropic shipped (early May 2026) **"Claude for Financial Services"** — a set of reference
**agents/skills organized by financial role/vertical**. They live in the public GitHub repo
**`anthropics/financial-services`** (Apache 2.0). I installed the most broadly useful single
finance skill, **`dcf-model`** (DCF / discounted-cash-flow valuation), as a raw Claude Code
user skill on this PC.

- **Official Anthropic finance skill?** Yes.
- **Installed skill:** `dcf-model`
- **Install path:** `C:\Users\vital\.claude\skills\dcf-model\`
- **License:** Apache License 2.0 (freely usable).
- **Activation caveat:** A running Claude Code session will NOT see this new skill until it is
  **restarted/reloaded**. See "How to activate" below.

---

## 1. What was published

In early May 2026 Anthropic announced **Agents for Financial Services** (a.k.a. "Claude for
Financial Services"): ~10 named agents plus a library of pre-built **Agent Skills** framed around
financial **roles/professions** (the "professions" the user remembered).

- Announcement: https://www.anthropic.com/news/finance-agents
- Help / install guide: https://support.claude.com/en/articles/13851150-install-financial-services-plugins
- Main repo (skills + agents + connectors): **https://github.com/anthropics/financial-services**  (Apache 2.0)
- General skills repo (non-finance): https://github.com/anthropics/skills
- Cookbook example (financial modeling skill): https://github.com/anthropics/claude-cookbooks/tree/main/skills/custom_skills/creating-financial-models

The skills are distributed two ways:
1. **As Claude Code plugins / a marketplace** (the officially documented path), and
2. As **raw `SKILL.md` folders** inside the repo, which can be copied directly into
   `~/.claude/skills/` (the path I used, since the goal was a single finance skill, not the whole
   plugin bundle).

### Roles / verticals in the repo
- `financial-analysis` (core): DCF, comps, LBO, 3-statement model, Excel audit, deck QC
- `investment-banking`: CIMs, teasers, merger models, deal tracking
- `equity-research`: earnings notes, initiations, thesis tracking
- `private-equity`: sourcing, screening, IC memos, portfolio monitoring
- `wealth-management`: client reviews, financial planning, rebalancing
- `fund-admin`: GL reconciliation, accruals, NAV tie-out
- `operations`: KYC screening
- Partner verticals: `lseg` (LSEG), `sp-global` (S&P Global)

Named **agent plugins** (the "profession" framing): pitch-agent, market-researcher,
gl-reconciler, earnings-reviewer, model-builder, statement-auditor, kyc-screener, etc.

---

## 2. What I installed and why

**Skill: `dcf-model`** — from
`anthropics/financial-services/plugins/vertical-plugins/financial-analysis/skills/dcf-model`.

Chosen because DCF valuation is the single most iconic, self-contained, broadly-useful
finance-analyst skill, and it ships as a clean raw `SKILL.md` folder (no plugin/connector
dependency required to load it as a skill).

**Capabilities (from its SKILL.md):** builds institutional-quality DCF models for equity
valuation — retrieves financials from SEC filings/analyst reports, builds cash-flow projections
with proper WACC, runs sensitivity analysis, and outputs a professional Excel model with an
executive summary. Bundled files: `SKILL.md`, `TROUBLESHOOTING.md`, `requirements.txt`,
`scripts/validate_dcf.py`.

> Note: full execution of the model-building scripts expects Python deps (see
> `requirements.txt`) and works best with the financial-analysis connectors, but the skill itself
> loads and guides DCF work without them.

### Install details
- **Source:** https://github.com/anthropics/financial-services (Apache 2.0)
- **Method:** sparse `git clone` of the repo, copied ONLY the `dcf-model` folder.
- **Installed at:** `C:\Users\vital\.claude\skills\dcf-model\`
  - `SKILL.md`  (frontmatter `name: dcf-model` — matches folder name ✔)
  - `TROUBLESHOOTING.md`
  - `requirements.txt`
  - `scripts/validate_dcf.py`
- **Verified:** frontmatter is valid YAML with `name` + `description`; folder name == skill name.

---

## 3. How to activate it

Claude Code auto-discovers user skills from `C:\Users\vital\.claude\skills\<name>\SKILL.md` at
startup.

**IMPORTANT caveat:** the **currently running** Claude Code session will NOT list `dcf-model`
until you **restart / reload Claude Code** (skills are scanned at session start). After restart,
the skill activates automatically when a request matches its description (DCF / intrinsic value /
company valuation), or you can reference it explicitly.

To confirm after restart: run `/skills` (or the skills picker) and look for `dcf-model`.

---

## 4. Alternatives worth knowing (not installed)

Same source repo, same Apache-2.0 license, same raw-folder install method
(`plugins/vertical-plugins/financial-analysis/skills/<slug>`):

- **`comps-analysis`** — comparable-company (peer multiples) analysis → Excel.
- **`lbo-model`** — leveraged-buyout modeling (PE).
- **`3-statement-model`** — integrated income / balance-sheet / cash-flow model.
- **`audit-xls`** / **`clean-data-xls`** — Excel model auditing & data cleanup.
- **`competitive-analysis`**, **`ib-check-deck`**, **`deck-refresh`** — research & pitch QC.

**Official plugin/marketplace route** (alternative to raw-folder copy; installs whole bundles +
connectors — NOT run here, documented only):
```
claude plugin marketplace add anthropics/financial-services
claude plugin install financial-analysis@claude-for-financial-services
# named agents, e.g.:
claude plugin install market-researcher@claude-for-financial-services
```

Also note the general (non-finance) repo `anthropics/skills` with a marketplace:
`/plugin marketplace add anthropics/skills`.
