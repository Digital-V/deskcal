// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

// Tracks whether the widget is currently "popped out" (temporarily forced
// above other windows so you can interact with it). Default is false: the
// widget sits at normal window level, so other apps naturally cover it,
// like a real desktop widget rather than a floating overlay.
static PINNED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Deserialize, Clone)]
struct CalendarEvent {
    id: String,
    title: String,
    start: String, // ISO 8601
    end: String,
    calendar_color: String, // hex, e.g. "#378ADD"
    all_day: bool,
}

// Phase 1: mock data so the UI is testable before OAuth is wired up.
// Phase 2: replace this with a real call to Google Calendar's events.list,
// using the cached token from `get_cached_token` (see auth.rs, not yet created).
// Dates are computed relative to "today" and spread across ~4 weeks so
// Week and Month views have something to show, not just Day.
#[tauri::command]
fn get_events() -> Vec<CalendarEvent> {
    use chrono::{Duration, Local, NaiveTime};

    struct Mock {
        day_offset: i64,
        hour: u32,
        minute: u32,
        duration_min: i64,
        title: &'static str,
        color: &'static str,
        all_day: bool,
    }

    let today = Local::now().date_naive();

    let mocks = vec![
        Mock { day_offset: -8, hour: 9, minute: 0, duration_min: 30, title: "Standup", color: "#378ADD", all_day: false },
        Mock { day_offset: -5, hour: 12, minute: 0, duration_min: 60, title: "Lunch and learn", color: "#7F77DD", all_day: false },
        Mock { day_offset: -2, hour: 10, minute: 0, duration_min: 60, title: "1:1 with manager", color: "#7F77DD", all_day: false },
        Mock { day_offset: 0, hour: 9, minute: 0, duration_min: 15, title: "Standup", color: "#378ADD", all_day: false },
        Mock { day_offset: 0, hour: 11, minute: 30, duration_min: 30, title: "Design review", color: "#1D9E75", all_day: false },
        Mock { day_offset: 0, hour: 15, minute: 30, duration_min: 30, title: "Dentist", color: "#D85A30", all_day: false },
        Mock { day_offset: 1, hour: 14, minute: 0, duration_min: 45, title: "Sprint planning", color: "#1D9E75", all_day: false },
        Mock { day_offset: 3, hour: 9, minute: 30, duration_min: 30, title: "Client call", color: "#378ADD", all_day: false },
        Mock { day_offset: 5, hour: 0, minute: 0, duration_min: 0, title: "Team offsite", color: "#D4537E", all_day: true },
        Mock { day_offset: 7, hour: 13, minute: 0, duration_min: 60, title: "Quarterly review", color: "#BA7517", all_day: false },
        Mock { day_offset: 10, hour: 16, minute: 0, duration_min: 30, title: "Vet appointment", color: "#D85A30", all_day: false },
        Mock { day_offset: 12, hour: 9, minute: 0, duration_min: 30, title: "Standup", color: "#378ADD", all_day: false },
        Mock { day_offset: 14, hour: 18, minute: 0, duration_min: 90, title: "Dinner with friends", color: "#D4537E", all_day: false },
        Mock { day_offset: 18, hour: 10, minute: 0, duration_min: 45, title: "Product sync", color: "#1D9E75", all_day: false },
        Mock { day_offset: 20, hour: 15, minute: 0, duration_min: 30, title: "Dentist follow-up", color: "#D85A30", all_day: false },
    ];

    mocks
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let date = today + Duration::days(m.day_offset);
            let start_time = NaiveTime::from_hms_opt(m.hour, m.minute, 0).unwrap();
            let start = date.and_time(start_time);
            let end = start + Duration::minutes(m.duration_min);
            CalendarEvent {
                id: (i + 1).to_string(),
                title: m.title.to_string(),
                start: start.format("%Y-%m-%dT%H:%M:%S").to_string(),
                end: end.format("%Y-%m-%dT%H:%M:%S").to_string(),
                calendar_color: m.color.to_string(),
                all_day: m.all_day,
            }
        })
        .collect()
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// Flips between "docked" (normal window level, other apps can cover it)
// and "popped out" (temporarily always-on-top so you can click into it).
// Returns the new pinned state so the frontend can update the button.
#[tauri::command]
fn toggle_pop_out(window: tauri::WebviewWindow) -> bool {
    let now_pinned = !PINNED.load(Ordering::SeqCst);
    PINNED.store(now_pinned, Ordering::SeqCst);
    let _ = window.set_always_on_top(now_pinned);
    if now_pinned {
        let _ = window.set_focus();
    }
    now_pinned
}

#[tauri::command]
fn hide_widget(window: tauri::WebviewWindow) {
    let _ = window.hide();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_events,
            quit_app,
            toggle_pop_out,
            hide_widget
        ])
        .setup(|app| {
            let window = app.get_webview_window("widget").unwrap();

        // Windows only auto-rounds framed windows; borderless ones like ours
        // default to square corners, which shows as a hard edge behind the
        // rounded card whenever Acrylic blur is active. Tell DWM to round
        // the actual window rectangle so it matches the card's CSS radius.
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE};

            if let Ok(hwnd) = window.hwnd() {
                let preference: i32 = 2; // DWMWCP_ROUND
                unsafe {
                    let _ = DwmSetWindowAttribute(
                        hwnd,
                        DWMWA_WINDOW_CORNER_PREFERENCE,
                        &preference as *const _ as *const _,
                        std::mem::size_of::<i32>() as u32,
                    );
                }
            }
        }

            // Tray icon: left-click shows/restores the widget (the only way
            // to get it back once hidden, since there's no taskbar icon).
            // Right-click gives a menu with Pop out / Refresh / Quit.
            let popout = MenuItem::with_id(app, "popout", "Pop out", true, None::<&str>)?;
            let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&popout, &refresh, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .icon(app.default_window_icon().unwrap().clone())
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            if let Some(w) = tray.app_handle().get_webview_window("widget") {
                                let visible = w.is_visible().unwrap_or(false);
                                if visible {
                                    let _ = w.hide();
                                } else {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                    }
                })
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "refresh" => {
                        if let Some(w) = app.get_webview_window("widget") {
                            let _ = w.emit("refresh-events", ());
                        }
                    }
                    "popout" => {
                        if let Some(w) = app.get_webview_window("widget") {
                            let now_pinned = !PINNED.load(Ordering::SeqCst);
                            PINNED.store(now_pinned, Ordering::SeqCst);
                            let _ = w.set_always_on_top(now_pinned);
                            let _ = w.emit("pinned-changed", now_pinned);
                            if now_pinned {
                                let _ = w.set_focus();
                            }
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
