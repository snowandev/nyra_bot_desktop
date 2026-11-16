mod attachments;
mod browser;
mod claude_code;
mod code_runs;
mod command_outputs;
mod dictation;
mod folders;
mod git;
mod i18n;
mod mcp;
mod memories;
mod navigation;
mod projects;
mod quick;
mod screen_act;
mod screen_capture;
#[cfg(target_os = "macos")]
mod screen_kit;
mod screen_look;
mod screen_press;
mod search;
mod secrets;
mod share;
mod skills;
mod speech_models;
mod spreadsheet;
mod storage;
mod system;
mod system_access;
mod terminal;
mod transcription;
mod tray;
mod updates;
mod util;
mod web;
mod whisper_transformers;
mod workspace;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch only brings back the window that is already open (also hidden in the tray)
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|arg| arg == quick::QUICK_ARG) {
                quick::toggle(app);
            } else {
                tray::show_main(app);
            }
        }))
        // The same shortcut shows and hides the quick chat bar
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        quick::toggle(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(navigation::guard())
        .setup(|app| {
            let database = storage::Database::open(app.handle())?;
            app.manage(database);
            app.manage(skills::SkillImports::default());
            app.manage(workspace::Workspaces::default());
            app.manage(tray::Tray::default());
            app.manage(screen_capture::Capture::default());
            app.manage(screen_look::ScreenLooks::default());
            app.manage(terminal::Terminals::default());
            app.manage(code_runs::CodeRuns::default());
            code_runs::clear_stale(app.handle());
            app.manage(browser::Browsers::default());
            app.manage(speech_models::SpeechDownloads::default());
            app.manage(transcription::Transcriptions::default());
            app.manage(mcp::McpConnections::default());
            app.manage(dictation::Dictation::default());
            browser::clear_profiles(app.handle());
            transcription::sweep_audio(app.handle());
            // Nyra works without it. Its shortcut is the user's choice, so the main window registers it once loaded.
            if let Err(error) = quick::create(app.handle()) {
                eprintln!("Could not create the quick chat bar: {error}");
            } else if std::env::args().any(|arg| arg == quick::QUICK_ARG) {
                quick::toggle(app.handle());
            }
            // Without the icon (Linux without appindicator) closing the window simply quits
            if let Err(error) = tray::setup(app.handle()) {
                eprintln!("Could not create the tray icon: {error}");
            }
            workspace::changes::prune_backups(app.handle());
            // The app is fully usable without them, so a failure here must not stop it from starting
            if let Err(error) = skills::install_builtin_skills(app.handle()) {
                eprintln!("Could not install Nyra's skills: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            i18n::set_language,
            storage::list_conversations,
            storage::load_conversation,
            storage::save_conversation,
            storage::set_conversation_pinned,
            storage::rename_conversation,
            storage::delete_conversation,
            storage::delete_all_conversations,
            folders::list_folders,
            folders::create_folder,
            folders::rename_folder,
            folders::delete_folder,
            folders::set_conversation_folder,
            projects::list_projects,
            projects::add_project,
            projects::rename_project,
            projects::set_project_model,
            projects::remove_project,
            projects::set_project_disabled_skills,
            projects::projects_pending,
            projects::project_git_changes,
            projects::project_git_diff,
            projects::project_commit,
            projects::project_status,
            projects::init_project_git,
            projects::relocate_project,
            projects::restore_project,
            claude_code::list_claude_code_sessions,
            claude_code::import_claude_code_sessions,
            claude_code::complete_imported_pdf,
            skills::list_skills,
            skills::save_skill,
            skills::delete_skill,
            skills::save_adapted_skill,
            skills::restore_original_skill,
            skills::export_skill,
            skills::import::scan_claude_code_skills,
            skills::import::pick_skill_folder,
            skills::import::pick_skill_archives,
            skills::import::stage_dropped_skills,
            skills::import::import_skills,
            search::search_conversations,
            share::copy_image,
            web::web_search,
            web::fetch_page,
            share::save_image,
            spreadsheet::read_spreadsheet,
            spreadsheet::edit_attached_workbook,
            spreadsheet::attached_workbook_view,
            spreadsheet::save_spreadsheet,
            share::save_markdown,
            share::save_markdown_zip,
            speech_models::speech_models_status,
            speech_models::speech_model_add_from_huggingface,
            speech_models::speech_model_add_from_folder,
            speech_models::speech_models_cancel,
            speech_models::speech_models_delete,
            transcription::store_audio,
            mcp::mcp_servers,
            mcp::mcp_save_server,
            mcp::mcp_set_tools,
            mcp::mcp_delete_server,
            mcp::mcp_tools,
            mcp::mcp_known_tools,
            mcp::mcp_log,
            mcp::mcp_icons,
            mcp::mcp_disconnect,
            mcp::mcp_call_tool,
            mcp::mcp_import_candidates,
            transcription::transcribe_stored_audio,
            transcription::transcription_cancel,
            transcription::forget_audio,
            dictation::dictation_start,
            dictation::dictation_stop,
            dictation::dictation_cancel,
            share::save_pdf,
            share::save_table,
            secrets::secret_store,
            secrets::saved_api_keys,
            secrets::load_api_key,
            secrets::save_api_key,
            secrets::forget_api_key,
            memories::list_memories,
            memories::add_memory,
            memories::update_memory,
            memories::restore_memory,
            memories::delete_memory,
            memories::delete_all_memories,
            workspace::pick_workspace_folder,
            workspace::index_workspace,
            workspace::read_workspace_file,
            workspace::search_workspace,
            workspace::outline_workspace,
            workspace::reveal_workspace_file,
            workspace::release_unused_workspaces,
            workspace::changes::inspect_workspace_file,
            workspace::changes::apply_workspace_change,
            workspace::changes::inspect_workspace_workbook,
            workspace::changes::apply_workspace_cells,
            workspace::changes::copy_workspace_cells_as_xlsx,
            workspace::changes::undo_workspace_change,
            workspace::meaning::meaning_pending,
            workspace::meaning::meaning_chunks,
            workspace::meaning::meaning_store,
            workspace::meaning::meaning_search,
            tray::set_keep_in_tray,
            quick::resize_quick,
            quick::set_quick_size,
            quick::drag_quick,
            quick::set_quick_pinned,
            quick::reset_quick_position,
            quick::capture_from_quick,
            screen_capture::capture_preview,
            screen_capture::show_capture,
            screen_capture::finish_capture,
            screen_look::screen_look_available,
            screen_look::screen_look,
            screen_look::screen_zoom,
            screen_look::screen_overview,
            screen_look::screen_close_up,
            screen_look::screen_mark,
            screen_look::screen_marks_now,
            screen_look::screen_note_areas,
            screen_look::screen_close_mark,
            screen_look::screen_clear,
            screen_look::screen_watch,
            screen_look::screen_watch_stop,
            screen_act::screen_act,
            screen_act::screen_act_end,
            screen_act::screen_act_thinking,
            skills::files::read_skill_file,
            skills::files::update_skill_files,
            terminal::run_command,
            browser::browser_available,
            browser::browser_is_local,
            browser::browser_open,
            browser::browser_click,
            browser::browser_type,
            browser::browser_key,
            browser::browser_screenshot,
            browser::browser_thumbnail,
            browser::browser_close,
            system::system_memory,
            system_access::system_access,
            system_access::request_system_access,
            system_access::open_access_settings,
            browser::browser_snapshot,
            browser::browser_find,
            browser::browser_mark,
            browser::browser_start,
            browser::browser_show,
            code_runs::code_space,
            code_runs::code_runtimes,
            code_runs::prepare_code,
            code_runs::code_files,
            code_runs::read_code_file,
            code_runs::save_code_file,
            terminal::stop_command,
            terminal::write_command_input,
            terminal::command_input_hidden,
            terminal::save_command_output,
            quick::hide_quick,
            quick::open_main_from_quick,
            quick::set_quick_shortcut,
            quick::quick_shortcut_status,
            updates::install_kind,
        ])
        .on_window_event(|window, event| {
            let is_quick = window.label() == quick::LABEL;
            let is_main = window.label() == "main";
            match event {
                tauri::WindowEvent::Focused(false) if is_quick => quick::on_focus_lost(window),
                #[cfg(windows)]
                tauri::WindowEvent::ThemeChanged(_) | tauri::WindowEvent::Focused(true)
                    if is_main =>
                {
                    tray::follow_taskbar_theme(window.app_handle())
                }
                tauri::WindowEvent::Moved(_) if is_quick => quick::on_moved(window),
                tauri::WindowEvent::Destroyed
                    if window.label() == screen_capture::OVERLAY_LABEL =>
                {
                    screen_capture::on_overlay_closed(window.app_handle())
                }
                tauri::WindowEvent::CloseRequested { api, .. } if is_main => {
                    if tray::hide_on_close(window) {
                        api.prevent_close();
                    } else {
                        // The hidden quick bar would otherwise keep Nyra running with no window to see
                        window.app_handle().exit(0);
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // The browsers Nyra opened don't outlive it, nor do their temporary profiles, nor the programs still
            // running in the background, nor the MCP servers it started
            if let tauri::RunEvent::Exit = _event {
                browser::close_all(_app);
                terminal::stop_all(_app);
                mcp::close_all(_app);
            }
            // macOS: a click on the Dock icon brings the hidden window back, as Mac apps do
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                tray::show_main(_app);
            }
        });
}
