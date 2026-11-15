---
name: debug
description: Finds the cause of an error or of unexpected behaviour in the code of the connected folder and proposes how to fix it. Use it when the user pastes an error, a stack trace or a log, or says something fails or doesn't do what it should.
metadata:
  author: Nyra
  version: "1.0"
---

# Debug

Find the cause, not just the symptom. A fix that hides an error without understanding it usually comes back.

## Steps

1. **Understand the failure:** what was expected, what actually happens and when. If something essential is missing (the error message, how to reproduce it), ask for it in one sentence.
2. **Follow the trail:** read the files and lines the error names and the code that calls them. Search the folder for the names in the message.
3. **Form hypotheses** from most to least likely, and drop the ones the code contradicts.
4. **Check** the most likely one if you can: ask to run the test or command that reproduces the failure, or add a temporary log and say so.
5. **Fix** the cause with the smallest change that solves it, proposed in the file for the user to review.

## When answering

- Start with the cause in one or two sentences, with the file and line.
- Explain why it produces that error, so the user recognizes it next time.
- If other places have the same problem, name them.
- Suggest a test that would have caught it, if the project has tests.
- If you can't find the cause with what is there, say what you ruled out and what information is missing.
- Write in the language of the user's message.
