//! Commands the model asks to run in a connected folder, each one only once the user approves it. They run in a real
//! terminal (a pseudo-terminal), so questions, passwords and programs that check for one behave as in the user's own.
//! There is no time limit: a command runs until it ends or the user stops it.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::code_runs;
use crate::i18n::{t, t_with};
use crate::share::document_filename;
use crate::storage::Database;
use crate::util::{is_plain_id, save_with_dialog, to_message};
use crate::workspace::{allowed_root, blocking, Workspaces};

const MAX_COMMAND_CHARS: usize = 10_000;
// "Detener" first interrupts it, as Ctrl+C would; one that ignores that is ended after this
const STOP_GRACE: Duration = Duration::from_secs(3);

/// The commands running now, by the id the frontend gave them
#[derive(Default)]
pub struct Terminals {
    running: Arc<Mutex<HashMap<String, Running>>>,
}

// Written apart from the list: a command that doesn't read its input blocks the write, and that must hold up neither
// the others nor the window
type Input = Arc<Mutex<Box<dyn Write + Send>>>;

struct Running {
    writer: Input,
    killer: Box<dyn ChildKiller + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
}

impl Terminals {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<String, Running>>, String> {
        self.running.lock().map_err(to_message)
    }
}

/// What the terminal printed, without its color and cursor codes
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommandEvent {
    Output { text: String },
}

fn valid_id(id: &str) -> Result<(), String> {
    is_plain_id(id)
        .then_some(())
        .ok_or_else(|| t("native.terminal.invalidId"))
}

#[cfg(unix)]
fn shell_command(command: &str) -> CommandBuilder {
    let (shell, args) = crate::util::user_shell(command);
    let mut builder = CommandBuilder::new(shell);
    builder.args(args);
    builder.env("TERM", "xterm-256color");
    builder
}

#[cfg(windows)]
fn shell_command(command: &str) -> CommandBuilder {
    let mut builder = CommandBuilder::new("powershell.exe");
    builder.args(["-NoLogo", "-NoProfile", "-Command", command]);
    builder
}

/// What the terminal prints as plain text: its control codes (colors, cursor moves, titles) dropped, read by a terminal
/// parser that keeps a code or a character split between two reads for the next. Line breaks, tabs and carriage
/// returns stay: the frontend uses the last to redraw progress lines.
#[derive(Default)]
struct PlainText {
    text: String,
}

impl vte::Perform for PlainText {
    fn print(&mut self, c: char) {
        self.text.push(c);
    }

    fn execute(&mut self, byte: u8) {
        if matches!(byte, b'\n' | b'\r' | b'\t') {
            self.text.push(char::from(byte));
        }
    }
}

/// Turns what the terminal prints into text events, as it arrives
struct Printer {
    output: Channel<CommandEvent>,
    parser: vte::Parser,
    plain: PlainText,
}

impl Printer {
    fn new(output: Channel<CommandEvent>) -> Self {
        Self {
            output,
            parser: vte::Parser::new(),
            plain: PlainText::default(),
        }
    }

    // false once nobody listens any more
    fn print(&mut self, bytes: &[u8]) -> bool {
        self.parser.advance(&mut self.plain, bytes);
        let text = std::mem::take(&mut self.plain.text);
        text.is_empty() || self.output.send(CommandEvent::Output { text }).is_ok()
    }
}

/// Reads until the command exits and returns how it ended. On macOS a read can block on after the command exits,
/// so the terminal is only read when it has something, and between reads Nyra checks whether the command ended.
#[cfg(unix)]
fn drive(
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    mut reader: Box<dyn Read + Send>,
    fd: Option<i32>,
    mut printer: Printer,
) -> std::io::Result<portable_pty::ExitStatus> {
    let mut buffer = [0u8; 8192];
    let Some(fd) = fd else {
        return child.wait();
    };
    let has_data = |timeout: i32| {
        let mut poll = libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        };
        // SAFETY: one pollfd for a descriptor the terminal owns, alive for the call
        unsafe { libc::poll(&mut poll, 1, timeout) > 0 && poll.revents & libc::POLLIN != 0 }
    };
    loop {
        if has_data(200) {
            match reader.read(&mut buffer) {
                Ok(read) if read > 0 => {
                    printer.print(&buffer[..read]);
                    continue;
                }
                // The terminal closed: everything that held it exited
                _ => return child.wait(),
            }
        }
        if let Some(status) = child.try_wait()? {
            // What it printed right before exiting
            while has_data(50) {
                match reader.read(&mut buffer) {
                    Ok(read) if read > 0 => {
                        printer.print(&buffer[..read]);
                    }
                    _ => break,
                }
            }
            return Ok(status);
        }
    }
}

