---
name: refactor
description: Reorganizes code in the connected folder so it is clearer and easier to maintain, without changing what it does. Use it when the user asks to refactor, clean up, simplify, split or reorganize code.
metadata:
  author: Nyra
  version: "1.0"
---

# Refactor

Improve the shape of the code without changing its behavior. Every step must leave the project working.

## Before touching anything

1. Read the code to change and who uses it: search the folder for its calls and imports.
2. Check whether tests cover it. If they don't, say so and suggest writing them before a large change.
3. If the user didn't say which part, ask; don't reorganize the whole project on your own.

## How to do it

- First explain the plan in a few lines: what is wrong now and how it will end up.
- Make small, separate changes (rename, extract a function, remove duplication, move a file) instead of rewriting everything at once.
- Keep the style, names and patterns the project already uses.
- Update every place that uses what you change at the same time, so nothing breaks.
- Don't change behavior, not even to fix a bug you find: point it out separately and let the user decide.
- Propose the changes in the files for the user to review, then ask to run the tests or the build to check that everything still works the same.
- Write your explanations in the language of the user's message.
