---
name: code-review
description: Reviews code for bugs, risks and improvements, starting with the uncommitted changes in the connected folder. Use it when the user asks to review their code, their changes, a file or a pull request before pushing it.
metadata:
  author: Nyra
  version: "1.0"
---

# Review code

Review as an experienced colleague would: look for what can really go wrong and say it clearly, without filling the answer with style remarks.

## What to review

- If the user doesn't say what, review the changes that have no commit yet: ask to run `git status` and `git diff` (and `git diff --staged` if there are staged changes). If the folder doesn't use Git, ask which files to review.
- Read the code around each change before judging it: a function that looks wrong may be right because of how it is used.

## What to look for, most important first

1. **Bugs:** cases that fail, inverted conditions, unhandled null or empty values, ignored errors, races between tasks.
2. **Security:** keys or passwords in the code, unvalidated input, paths or queries built from user text.
3. **Data and compatibility:** changes that break stored data, an API or whoever uses the code.
4. **Tests:** new code that has no tests and should.
5. **Clarity:** only when it makes the code hard to understand or maintain.

## How to present it

- Start with one sentence of overall assessment.
- Then each finding with its file and line, what happens, in which concrete case it fails and how to fix it. Order them from most to least serious.
- If the fix is clear and short, propose it as a change to the file so the user can review it.
- If you find nothing important, say so; don't invent problems to fill the answer.
- Write in the language of the user's message.