/// On Windows reading ends when the terminal is let go, which happens once the command exits
#[cfg(windows)]
fn drive(
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    mut reader: Box<dyn Read + Send>,
    _fd: Option<i32>,
    mut printer: Printer,
) -> std::io::Result<portable_pty::ExitStatus> {
    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        while let Ok(read) = reader.read(&mut buffer) {
            if read == 0 || !printer.print(&buffer[..read]) {
                break;
            }
        }
    });
    child.wait()
}

/// Runs a command in a connected folder and streams what it prints; resolves with its exit code once it ends
#[tauri::command]
// Most are states Tauri hands in; grouping them would only hide what the command reads
#[allow(clippy::too_many_arguments)]
pub async fn run_command(
    app: AppHandle,
    db: State<'_, Database>,
    workspaces: State<'_, Workspaces>,
    terminals: State<'_, Terminals>,
    id: String,
    root: String,
    command: String,
    on_output: Channel<CommandEvent>,
) -> Result<i32, String> {
    valid_id(&id)?;
    let command = command.trim().to_string();
    if command.is_empty() || command.len() > MAX_COMMAND_CHARS {
        return Err(t("native.terminal.emptyOrLong"));
    }
    // A connected folder, or the conversation's own where the programs Nyra writes run
    let folder = match allowed_root(&db, &workspaces, &root) {
        Ok(folder) => folder,
        Err(_) if code_runs::is_space(&app, Path::new(&root)) => PathBuf::from(&root),
        Err(refused) => return Err(refused),
    };
    if !folder.is_dir() {
        return Err(t("native.terminal.folderGone"));
    }
    // A second run with the same id would replace the first one's handle, and it couldn't be stopped any more
    if terminals.lock()?.contains_key(&id) {
        return Err(t("native.terminal.alreadyRunning"));
    }
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| {
            t_with(
                "native.terminal.terminalFailed",
                &[("error", &e.to_string())],
            )
        })?;
    let mut builder = shell_command(&command);
    builder.cwd(&folder);
    let child = pair
        .slave
        .spawn_command(builder)
        .map_err(|e| t_with("native.terminal.runFailed", &[("error", &e.to_string())]))?;
    // Only the command keeps its end of the terminal, so reading ends when it exits
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(to_message)?;
    let writer = pair.master.take_writer().map_err(to_message)?;
    terminals.lock()?.insert(
        id.clone(),
        Running {
            writer: Arc::new(Mutex::new(writer)),
            killer: child.clone_killer(),
            master: pair.master,
        },
    );
    #[cfg(unix)]
    let fd = terminals
        .lock()?
        .get(&id)
        .and_then(|c| c.master.as_raw_fd());
    #[cfg(windows)]
    let fd = None;
    let printer = Printer::new(on_output);
    let status = blocking(move || drive(child, reader, fd, printer)).await;
    // Letting the terminal go also ends the reading on Windows, where it doesn't end with the command
    terminals.lock()?.remove(&id);
    let status = status?.map_err(|e| {
        t_with(
            "native.terminal.statusUnknown",
            &[("error", &e.to_string())],
        )
    })?;
    Ok(i32::try_from(status.exit_code()).unwrap_or(i32::MAX))
}

/// "Detener": interrupts it like Ctrl+C, and ends it for good if it is still running after a moment
#[tauri::command]
pub fn stop_command(terminals: State<'_, Terminals>, id: String) -> Result<(), String> {
    {
        let mut running = terminals.lock()?;
        let Some(command) = running.get_mut(&id) else {
            return Ok(());
        };
        // Not while an answer is stuck in its input: ending it after the grace still stops it
        let input = Arc::clone(&command.writer);
        if let Ok(mut writer) = input.try_lock() {
            let _ = writer.write_all(b"\x03");
            let _ = writer.flush();
        };
    }
    let running = Arc::clone(&terminals.running);
    thread::spawn(move || {
        thread::sleep(STOP_GRACE);
        if let Ok(mut running) = running.lock() {
            if let Some(command) = running.get_mut(&id) {
                end_for_good(command);
            }
        }
    });
    Ok(())
}

/// Nyra quitting: a program left running in the background after its reply (a server) doesn't outlive it
pub fn stop_all(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Ok(mut running) = app.state::<Terminals>().lock() {
        for command in running.values_mut() {
            end_for_good(command);
        }
    }
}

