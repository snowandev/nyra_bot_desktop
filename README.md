<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="Nyra Bot icon" width="128" height="128">
</p>

<h1 align="center">Nyra Bot</h1>

<p align="center"><b>English</b> · <a href="README.es.md">Español</a></p>

Nyra Bot is a desktop app for talking with AI models. It works on macOS, Windows and Linux, with models that run on your computer or in the cloud. You can switch models in the middle of a conversation without losing the history.

<p align="center"><img src="docs/screenshots/chat-table.png" alt="Nyra comparing three programming languages in a table"></p>

> Nyra is in an early version.

## Download Nyra

Download the installer for your system from the [latest release](https://github.com/snowandev/nyra_bot_desktop/releases/latest):

| System | File |
|---|---|
| macOS with Apple Silicon (M1 or later) | `Nyra.Bot_…_aarch64.dmg` |
| macOS with Intel | `Nyra.Bot_…_x64.dmg` |
| Windows | `Nyra.Bot_…_x64-setup.exe` |
| Linux | `.AppImage`, `.deb` or `.rpm` |

### Opening Nyra for the first time on macOS

Nyra isn't signed with an Apple developer account, so the first time you open it macOS says it can't check that it's free of malware and won't open it. It only happens once:

1. Drag Nyra Bot to Applications and open it. When the warning shows up, close it.
2. Go to **System Settings → Privacy & Security** and scroll down to **Security**.
3. Next to the message about Nyra Bot, click **Open Anyway** and confirm with your password.

If you'd rather use the terminal, this does the same:

```bash
xattr -dr com.apple.quarantine "/Applications/Nyra Bot.app"
```

## What it can do

<p align="center">
  <img src="docs/screenshots/chat-diagram.png" alt="A diagram of a web request drawn in a reply" width="49%">
  <img src="docs/screenshots/chat-code.png" alt="Python code to count words, in English" width="49%">
  <img src="docs/screenshots/chat-code.es.png" alt="The same Python code, asked in Spanish" width="49%">
  <img src="docs/screenshots/chat-document.es.png" alt="A shopping list written as a document" width="49%">
</p>

### Chat

- Replies as they're written. You can stop them, regenerate them (each version is kept), edit your messages and branch off from any point.
- Attach images, PDFs, text files, spreadsheets, audio or a link.
- Tables, formatted code blocks, formulas and diagrams in the replies.
- Web search, with the sources cited in the reply.
- With models that reason, you can see what they thought before answering.
- When a conversation gets too long for the model, Nyra summarizes it and carries on.
- Share a reply as an image, a PDF or Markdown.

### Organization

- Folders in the sidebar and pinned conversations at the top.
- Private conversations, which aren't saved, and isolated ones, which also don't use memories or skills.
- Search within a conversation and across all of them, including the text of attached files.
- **Memories:** facts you ask Nyra to keep in mind in other conversations. You see and edit them in Settings.
- **Skills:** reusable instructions, for example to write in a certain style or follow a process. The model uses them when they're needed, or you pick them with `/`. You can create your own or import them.
- **Import from Claude Code:** your sessions, with their files, go into the project for their folder.

### Working with your files

- **Connect a folder** and the model can read its files and propose changes. Nothing is written until you review each change and apply it, and what Nyra applies can be undone.
- **The Code space:** each project is a folder with its conversations, pending changes, Git status and commits.
- **Commands and code:** the model can ask to run a command or a script in the folder. You always see it first and decide whether it runs.
- **MCP servers:** give the model tools from other apps. Each use asks for your permission, except the tools you mark as always allowed.

### On your desktop

- **Quick chat:** a bar that opens with a shortcut from any app, to ask something without switching windows.
- **Voice:** dictate your messages or transcribe audio files. It all happens on your computer, with Whisper.
- **Meetings:** record a call on Meet, Teams or any other app. Nyra records your microphone and what your computer plays, then transcribes it with what you said and what the others said.
- **Nyra's browser:** the model can open pages, read them and use them in your Chrome, Edge or another Chromium-based browser, with your permission.
- **Your screen:** Nyra can look at it to explain what you see, guide you step by step by pointing where to click, or use the mouse and keyboard if you allow it.

### Your way

- Light, dark or system theme, accent color and text size.
- Interface in English and Spanish. The model answers in the language you write in.
- A notification when a reply finishes, and an icon in the system bar.

## Privacy

- With a local model, nothing leaves your computer.
- With a cloud model, what you send goes to the provider you chose, with your own API key. Nyra warns you if a message seems to contain sensitive data.
- Conversations, memories and projects are saved on your computer.
- Private and isolated conversations are never saved.

## Differences between systems

Nyra works the same on macOS, Windows and Linux, with these exceptions:

| Feature | macOS | Windows | Linux |
|---|---|---|---|
| Looking at the screen and guiding you | Yes | Yes | Not yet |
| Using the mouse and keyboard | Yes | Yes | Not yet |
| Recording what your computer plays in a meeting | Yes, from macOS 14.2 | Yes | Yes, with PulseAudio or PipeWire |
| Icon in the system bar | Yes | Yes | Yes. With the `.AppImage` you need to install `libayatana-appindicator`, and on GNOME the AppIndicator extension |

On macOS, Nyra asks for microphone, screen recording, other apps' audio and accessibility permissions only for the features that use them.

## Build Nyra from source

If you'd rather build it yourself, you need [Node.js](https://nodejs.org) 24 or later and [Rust](https://www.rust-lang.org/tools/install).

```bash
git clone https://github.com/snowandev/nyra_bot_desktop.git
cd nyra_bot_desktop
npm install
npm run tauri build
```

The installer ends up in `src-tauri/target/release/bundle/`. If you just want to try it, `npm run tauri dev` opens it directly.

## License

Nyra is released under the [MIT license](LICENSE). You can use it for free, including for commercial purposes, modify it and make your own versions, as long as you keep the copyright notice and the license.
