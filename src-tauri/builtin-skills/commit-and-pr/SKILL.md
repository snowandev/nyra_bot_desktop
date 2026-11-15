---
name: commit-and-pr
description: Prepares the commit message and the pull request description from the changes in the connected folder, which must use Git. Use it when the user asks for a commit message, to describe their changes or to prepare a pull request.
metadata:
  author: Nyra
  version: "1.0"
---

# Commit and PR description

Write a message that explains the change to whoever reads it months from now, based on what really changed.

## Before writing

1. Ask to run `git status` and `git diff --staged`. If nothing is staged, use `git diff` and warn that those changes aren't added yet.
2. Ask to run `git log --oneline -10` to follow the style of earlier commits (language, prefixes, capitalization).
3. If the changes mix different things, suggest splitting them into several commits and say which.

## The commit message

- A first line of 50 to 72 characters, in the imperative, saying what the change does. Follow the language and format of the project's commits; if there are none, write it in English.
- If needed, a blank line and a short body with the why, not the list of files.
- Propose it the way the app's instructions say, so the user can make the commit from there; if they say nothing, give it in a code block so it can be copied.

## The pull request description

- A title like the commit's first line.
- **What changes** and **why**, in a few sentences.
- **How to test it:** the steps or commands.
- Risks or things to review carefully, if any.

## Limits

- Don't commit or push on your own: the user decides when, and makes the commit from what you propose.
- Write your explanations in the language of the user's message.