fn end_for_good(command: &mut Running) {
    // The whole group in the foreground, so what the shell started (node under npm) ends too
    #[cfg(unix)]
    if let Some(group) = command.master.process_group_leader() {
        // SAFETY: killpg only sends a signal to a process group id the terminal reported
        unsafe {
            libc::killpg(group, libc::SIGKILL);
        }
    }
    let _ = command.killer.kill();
}

const ANSWER_WAIT: Duration = Duration::from_secs(3);

/// What the user answers to a command that asked something, with the Enter that sends it
#[tauri::command]
pub async fn write_command_input(
    terminals: State<'_, Terminals>,
    id: String,
    text: String,
) -> Result<(), String> {
    let writer = terminals
        .lock()?
        .get(&id)
        .map(|command| Arc::clone(&command.writer))
        .ok_or_else(|| t("native.terminal.alreadyFinished"))?;
    let writing = blocking(move || {
        let mut writer = writer.lock().map_err(to_message)?;
        writer
            .write_all(format!("{text}\r").as_bytes())
            .and_then(|()| writer.flush())
            .map_err(|e| t_with("native.terminal.answerFailed", &[("error", &e.to_string())]))
    });
    // A command that isn't reading never takes it; the write stays waiting until it ends
    tokio::time::timeout(ANSWER_WAIT, writing)
        .await
        .map_err(|_| t("native.terminal.notReading"))??
}

/// Whether the terminal hides what is typed, as it does for a password. Unknown on Windows, so false there.
#[tauri::command]
pub fn command_input_hidden(terminals: State<'_, Terminals>, id: String) -> Result<bool, String> {
    let running = terminals.lock()?;
    let Some(command) = running.get(&id) else {
        return Ok(false);
    };
    Ok(hides_input(command.master.as_ref()))
}

#[cfg(unix)]
fn hides_input(master: &dyn MasterPty) -> bool {
    let Some(fd) = master.as_raw_fd() else {
        return false;
    };
    // SAFETY: termios is plain data that tcgetattr fills in for a terminal descriptor the pty owns
    unsafe {
        let mut termios: libc::termios = std::mem::zeroed();
        libc::tcgetattr(fd, &mut termios) == 0 && termios.c_lflag & libc::ECHO == 0
    }
}

#[cfg(windows)]
fn hides_input(_master: &dyn MasterPty) -> bool {
    false
}

/// "Guardar como…" of the whole output. false when the user closes the dialog.
#[tauri::command]
pub async fn save_command_output(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<bool, String> {
    save_with_dialog(
        &app,
        document_filename(&filename, "txt"),
        Some((t("native.terminal.textFilter"), &["txt"])),
        content.as_bytes(),
        "native.terminal.saveFailed",
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    // What the terminal shows, read in these pieces
    fn plain(pieces: &[&[u8]]) -> String {
        let mut parser = vte::Parser::new();
        let mut plain = PlainText::default();
        for piece in pieces {
            parser.advance(&mut plain, piece);
        }
        plain.text
    }

    #[test]
    fn strips_colors_titles_and_cursor_codes_even_when_split() {
        let text = plain(&[
            "\x1b[32m✓ ok\x1b[0m\r\n\x1b]0;título\x07lí".as_bytes(),
            b"nea\x1b[",
            b"2Kfin\n",
        ]);
        assert_eq!(text, "✓ ok\r\nlíneafin\n");
    }

    #[test]
    fn keeps_a_character_split_between_reads() {
        let bytes = "acción".as_bytes();
        let cut = bytes.len() - 3;
        assert_eq!(plain(&[&bytes[..cut], &bytes[cut..]]), "acción");
    }

    #[test]
    fn accepts_only_plain_ids() {
        assert!(valid_id("cmd-1a2b").is_ok());
        assert!(valid_id("").is_err());
        assert!(valid_id("../x").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn runs_in_a_real_terminal_and_returns_once_it_exits() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut builder = CommandBuilder::new("/bin/sh");
        builder.args(["-c", "test -t 1 && echo tty; exit 3"]);
        let child = pair.slave.spawn_command(builder).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let (channel, received) = channel_for_test();
        let status = drive(
            child,
            reader,
            pair.master.as_raw_fd(),
            Printer::new(channel),
        )
        .unwrap();
        assert!(received.lock().unwrap().contains("tty"));
        assert_eq!(status.exit_code(), 3);
    }

    fn channel_for_test() -> (Channel<CommandEvent>, Arc<Mutex<String>>) {
        let received = Arc::new(Mutex::new(String::new()));
        let sink = Arc::clone(&received);
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push_str(&json);
            }
            Ok(())
        });
        (channel, received)
    }
}
