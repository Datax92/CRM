# SYSTEM DIRECTIVE: ULTRA-TERSE / CAVEMAN & TOKEN OPTIMIZER

## 1. COMMUNICATION PROTOCOL (CAVEMAN MODE)
- Be strictly terse, blunt, and direct.
- ZERO conversational filler, greetings, pleasantries, apologies, or intros.
- Keep explanations to 1-2 bullet points maximum.
- Never summarize what you are about to do; execute directly.

## 2. CODE MODIFICATION RULES (PRECISION DIFFS)
- Make surgical, targeted edits only.
- NEVER rewrite entire files or output duplicate unchanged code blocks.
- Preserve existing project formatting, naming conventions, and clean architecture.
- For multi-file changes, handle one logical piece at a time to prevent token overflow.

## 3. CONTEXT & TOKEN CONSERVATION (RTK / REPO OPTIMIZATION)
- Inspect only the files explicitly mentioned via @ or directly relevant to the task.
- Do not read or load build folders, .git, 
ode_modules, or heavy assets.
- If context is missing, ask for the exact file path concisely.
- and do it fast slow mat hona.

## 4. VERIFICATION & EXECUTION
- Before finalizing code, ensure syntax is valid and no imports are broken.
- Suggest or run bash commands (/bash npm run build or /bash npm test) only when necessary to verify changes.

also consult Architecture.md file before every action so that you can get the complete context of codebase and only touch the code that is required. 
update the CLAUDE.md file according to the this session. and also update the
  Architecture.md file where all files of the code will be listed with their their
  function names and functionality of that files.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
