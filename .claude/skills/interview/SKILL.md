---
name: interview
description: How to ask Luke anything on DEBASER_OS - an interview for a SPEC, a choice between approaches, a database or delete approval. Always the multiple-choice question box (AskUserQuestion), recommendation first, each option saying what he will see, referenced to the SPEC or earlier decision, never asking twice. Use whenever a question for Luke is about to be written, or a builder needs to send the coordinator questions to ask him.
---

# Asking Luke

Luke's rule (2026-11-27): interviews are "always given as well thought out and referenced multiple choice selection
prompts". He answers from his phone, so every question must stand on its own.

## Before asking
1. Look it up first: `docs/decisions.md`, the area's SPEC ("Decisions" sections), the brief, and
   `node scripts/ctx.cjs <topic>`. If it is answered there, don't ask: say "decided <date>: <his words>" and carry on.
2. If a safe, easily changed default exists, take it and name it in the report instead of asking.
3. Batch: up to 4 questions per box, the most important first. Ask only what is his to decide (taste, what he'll see,
   money, risk, his accounts, database changes, deletes), never what the code or docs can settle.

## Who asks
- The coordinator, or a session Luke opened himself: the box (AskUserQuestion), directly.
- A session the coordinator started: never the box. Send the coordinator the questions already in the shape below
  (Luke, 2026-11-27: "Everything via coordinator"). It asks them as written and relays the answers word for word.

## Each question
- `question`: one sentence that stands alone: name the feature and the thing ("BROWSER: when a site refuses to be
  framed, what should the page do?"), never "the above" or "option 2 from my plan".
- `header`: 12 characters or fewer.
- 2 to 4 options. The first is your recommendation, its label ending "(Recommended)".
- Each option's `description`: what Luke will SEE or what happens, in plain English; the cost or risk in a few words;
  for the recommended one, one line of why.
- References: name the SPEC section or decision it touches ("changes SPEC-rooms-queues.md decision 4, 2026-11-14").
- A visual choice may use `preview` (a short mock in text) instead of sending pictures.
- Don't add an "Other" option: the box always offers one.

## After the answer
- Write his answer down in his words, dated, where it governs: the SPEC's decisions section for a feature, a line in
  `docs/decisions.md` for how work is done, in the same commit as the work.
- Relaying (coordinator): quote exactly, `LUKE, <date>, to "<question>": "<chosen label>" (+ his note, if any)`. That
  quote is what makes it count as his own word for a database change or a delete (`docs/sessions.md`).
- If he picks "Other" with free text, quote the text as given; if it is unclear, ask once more, better.

## A SPEC interview
Edge cases, how it should feel, what's out of scope, what he'll see first. Several rounds of up to 4 questions, each
round built on the last answers. Then write `SPEC-<name>.md` (goal, his words, decisions with dates, build steps,
proof, out of scope), add it to `docs/INDEX.md` (`node scripts/ctx.cjs --index`) and stop so he can start a fresh
session to build it.
