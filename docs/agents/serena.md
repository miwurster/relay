# Serena MCP

How coding agents should use the Serena MCP server when working in this repo.

Serena provides semantic code understanding — symbol lookup, reference finding, and structure-aware edits — through a language backend (LSP or a JetBrains IDE).
It is far cheaper and more precise than reading whole files or grepping when you need to navigate or change code by symbol.

## Prefer Serena first

When the Serena MCP server is available, prefer Serena tools first for:

- symbol lookup
- reference finding
- semantic code navigation
- targeted edits and refactors
- understanding project structure

Use Serena before reading large files line-by-line or doing broad text searches.

## When to fall back

Fall back to normal file reads, grep/ripgrep, or generic editing tools only when:

- Serena is unavailable
- Serena cannot answer the task
- the task is simpler without Serena

## Refactors

Before making large refactors, first use Serena to inspect the relevant symbols and their references.

## Make it visible

If Serena is available, mention in your plan that you are using Serena for semantic code navigation.

## Setup

Serena's machine-level config (`~/.serena/serena_config.yml`) and the `kipu-serena` plugin are set up by the `setup-kipu-plugins` skill, not here.
If Serena tools are not reachable, run `setup-kipu-plugins`.
