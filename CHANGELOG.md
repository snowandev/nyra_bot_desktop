# Changelog

What changes in each version of Nyra Bot. The same notes in Spanish are in [CHANGELOG.es.md](CHANGELOG.es.md).

## 0.9.5 · 2026-11-20

### New
- Record your computer's audio and your microphone at the same time, to get the audio of any app.
- Choose in Settings which microphone Nyra uses.
- Listen to the audio in the chat: opening one shows a player.

### Fixes
- "Automatic" no longer turns itself off when you pick a model in another window.
- The text box no longer keeps waiting for the answer to a command that already finished.
- When Nyra clicks on your screen, it no longer mistakes it for its own window when another one is in front.

## 0.9.4 · 2026-11-17

### New
- The installers now look like Nyra, on macOS, Windows and Linux.

### Improvements
- Nyra chooses better between searching the web, its browser and your screen. If you ask it to look something up in Chrome, it opens the browser instead of searching first.

### Fixes
- Stopping a reply now also stops right away what Nyra was doing on your screen.
- When Nyra uses your keyboard, it no longer types into its own window. It asks you to click in your app first.
- Nyra no longer freezes when you change the interface language.

## 0.9.3 · 2026-11-15

### Improvements
- On macOS, Nyra now keeps its permissions for the screen, Accessibility and the microphone when it updates. It will ask for them one last time after this update.

## 0.9.2 · 2026-11-15

### New
- Click a diagram or chart in a reply to see it large. Zoom with the wheel or a pinch, drag to move around and double-click to fit it.
- Long code blocks show only their first lines until you open them, and lines too long for the chat can be wrapped.

### Improvements
- Replies read better, with clearer headings, dividers, strikethrough, task lists with boxes in your accent color and diffs that shade the added and removed lines.
- Nyra finds things more accurately on large screens like 4K ones when it uses your mouse and keyboard.
- The macOS icon is now the same size as the other apps in the Dock.

### Fixes
- Footnote numbers in replies now take you to the note and back, and there's no longer a title in another language above them. In a PDF they're numbered and placed at the end.
- The default model you pick in the welcome is used right away, also in the quick bar, without restarting Nyra.

## 0.9.1 · 2026-11-15

### Improvements
- A long model name no longer widens the message box: it ends in "…" and shows in full when you hover over it.

### Fixes
- The quick bar no longer shows a gray band underneath on Windows.

## 0.9.0 · 2026-11-15

### New
- First public version of Nyra Bot for macOS, Windows and Linux.
- Chat with local models (Ollama and LM Studio) or cloud ones (Claude, OpenAI and Gemini), and switch models in the middle of a conversation.
- Connect a folder so the model reads your files and proposes changes you review before applying.
- The Code space, with projects, pending changes and Git.
- Web search with cited sources, memories, skills and MCP connections.
- Audio transcription and dictation on your computer.
- Nyra's browser, and help on your screen with the mouse and keyboard.
- Import your Claude Code conversations, with their files.
