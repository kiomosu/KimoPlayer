// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Tag, Accessor};
use lofty::picture::{Picture, PictureType, MimeType};
use serde::Serialize;
use std::path::Path;
use walkdir::WalkDir;
use rusqlite::{params, Connection};

// Windows API for preventing sleep
#[cfg(target_os = "windows")]
mod windows_sleep {
    use std::sync::atomic::{AtomicBool, Ordering};
    
    static SLEEP_PREVENTED: AtomicBool = AtomicBool::new(false);
    
    // Windows execution state flags
    const ES_CONTINUOUS: u32 = 0x80000000;
    const ES_SYSTEM_REQUIRED: u32 = 0x00000001;
    const ES_DISPLAY_REQUIRED: u32 = 0x00000002;
    
    extern "system" {
        fn SetThreadExecutionState(esFlags: u32) -> u32;
    }
    
    pub fn prevent_sleep(prevent: bool) -> bool {
        if prevent {
            let result = unsafe {
                SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
            };
            SLEEP_PREVENTED.store(true, Ordering::SeqCst);
            result != 0
        } else {
            let result = unsafe {
                SetThreadExecutionState(ES_CONTINUOUS)
            };
            SLEEP_PREVENTED.store(false, Ordering::SeqCst);
            result != 0
        }
    }
    
    pub fn is_sleep_prevented() -> bool {
        SLEEP_PREVENTED.load(Ordering::SeqCst)
    }
}

#[derive(Serialize)]
pub struct AudioMetadata {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<u64>,
    cover_image: Option<String>, // Base64 encoded data URI
    file_path: String,
    year: Option<u32>,
    track_number: Option<u32>,
    disc_number: Option<u32>,
    genre: Option<String>,
    album_artist: Option<String>,
    composer: Option<String>,
    lyricist: Option<String>,
    comment: Option<String>,
    lyrics: Option<String>,
    bitrate: Option<u32>,
    sample_rate: Option<u32>,
    bit_depth: Option<u8>,
}

use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, Window, Listener};
use tauri_plugin_dialog::DialogExt;
use tauri::menu::{Menu, MenuItem, CheckMenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};

fn calculate_hash<T: Hash>(t: &T) -> u64 {
    let mut s = DefaultHasher::new();
    t.hash(&mut s);
    s.finish()
}

#[tauri::command]
fn read_audio_metadata(app: tauri::AppHandle, path: String) -> Result<AudioMetadata, String> {
    let path_obj = Path::new(&path);
    let tagged_file = Probe::open(&path_obj)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let properties = tagged_file.properties();
    let duration = properties.duration().as_secs();
    let bitrate = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();
    let bit_depth = properties.bit_depth();

    let mut title = None;
    let mut artist = None;
    let mut album = None;
    let mut cover_image = None;
    
    let mut year = None;
    let mut track_number = None;
    let mut disc_number = None;
    let mut genre = None;
    let mut album_artist = None;
    let mut composer = None;
    let mut lyricist = None;
    let mut comment = None;
    let mut lyrics = None;

    if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
        title = tag.title().map(|s| s.into_owned());
        artist = tag.artist().map(|s| s.into_owned());
        album = tag.album().map(|s| s.into_owned());
        
        year = tag.year();
        track_number = tag.track();
        disc_number = tag.disk();
        genre = tag.genre().map(|s| s.into_owned());

        for item in tag.items() {
            use lofty::tag::ItemKey;
            match item.key() {
                ItemKey::AlbumArtist => {
                    album_artist = item.value().text().map(|s| s.to_string());
                }
                ItemKey::Composer => {
                    composer = item.value().text().map(|s| s.to_string());
                }
                ItemKey::Lyricist => {
                    lyricist = item.value().text().map(|s| s.to_string());
                }
                ItemKey::Comment => {
                    comment = item.value().text().map(|s| s.to_string());
                }
                ItemKey::Lyrics => {
                    lyrics = item.value().text().map(|s| s.to_string());
                }
                _ => {}
            }
        }

        // Try to get front cover
        if let Some(picture) = tag.pictures().iter().next() {
            let path_hash = calculate_hash(&path);
            
            if let Ok(cache_dir) = app.path().app_cache_dir() {
                let covers_dir = cache_dir.join("covers");
                if std::fs::create_dir_all(&covers_dir).is_ok() {
                    let cache_path = covers_dir.join(format!("{}.jpg", path_hash));
                    if !cache_path.exists() {
                        let _ = std::fs::write(&cache_path, picture.data());
                    }
                    cover_image = Some(cache_path.to_string_lossy().into_owned());
                }
            }

            if cover_image.is_none() {
                let mime_type = picture.mime_type().map(|m| m.to_string()).unwrap_or_else(|| "image/jpeg".to_string());
                let b64 = BASE64.encode(picture.data());
                cover_image = Some(format!("data:{};base64,{}", mime_type, b64));
            }
        }
    }

    if title.is_none() {
        title = path_obj.file_stem().map(|s| s.to_string_lossy().into_owned());
    }

    Ok(AudioMetadata {
        title,
        artist,
        album,
        duration: Some(duration),
        cover_image,
        file_path: path,
        year,
        track_number,
        disc_number,
        genre,
        album_artist,
        composer,
        lyricist,
        comment,
        lyrics,
        bitrate,
        sample_rate,
        bit_depth,
    })
}

fn percent_encode(s: &str) -> String {
    s.bytes().map(|byte| {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{:02X}", byte),
        }
    }).collect()
}

#[tauri::command]
async fn open_metadata_editor_window(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("metadata-editor") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("load-metadata", path);
        return Ok(());
    }

    let encoded_path = percent_encode(&path);
    let url_str = format!("metadata.html?window=metadata-editor&path={}", encoded_path);

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "metadata-editor",
        tauri::WebviewUrl::App(url_str.into())
    )
    .title("编辑歌曲元数据与高保真歌词")
    .inner_size(1050.0, 720.0)
    .min_inner_size(880.0, 560.0)
    .decorations(false)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn set_desktop_lyrics_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("desktop-lyrics") {
        if visible {
            let _ = window.set_shadow(false);
            window.show().map_err(|e| e.to_string())?;
            let _ = window.set_focus();
        } else {
            window.hide().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    if !visible {
        return Ok(());
    }

    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "desktop-lyrics",
        tauri::WebviewUrl::App("desktop-lyrics.html".into()),
    )
    .title("KimoPlayer 桌面歌词")
    .inner_size(620.0, 104.0)
    .min_inner_size(320.0, 72.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(true)
    .center()
    .build();

    // 竞态容错：并发调用下 label 可能已存在（build 报错），复用已有窗口
    let window = match window {
        Ok(w) => w,
        Err(_) => {
            if let Some(w) = app.get_webview_window("desktop-lyrics") {
                let _ = w.set_shadow(false);
                let _ = w.show();
                let _ = w.set_focus();
                return Ok(());
            }
            return Err("创建桌面歌词窗口失败".to_string());
        }
    };

    let _ = window.set_shadow(false);
    let _ = window.show();

    Ok(())
}

#[tauri::command]
fn write_audio_metadata(
    app: tauri::AppHandle,
    path: String,
    title: String,
    artist: String,
    album: String,
    year: Option<u32>,
    track_number: Option<u32>,
    disc_number: Option<u32>,
    genre: Option<String>,
    album_artist: Option<String>,
    composer: Option<String>,
    lyricist: Option<String>,
    comment: Option<String>,
    lyrics: Option<String>,
    bitrate: Option<u32>,
    sample_rate: Option<u32>,
    bit_depth: Option<u8>,
    cover_image_path: Option<String>,
    remove_cover: Option<bool>,
) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("音频文件不存在".into());
    }

    let mut tagged_file = Probe::open(&path_obj)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let has_tag = tagged_file.primary_tag().is_some() || tagged_file.first_tag().is_some();
    if !has_tag {
        let tag_type = tagged_file.primary_tag_type();
        tagged_file.insert_tag(Tag::new(tag_type));
    }

    {
        let has_primary = tagged_file.primary_tag().is_some();
        let tag = if has_primary {
            tagged_file.primary_tag_mut().unwrap()
        } else {
            tagged_file.first_tag_mut().ok_or_else(|| "无法为该文件获取或创建元数据 Tag".to_string())?
        };

        tag.set_title(title);
        tag.set_artist(artist);
        tag.set_album(album);

        if let Some(y) = year {
            tag.set_year(y);
        } else {
            tag.remove_year();
        }

        if let Some(t) = track_number {
            tag.set_track(t);
        } else {
            tag.remove_track();
        }

        if let Some(d) = disc_number {
            tag.set_disk(d);
        } else {
            tag.remove_disk();
        }

        if let Some(g) = genre {
            let trimmed = g.trim();
            if trimmed.is_empty() {
                tag.remove_genre();
            } else {
                tag.set_genre(trimmed.to_string());
            }
        } else {
            tag.remove_genre();
        }

        // 统一处理自定义文字标签
        let mut set_tag_item = |key: lofty::tag::ItemKey, val: Option<String>| {
            if let Some(v) = val {
                let trimmed = v.trim();
                if trimmed.is_empty() {
                    tag.remove_key(&key);
                } else {
                    tag.insert_text(key, trimmed.to_string());
                }
            } else {
                tag.remove_key(&key);
            }
        };

        use lofty::tag::ItemKey;
        set_tag_item(ItemKey::AlbumArtist, album_artist);
        set_tag_item(ItemKey::Composer, composer);
        set_tag_item(ItemKey::Lyricist, lyricist);
        set_tag_item(ItemKey::Comment, comment);
        set_tag_item(ItemKey::Lyrics, lyrics.clone());

        // 处理封面移除
        if remove_cover.unwrap_or(false) {
            tag.remove_picture_type(PictureType::CoverFront);
            let path_hash = calculate_hash(&path);
            if let Ok(cache_dir) = app.path().app_cache_dir() {
                let cache_path = cache_dir.join("covers").join(format!("{}.jpg", path_hash));
                if cache_path.exists() {
                    let _ = std::fs::remove_file(&cache_path);
                }
            }
        } else if let Some(cover_path) = cover_image_path {
            if !cover_path.is_empty() {
                let cover_bytes = std::fs::read(&cover_path)
                    .map_err(|e| format!("读取封面文件失败: {}", e))?;

                let ext = Path::new(&cover_path)
                    .extension()
                    .map(|s| s.to_string_lossy().to_lowercase())
                    .unwrap_or_else(|| "jpg".to_string());

                let mime_type = match ext.as_str() {
                    "png" => MimeType::Png,
                    "gif" => MimeType::Gif,
                    _ => MimeType::Jpeg,
                };

                let picture = Picture::new_unchecked(
                    PictureType::CoverFront,
                    Some(mime_type),
                    None,
                    cover_bytes,
                );

                tag.remove_picture_type(PictureType::CoverFront);
                tag.push_picture(picture);

                let path_hash = calculate_hash(&path);
                if let Ok(cache_dir) = app.path().app_cache_dir() {
                    let cache_path = cache_dir.join("covers").join(format!("{}.jpg", path_hash));
                    if cache_path.exists() {
                        let _ = std::fs::remove_file(&cache_path);
                    }
                }
            }
        }
    }

    tagged_file.save_to_path(&path_obj, lofty::config::WriteOptions::default()).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn scan_directory(dir: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        if let Some(ext) = entry.path().extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if ext_str == "mp3"
                || ext_str == "flac"
                || ext_str == "wav"
                || ext_str == "ape"
                || ext_str == "m4a"
                || ext_str == "ogg"
            {
                files.push(entry.path().to_string_lossy().into_owned());
            }
        }
    }
    Ok(files)
}

#[derive(Serialize)]
pub struct LyricsResult {
    lyrics_type: String,  // "lrc", "ttml", "none"
    content: String,
}

fn read_embedded_lyrics(path: &Path) -> Option<String> {
    if let Ok(tagged_file) = Probe::open(path).and_then(|p| p.read()) {
        if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
            for item in tag.items() {
                let key = format!("{:?}", item.key());
                if key.contains("Lyrics") || key.contains("LYRICS") || key.contains("USLT") {
                    if let Some(text) = item.value().text() {
                        return Some(text.to_string());
                    }
                }
            }
        }
    }
    None
}

#[tauri::command]
async fn ai_transcribe_audio(audio_path: String, server_url: String) -> Result<String, String> {
    let path = Path::new(&audio_path);
    if !path.exists() {
        return Err("Audio file does not exist".into());
    }

    let file_bytes = std::fs::read(&audio_path).map_err(|e| e.to_string())?;
    let file_name = path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = path.parent().unwrap_or(Path::new("."));
    let lrc_path = parent.join(format!("{}.lrc", stem));
    
    let mut lrc_text = String::new();
    if lrc_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&lrc_path) {
            lrc_text = content;
        }
    }

    // 🌟 如果外部 .lrc 不存在，则强力嗅探音频元数据中的内嵌歌词（如 LYRICS, USLT）以启动高保真对齐！
    if lrc_text.is_empty() {
        if let Some(embedded) = read_embedded_lyrics(path) {
            lrc_text = embedded;
        }
    }

    let client = reqwest::Client::builder()
        .no_proxy() // 🌟 核心：无视系统代理，防止 127.0.0.1 本地回环连接被 VPN/Clash 等代理劫持！
        .connect_timeout(std::time::Duration::from_secs(6))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;
    
    // Create multipart form data
    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name.clone());

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("task", "transcribe");

    if !lrc_text.is_empty() {
        form = form.text("lrc_text", lrc_text);
    }

    let response = client.post(&server_url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("网络上传请求失败: {}", e))?;

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_else(|_| "服务器异常".into());
        return Err(format!("AI 转写失败: {}", err_text));
    }

    let json_res = response.text().await.map_err(|e| e.to_string())?;
    
    // 自动在同级目录下缓存高保真卡拉OK JSON歌词
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = path.parent().unwrap_or(Path::new("."));
    let lyrics_json_path = parent.join(format!("{}.json", stem));
    
    let _ = std::fs::write(lyrics_json_path, &json_res);

    Ok(json_res)
}

#[tauri::command]
async fn ai_align_single_line(
    audio_path: String,
    text: String,
    start_time: f64,
    end_time: f64,
    server_url: String,
) -> Result<String, String> {
    let path = Path::new(&audio_path);
    if !path.exists() {
        return Err("Audio file does not exist".into());
    }

    let file_bytes = std::fs::read(&audio_path).map_err(|e| e.to_string())?;
    let file_name = path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();

    let client = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(6))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {}", e))?;

    let part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name.clone());

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("text", text)
        .text("start_time", start_time.to_string())
        .text("end_time", end_time.to_string());

    let align_url = format!("{}/api/v1/align_line", server_url.trim_end_matches('/'));

    let response = client.post(&align_url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("网络上传请求失败: {}", e))?;

    if !response.status().is_success() {
        let err_text = response.text().await.unwrap_or_else(|_| "服务器异常".into());
        return Err(format!("AI 校准失败: {}", err_text));
    }

    let json_res = response.text().await.map_err(|e| e.to_string())?;
    Ok(json_res)
}

#[tauri::command]
fn save_lyrics_cache(audio_path: String, json_content: String) -> Result<(), String> {
    let path = Path::new(&audio_path);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = path.parent().unwrap_or(Path::new("."));
    let lyrics_json_path = parent.join(format!("{}.json", stem));
    
    std::fs::write(lyrics_json_path, json_content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_lyrics(audio_path: String) -> Result<LyricsResult, String> {
    let path = Path::new(&audio_path);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let parent = path.parent().unwrap_or(Path::new("."));

    // 1. 优先读取音频内嵌的歌词 (Metadata embedded lyrics)
    if let Some(text) = read_embedded_lyrics(path) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            let ltype = if trimmed.starts_with('{') || trimmed.starts_with("[{") {
                "json"
            } else if text.contains("<tt") || text.contains("</tt>") {
                "ttml"
            } else {
                "lrc"
            };
            return Ok(LyricsResult { lyrics_type: ltype.into(), content: text });
        }
    }

    // 2. 其次读取外部高保真 AI 缓存的 .json 歌词
    let json_path = parent.join(format!("{}.json", stem));
    if json_path.exists() {
        let content = std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?;
        return Ok(LyricsResult { lyrics_type: "json".into(), content });
    }

    // 3. 其次读取外部 .ttml 歌词
    let ttml_path = parent.join(format!("{}.ttml", stem));
    if ttml_path.exists() {
        let content = std::fs::read_to_string(&ttml_path).map_err(|e| e.to_string())?;
        return Ok(LyricsResult { lyrics_type: "ttml".into(), content });
    }

    // 4. 最后读取外部 .lrc 歌词
    let lrc_path = parent.join(format!("{}.lrc", stem));
    if lrc_path.exists() {
        let content = std::fs::read_to_string(&lrc_path).map_err(|e| e.to_string())?;
        return Ok(LyricsResult { lyrics_type: "lrc".into(), content });
    }

    Ok(LyricsResult { lyrics_type: "none".into(), content: String::new() })
}

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: tauri::Window) -> Result<(), String> {
    if let Ok(is_max) = window.is_maximized() {
        if is_max {
            window.unmaximize().map_err(|e| e.to_string())?;
        } else {
            window.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    if window.label() == "main" {
        window.app_handle().exit(0);
        Ok(())
    } else {
        window.close().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn show_in_folder(path: String) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("File does not exist".into());
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg("/select,")
            .arg(path_obj)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(parent) = path_obj.parent() {
            // Fallback for macOS/Linux
            let _ = open::that(parent);
        }
    }
    Ok(())
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) -> Result<bool, String> {
    let is_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(!is_fullscreen).map_err(|e| e.to_string())?;
    Ok(!is_fullscreen)
}

#[tauri::command]
fn set_fullscreen(window: tauri::Window, fullscreen: bool) -> Result<(), String> {
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn is_fullscreen(window: tauri::Window) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_prevent_sleep(prevent: bool) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(windows_sleep::prevent_sleep(prevent))
    }
    #[cfg(not(target_os = "windows"))]
    {
        // 非 Windows 平台暂不支持
        Ok(false)
    }
}

#[tauri::command]
fn is_sleep_prevented() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(windows_sleep::is_sleep_prevented())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

// ═══════════════════════════════════════════════════════════════
// LunaBeat 局域网音源 HTTP 代理（绕过 CORS + SSRF 防护 + 自动重连）
// ═══════════════════════════════════════════════════════════════

use std::collections::HashSet;

static LUNA_COOKIE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static LUNA_ALLOWED_HOSTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static LUNA_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn luna_cookie_store() -> &'static Mutex<Option<String>> {
    LUNA_COOKIE.get_or_init(|| Mutex::new(None))
}

fn luna_allowed_hosts() -> &'static Mutex<HashSet<String>> {
    LUNA_ALLOWED_HOSTS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 全局复用的 reqwest::Client（连接池 + TLS 会话复用，避免每次请求重建客户端）
/// 不设全局超时，由各调用方按需用 .timeout() 覆盖
fn luna_http_client() -> &'static reqwest::Client {
    LUNA_HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("reqwest::Client 构建失败")
    })
}

/// 从 URL 字符串解析 host 与 port（仅支持 http/https），返回 (host, port)
fn parse_luna_host_port(raw_url: &str) -> Option<(String, u16)> {
    let after_scheme = if raw_url.starts_with("http://") {
        &raw_url[7..]
    } else if raw_url.starts_with("https://") {
        &raw_url[8..]
    } else {
        return None;
    };
    let end = after_scheme.find(|c| c == '/' || c == '?' || c == '#').unwrap_or(after_scheme.len());
    let host_port = &after_scheme[..end];
    let (host, port) = if let Some(colon_idx) = host_port.rfind(':') {
        let h = &host_port[..colon_idx];
        // 支持 [::1]:8080 形式的 IPv6
        if h.starts_with('[') && h.ends_with(']') {
            let inner = &h[1..h.len() - 1];
            let p: u16 = host_port[colon_idx + 1..].parse().ok()?;
            (inner.to_string(), p)
        } else {
            let p: u16 = host_port[colon_idx + 1..].parse().ok()?;
            (h.to_string(), p)
        }
    } else {
        (host_port.to_string(), if raw_url.starts_with("https://") { 443 } else { 80 })
    };
    if host.is_empty() { return None; }
    Some((host, port))
}

/// 校验 URL 是否在已认证的 LunaBeat 服务器白名单内（SSRF 防护）
fn validate_luna_url(raw_url: &str) -> Result<(), String> {
    if !raw_url.starts_with("http://") && !raw_url.starts_with("https://") {
        return Err("仅支持 http/https 协议".into());
    }
    let (host, port) = parse_luna_host_port(raw_url).ok_or("无效的 URL")?;
    let host_key = format!("{}:{}", host, port);
    let hosts = luna_allowed_hosts().lock().map_err(|e| e.to_string())?;
    if hosts.is_empty() {
        return Err("LunaBeat 尚未认证".into());
    }
    if !hosts.contains(&host_key) {
        return Err(format!("目标主机不在已认证列表: {}", host_key));
    }
    Ok(())
}

#[tauri::command]
async fn luna_proxy_get(url: String) -> Result<String, String> {
    validate_luna_url(&url)?;
    let client = luna_http_client();

    // 取出 cookie 后立即 drop guard，避免跨 await 持锁
    let cookie = {
        let guard = luna_cookie_store().lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(30));
    if let Some(ref c) = cookie {
        req = req.header("Cookie", c);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;

    // 401 / pairing_required：清除认证态，提示前端重新登录
    let status = resp.status();
    if status.as_u16() == 401 {
        let mut store = luna_cookie_store().lock().map_err(|e| e.to_string())?;
        *store = None;
        return Err("pairing_required".into());
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if text.contains("\"pairing_required\"") || text.contains("\"error\":\"pairing_required\"") {
        let mut store = luna_cookie_store().lock().map_err(|e| e.to_string())?;
        *store = None;
        return Err("pairing_required".into());
    }
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }
    Ok(text)
}

#[tauri::command]
async fn luna_proxy_post(url: String, body: String) -> Result<String, String> {
    let (host, port) = parse_luna_host_port(&url).ok_or("无效的 URL".to_string())?;
    let host_key = format!("{}:{}", host, port);
    let is_auth_request = url.contains("/api/auth");

    // 非认证请求需要校验白名单；认证请求允许任意 host，成功后再加入白名单
    if !is_auth_request {
        validate_luna_url(&url)?;
    }

    let client = luna_http_client();

    let cookie = {
        let guard = luna_cookie_store().lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let mut req = client.post(&url)
        .timeout(std::time::Duration::from_secs(30))
        .header("Content-Type", "application/json")
        .body(body);
    if let Some(ref c) = cookie {
        req = req.header("Cookie", c);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;

    // 保存 cookie（加锁后立即释放）
    if let Some(set_cookie) = resp.headers().get("set-cookie") {
        if let Ok(cookie_str) = set_cookie.to_str() {
            let session_cookie = cookie_str.split(';').next().unwrap_or("").to_string();
            if !session_cookie.is_empty() {
                let mut store = luna_cookie_store().lock().map_err(|e| e.to_string())?;
                *store = Some(session_cookie);
            }
        }
    }

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    // 认证成功：单服务器场景先清空白名单再加入新 host，防止旧 host 残留被滥用
    if is_auth_request && status.is_success() {
        if text.contains("\"authenticated\"") && text.contains("true") {
            let mut hosts = luna_allowed_hosts().lock().map_err(|e| e.to_string())?;
            hosts.clear();
            hosts.insert(host_key);
        }
    }

    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }
    Ok(text)
}

#[tauri::command]
async fn luna_proxy_download(url: String) -> Result<Vec<u8>, String> {
    validate_luna_url(&url)?;
    let client = luna_http_client();

    let cookie = {
        let guard = luna_cookie_store().lock().map_err(|e| e.to_string())?;
        guard.clone()
    };

    let mut req = client.get(&url).timeout(std::time::Duration::from_secs(300));
    if let Some(ref c) = cookie {
        req = req.header("Cookie", c);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    if status.as_u16() == 401 {
        let mut store = luna_cookie_store().lock().map_err(|e| e.to_string())?;
        *store = None;
        return Err("pairing_required".into());
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

// ═══════════════════════════════════════════════════════════════
// LunaBeat 本地 HTTP 音频流代理服务器（分段 Range 请求 + 流式播放）
// ═══════════════════════════════════════════════════════════════

use std::sync::atomic::{AtomicU16, Ordering};
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

static LUNA_PROXY_PORT: AtomicU16 = AtomicU16::new(0);

#[tauri::command]
fn get_luna_proxy_port() -> u16 {
    LUNA_PROXY_PORT.load(Ordering::Relaxed)
}

fn percent_decode_url(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = s.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            if let (Some(h1), Some(h2)) = (h1, h2) {
                let hex_str = [h1, h2];
                if let Ok(s) = std::str::from_utf8(&hex_str) {
                    if let Ok(val) = u8::from_str_radix(s, 16) {
                        bytes.push(val);
                        continue;
                    }
                }
            }
        } else if b == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8_lossy(&bytes).to_string()
}

/// 在缓冲区中查找 HTTP 请求头结束标志 \r\n\r\n，返回其起始位置
fn find_header_end(buf: &[u8]) -> Option<usize> {
    if buf.len() < 4 { return None; }
    for i in 0..=(buf.len() - 4) {
        if &buf[i..i + 4] == b"\r\n\r\n" {
            return Some(i);
        }
    }
    None
}

fn start_luna_audio_proxy_server() {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind("127.0.0.1:0").await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[LunaProxyServer] 无法绑定端口: {}", e);
                return;
            }
        };

        if let Ok(addr) = listener.local_addr() {
            let port = addr.port();
            LUNA_PROXY_PORT.store(port, Ordering::Relaxed);
            println!("[LunaProxyServer] 本地音频流式代理已启动: http://127.0.0.1:{}", port);
        }

        // 并发限流：用户快速拖动进度条会触发多个 Range 请求，旧连接不主动取消会堆积
        // 占用文件描述符和上游带宽。最多 4 个并发，超出时排队等待
        let concurrency_limit = Arc::new(tokio::sync::Semaphore::new(4));

        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(res) => res,
                Err(_) => continue,
            };

            let permit_clone = concurrency_limit.clone();
            tauri::async_runtime::spawn(async move {
                // 循环读取直到遇到 \r\n\r\n（请求头结束），最多 64KB 避免恶意长头
                let mut buf: Vec<u8> = Vec::with_capacity(8192);
                let mut tmp = [0u8; 4096];
                let header_end_pos;
                loop {
                    let n = match socket.read(&mut tmp).await {
                        Ok(n) if n > 0 => n,
                        _ => return,
                    };
                    buf.extend_from_slice(&tmp[..n]);
                    if let Some(pos) = find_header_end(&buf) {
                        header_end_pos = pos;
                        break;
                    }
                    if buf.len() > 65536 {
                        let _ = socket.write_all(b"HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n").await;
                        return;
                    }
                }
                let req_str = String::from_utf8_lossy(&buf[..header_end_pos + 4]);

                let first_line = req_str.lines().next().unwrap_or("");
                if !first_line.starts_with("GET ") {
                    let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n").await;
                    return;
                }

                // 提取 Range 请求头（用于 HTML5 <audio> 分段拖动 Seeking）
                let mut range_header: Option<String> = None;
                for line in req_str.lines() {
                    let line_lower = line.to_lowercase();
                    if line_lower.starts_with("range:") {
                        range_header = Some(line[6..].trim().to_string());
                        break;
                    }
                }

                // 提取 URL 中的 target url
                let path_and_query = first_line.split_whitespace().nth(1).unwrap_or("");
                let raw_url = if let Some(idx) = path_and_query.find("url=") {
                    &path_and_query[idx + 4..]
                } else {
                    ""
                };
                let target_url = percent_decode_url(raw_url.split('&').next().unwrap_or(raw_url));

                if target_url.is_empty() {
                    let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n").await;
                    return;
                }

                // SSRF 防护：校验目标 URL 必须在已认证的 LunaBeat 服务器白名单内
                if let Err(err_msg) = validate_luna_url(&target_url) {
                    let resp = format!("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n{}", err_msg);
                    let _ = socket.write_all(resp.as_bytes()).await;
                    return;
                }

                // 获取并发许可：在所有快速失败检查通过后再占用配额，避免无效请求挤占真实播放请求
                let _permit = match permit_clone.acquire().await {
                    Ok(p) => p,
                    Err(_) => return,
                };

                let cookie = {
                    let guard = luna_cookie_store().lock().unwrap_or_else(|e| e.into_inner());
                    guard.clone()
                };

                let client = luna_http_client();

                let mut req = client.get(&target_url);
                if let Some(ref c) = cookie {
                    req = req.header("Cookie", c);
                }
                if let Some(ref r) = range_header {
                    req = req.header("Range", r);
                }

                let mut resp = match req.send().await {
                    Ok(r) => r,
                    Err(e) => {
                        let err_resp = format!("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n{}", e);
                        let _ = socket.write_all(err_resp.as_bytes()).await;
                        return;
                    }
                };

                let status = resp.status();
                let status_code = status.as_u16();
                let status_text = status.canonical_reason().unwrap_or("OK");

                let mut response_headers = format!(
                    "HTTP/1.1 {} {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\n",
                    status_code, status_text
                );

                // 检测上游是否使用 Transfer-Encoding: chunked
                // 若是，则不透传 content-length（reqwest 已解码 chunk，原长度已不匹配）
                let is_chunked = resp.headers().get("transfer-encoding")
                    .and_then(|v| v.to_str().ok())
                    .map(|v| v.to_lowercase().contains("chunked"))
                    .unwrap_or(false);

                for header_name in &["content-type", "content-length", "content-range", "accept-ranges"] {
                    if *header_name == "content-length" && is_chunked {
                        continue;
                    }
                    if let Some(val) = resp.headers().get(*header_name) {
                        if let Ok(v_str) = val.to_str() {
                            response_headers.push_str(&format!("{}: {}\r\n", header_name, v_str));
                        }
                    }
                }
                response_headers.push_str("Connection: close\r\n\r\n");

                if socket.write_all(response_headers.as_bytes()).await.is_err() {
                    return;
                }

                // 边接收 reqwest 字节块边实时写入 TCP socket，实现流式开播
                // 写入失败（对端关闭）即跳出，释放 permit 让排队请求继续
                while let Ok(Some(chunk)) = resp.chunk().await {
                    if socket.write_all(&chunk).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// 网易云音乐评论 API
// ═══════════════════════════════════════════════════════════════

use serde::Deserialize;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommentUser {
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub user_id: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SongComment {
    pub comment_id: u64,
    pub content: String,
    pub user: CommentUser,
    pub time: u64,
    pub liked_count: Option<u32>,
    pub reply_count: Option<u32>,
    #[serde(default)]
    pub is_hot: bool,
    pub ip_location: Option<String>,
    pub platform: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
    pub target_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommentReply {
    pub comment_id: u64,
    pub content: String,
    pub user: CommentUser,
    pub time: u64,
    pub liked_count: Option<u32>,
    pub be_replied_user: Option<CommentUser>,
    pub ip_location: Option<String>,
    pub platform: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
}

#[derive(Debug)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentResult {
    pub comments: Vec<SongComment>,
    pub total: u32,
    pub has_more: bool,
    pub cursor: Option<String>,
}

#[derive(Debug)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyResult {
    pub replies: Vec<CommentReply>,
    pub total: u32,
    pub has_more: bool,
    pub cursor: Option<String>,
}

// ═══════════════════════════════════════════════════════════════
// 多平台评论数据结构
// ═══════════════════════════════════════════════════════════════

#[derive(Debug, Clone)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCommentResult {
    pub platform: String,
    pub comments: Vec<SongComment>,
    pub total: u32,
    pub has_more: bool,
    pub error: Option<String>,
}

#[derive(Debug)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiPlatformCommentResult {
    pub platforms: Vec<PlatformCommentResult>,
}

#[derive(Debug)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongSearchItem {
    pub id: u64,
    pub name: String,
    pub artists: Vec<SongArtist>,
    pub album: Option<SongAlbum>,
    pub duration: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SongArtist {
    pub name: String,
    pub id: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SongAlbum {
    pub name: Option<String>,
    pub id: Option<u64>,
}

#[derive(Debug)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongSearchResult {
    pub songs: Vec<SongSearchItem>,
    pub total: u32,
}

/// 搜索网易云音乐歌曲（用于匹配本地歌曲获取 songId）
#[tauri::command]
async fn search_song_for_comments(keyword: String, title: Option<String>, artist: Option<String>) -> Result<SongSearchResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;

    let params = [
        ("s", keyword.as_str()),
        ("type", "1"),
        ("limit", "5"),
        ("offset", "0"),
    ];

    let resp = client
        .post("https://music.163.com/api/search/get")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("搜索请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("搜索失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("解析搜索结果失败: {}", e))?;

    let result = body.get("result").and_then(|r| r.get("songs")).cloned().unwrap_or(serde_json::Value::Array(vec![]));
    let total = body.get("result").and_then(|r| r.get("songCount")).and_then(|c| c.as_u64()).unwrap_or(0) as u32;

    // 打印搜索日志
    eprintln!("[网易云搜索] 搜索关键词: {}, 结果数: {}", keyword, total);

    let mut songs = Vec::new();
    if let Some(arr) = result.as_array() {
        for item in arr {
            let id = item.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let duration = item.get("dt").and_then(|v| v.as_u64()).map(|ms| ms / 1000);

            let artists = item.get("artists")
                .and_then(|a| a.as_array())
                .map(|arr| {
                    arr.iter().map(|a| SongArtist {
                        name: a.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        id: a.get("id").and_then(|v| v.as_u64()),
                    }).collect()
                })
                .unwrap_or_default();

            let album = item.get("album").and_then(|a| {
                Some(SongAlbum {
                    name: a.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    id: a.get("id").and_then(|v| v.as_u64()),
                })
            });

            songs.push(SongSearchItem { id, name, artists, album, duration });
        }
    }

    // 如果提供了 title 和 artist，按匹配度排序
    if let Some(ref target_title) = title {
        let target_lower = target_title.to_lowercase();
        let target_artist_lower = artist.as_ref().map(|a| a.to_lowercase());

        songs.sort_by(|a, b| {
            let a_name_lower = a.name.to_lowercase();
            let b_name_lower = b.name.to_lowercase();
            let a_album_lower = a.album.as_ref().and_then(|al| al.name.as_deref()).unwrap_or("").to_lowercase();
            let b_album_lower = b.album.as_ref().and_then(|al| al.name.as_deref()).unwrap_or("").to_lowercase();

            // 计算匹配分数
            let a_name_exact = a_name_lower == target_lower;
            let b_name_exact = b_name_lower == target_lower;
            let a_album_match = !a_album_lower.is_empty() && (a_album_lower.contains(&target_lower) || target_lower.contains(&a_album_lower));
            let b_album_match = !b_album_lower.is_empty() && (b_album_lower.contains(&target_lower) || target_lower.contains(&b_album_lower));

            let mut a_score = if a_name_exact { 100 } else if a_name_lower.contains(&target_lower) || target_lower.contains(&a_name_lower) { 50 } else { 0 };
            let mut b_score = if b_name_exact { 100 } else if b_name_lower.contains(&target_lower) || target_lower.contains(&b_name_lower) { 50 } else { 0 };

            if a_album_match { a_score += 20; }
            if b_album_match { b_score += 20; }

            if let Some(ref target_art) = target_artist_lower {
                let a_artist_match = a.artists.iter().any(|ar| {
                    let ar_lower = ar.name.to_lowercase();
                    ar_lower.contains(target_art) || target_art.contains(&ar_lower)
                });
                let b_artist_match = b.artists.iter().any(|ar| {
                    let ar_lower = ar.name.to_lowercase();
                    ar_lower.contains(target_art) || target_art.contains(&ar_lower)
                });
                if a_artist_match { a_score += 30; }
                if b_artist_match { b_score += 30; }
            }

            b_score.cmp(&a_score)
        });
    }

    Ok(SongSearchResult { songs, total })
}

/// 获取歌曲热评
/// 
/// 使用正确的 API 端点: /api/v1/resource/comments/R_SO_4_{songId}
#[tauri::command]
async fn fetch_song_comments(song_id: u64, cursor: Option<String>, limit: Option<u32>) -> Result<CommentResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;
    let page_limit = limit.unwrap_or(20);
    
    // 解析 offset（用于分页）
    let offset = cursor
        .and_then(|c| c.parse::<u32>().ok())
        .unwrap_or(0);

    let url = format!(
        "https://music.163.com/api/v1/resource/comments/R_SO_4_{}?limit={}&offset={}",
        song_id, page_limit, offset
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("获取评论失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("获取评论失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("解析评论失败: {}", e))?;

    // 检查 API 返回状态
    let code = body.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
    if code != 200 {
        return Err(format!("API错误: code={}", code));
    }

    let total = body.get("total").and_then(|c| c.as_u64()).unwrap_or(0) as u32;
    let has_more = body.get("more").and_then(|m| m.as_bool()).unwrap_or(false);
    
    // 计算下一个 cursor
    let new_cursor = if has_more {
        Some((offset + page_limit).to_string())
    } else {
        None
    };

    let mut comments = Vec::new();
    
    // 先添加热门评论（带热门标签）
    let wy_target_id = Some(song_id.to_string());
    if let Some(arr) = body.get("hotComments").and_then(|c| c.as_array()) {
        for item in arr {
            let mut comment = parse_song_comment(item, wy_target_id.clone());
            comment.is_hot = true;
            comments.push(comment);
        }
    }
    
    // 再添加普通评论
    if let Some(arr) = body.get("comments").and_then(|c| c.as_array()) {
        for item in arr {
            let comment = parse_song_comment(item, wy_target_id.clone());
            comments.push(comment);
        }
    }

    Ok(CommentResult { comments, total, has_more, cursor: new_cursor })
}

/// 获取评论回复
/// 
/// 使用正确的 API 端点: /api/v1/resource/comments/R_SO_4_{songId}?commentId={commentId}
#[tauri::command]
async fn fetch_comment_replies(
    song_id: u64,
    comment_id: u64,
    page: Option<u32>,
    limit: Option<u32>,
    platform: Option<String>,
    target_id: Option<String>,
    cursor: Option<String>,
) -> Result<ReplyResult, String> {
    let plat = platform.unwrap_or_else(|| "wy".to_string());
    match plat.as_str() {
        "kw" | "kuwo" => {
            let kw_id = target_id
                .as_ref()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(song_id);
            fetch_kuwo_comment_replies(kw_id, comment_id, page, limit).await
        }
        "qq" => {
            let qq_id = target_id
                .as_ref()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(song_id);
            fetch_qq_comment_replies(qq_id, comment_id, page, limit).await
        }
        "kg" | "kugou" => {
            let hash = target_id.unwrap_or_else(|| song_id.to_string());
            fetch_kugou_comment_replies(hash, comment_id, page, limit).await
        }
        _ => {
            let wy_id = target_id
                .as_ref()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(song_id);
            fetch_netease_comment_replies(wy_id, comment_id, page, limit, cursor).await
        }
    }
}

/// 获取网易云音乐评论回复
async fn fetch_netease_comment_replies(
    song_id: u64,
    comment_id: u64,
    page: Option<u32>,
    limit: Option<u32>,
    cursor: Option<String>,
) -> Result<ReplyResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;
    let page_limit = limit.unwrap_or(20);

    // 游标分页：首次 -1，后续用上一页最后一条的 time
    let time = cursor.unwrap_or_else(|| "-1".to_string());

    // 网易云回复 API：POST /api/resource/comment/floor/get
    let url = "https://music.163.com/api/resource/comment/floor/get";
    let body_str = format!(
        "threadId=R_SO_4_{}&parentCommentId={}&limit={}&time={}",
        song_id, comment_id, page_limit, time
    );

    let resp = client
        .post(url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Referer", "https://music.163.com/")
        .body(body_str)
        .send()
        .await
        .map_err(|e| format!("获取回复失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("获取回复失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("解析回复失败: {}", e))?;

    let code = body.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
    if code != 200 {
        return Err(format!("API错误: code={}", code));
    }

    // floor API 返回结构：data.comments 或直接 comments
    let data_obj = body.get("data");
    let comments_arr = data_obj.and_then(|d| d.get("comments"))
        .or_else(|| body.get("comments"))
        .and_then(|c| c.as_array());

    let mut replies = Vec::new();
    if let Some(arr) = comments_arr {
        for item in arr {
            let reply = parse_comment_reply(item);
            replies.push(reply);
        }
    }

    let total = data_obj.and_then(|d| d.get("total"))
        .or_else(|| body.get("total"))
        .and_then(|t| t.as_u64())
        .unwrap_or(replies.len() as u64) as u32;

    // floor API 返回 data.hasMore 和 data.time 用于分页
    let has_more = data_obj.and_then(|d| d.get("hasMore")).and_then(|m| m.as_bool()).unwrap_or(false);
    // 游标用 data.time（毫秒时间戳）
    let next_cursor = if has_more {
        data_obj.and_then(|d| d.get("time")).and_then(|t| t.as_u64()).map(|t| t.to_string())
    } else {
        None
    };

    Ok(ReplyResult { replies, total, has_more, cursor: next_cursor })
}

/// 获取酷我音乐评论回复
async fn fetch_kuwo_comment_replies(
    song_id: u64,
    comment_id: u64,
    page: Option<u32>,
    limit: Option<u32>,
) -> Result<ReplyResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;

    let page_num = page.unwrap_or(1);
    let page_limit = limit.unwrap_or(20);
    let start = (page_num - 1) * page_limit;
    let req_id = generate_kuwo_req_id();

    // 酷我回复API：sid 为歌曲 ID, pid 为主评论 ID
    let url = format!(
        "http://ncomment.kuwo.cn/com.s?f=web&type=get_reply_comment&aapiver=1&prod=kwplayer_ar_10.5.2.0&digest=15&sid={}&pid={}&start={}&count={}&newver=3&uid=0&reqId={}",
        song_id, comment_id, start, page_limit, req_id
    );

    let resp = client.get(&url)
        .header("Referer", "https://www.kuwo.cn/")
        .header("Cookie", "kw_token=AFDCMVOU717")
        .header("csrf", "AFDCMVOU717")
        .send().await.map_err(|e| format!("酷我回复请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("酷我回复请求失败: HTTP {}", resp.status()));
    }

    let mut body: serde_json::Value = resp.json().await.map_err(|e| format!("酷我回复解析失败: {}", e))?;

    let mut code_valid = body.get("code").map(|c| {
        c.as_str().map(|s| s == "200").or_else(|| c.as_i64().map(|n| n == 200)).unwrap_or(false)
    }).unwrap_or(false);

    // 如果失败(返回 600)，自动备用 pid=0 尝试
    if !code_valid {
        let retry_url = format!(
            "http://ncomment.kuwo.cn/com.s?f=web&type=get_reply_comment&aapiver=1&prod=kwplayer_ar_10.5.2.0&digest=15&sid={}&pid=0&start={}&count={}&newver=3&uid=0&reqId={}",
            song_id, start, page_limit, req_id
        );
        if let Ok(r) = client.get(&retry_url)
            .header("Referer", "https://www.kuwo.cn/")
            .header("Cookie", "kw_token=AFDCMVOU717")
            .header("csrf", "AFDCMVOU717")
            .send().await {
            if let Ok(b) = r.json::<serde_json::Value>().await {
                let retry_code_valid = b.get("code").map(|c| {
                    c.as_str().map(|s| s == "200").or_else(|| c.as_i64().map(|n| n == 200)).unwrap_or(false)
                }).unwrap_or(false);
                if retry_code_valid {
                    body = b;
                    code_valid = true;
                }
            }
        }
    }

    if !code_valid {
        return Err(format!("酷我回复API错误: code={:?}", body.get("code")));
    }

        // 解析回复列表
    let mut replies = Vec::new();

    // 收集所有可能的回复数组
    let mut all_items: Vec<&serde_json::Value> = Vec::new();

    // 尝试 data.list 格式
    if let Some(arr) = body.get("data").and_then(|d| d.get("list")).and_then(|l| l.as_array()) {
        all_items.extend(arr.iter());
    }
    // 也尝试 data.replyList
    if let Some(arr) = body.get("data").and_then(|d| d.get("replyList")).and_then(|l| l.as_array()) {
        all_items.extend(arr.iter());
    }
    // 也尝试 data.comments
    if let Some(arr) = body.get("data").and_then(|d| d.get("comments")).and_then(|l| l.as_array()) {
        all_items.extend(arr.iter());
    }
    // 也尝试顶层 comments
    if let Some(arr) = body.get("comments").and_then(|l| l.as_array()) {
        all_items.extend(arr.iter());
    }

    // 如果还没找到，遍历 data 下所有字段
    if all_items.is_empty() {
        if let Some(obj) = body.get("data").and_then(|d| d.as_object()) {
            for (_key, val) in obj {
                if let Some(arr) = val.as_array() {
                    all_items.extend(arr.iter());
                }
            }
        }
    }

    for item in all_items {
        let reply = parse_kuwo_comment_reply(item);
        replies.push(reply);
    }

    let total = replies.len() as u32;
    let has_more = total >= page_limit;

    Ok(ReplyResult { replies, total, has_more, cursor: None })
}

/// 解析酷我评论回复
fn parse_kuwo_comment_reply(item: &serde_json::Value) -> CommentReply {
    let comment_id = item.get("id").and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| item.get("commentId").and_then(|v| v.as_u64()))
        .unwrap_or(0);

    let content = item.get("msg").and_then(|v| v.as_str())
        .or_else(|| item.get("content").and_then(|v| v.as_str()))
        .unwrap_or("").to_string();

    let time = item.get("time").and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .or_else(|| item.get("time").and_then(|v| v.as_u64()))
        .unwrap_or(0);

    let liked_count = item.get("like_num").and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u32>().ok())
        .or_else(|| item.get("likedCount").and_then(|v| v.as_u64()).map(|c| c as u32));

    let user = CommentUser {
        nickname: item.get("u_name").and_then(|v| v.as_str())
            .or_else(|| item.get("nickname").and_then(|v| v.as_str()))
            .unwrap_or("匿名").to_string(),
        avatar_url: item.get("u_pic").and_then(|v| v.as_str())
            .or_else(|| item.get("avatarUrl").and_then(|v| v.as_str()))
            .map(|s| s.to_string()),
        user_id: item.get("u_id").and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u64>().ok())
            .or_else(|| item.get("userId").and_then(|v| v.as_u64())),
    };

    // 被回复的用户
    let be_replied_user = item.get("reply_u_name").and_then(|u| {
        if u.is_null() { return None; }
        Some(CommentUser {
            nickname: u.as_str().unwrap_or("匿名").to_string(),
            avatar_url: None,
            user_id: None,
        })
    });

                CommentReply {
        comment_id, content, user, time: time * 1000, liked_count,
        be_replied_user, ip_location: None, platform: Some("kw".to_string()), images: vec![],
    }
}

/// 获取QQ音乐评论回复
async fn fetch_qq_comment_replies(
    song_id: u64,
    comment_id: u64,
    page: Option<u32>,
    limit: Option<u32>,
) -> Result<ReplyResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;
    let page_num = page.unwrap_or(1);
    let page_limit = limit.unwrap_or(20);

    // QQ音乐回复API
    let url = format!(
        "https://c.y.qq.com/base/fcgi-bin/comment_lib.fcg?reqtype=2&biztype=1&topid={}&rootcommentid={}&pagenum={}&pagesize={}&format=json",
        song_id, comment_id, page_num - 1, page_limit
    );

    let resp = client.get(&url)
        .header("Referer", "https://y.qq.com/")
        .send().await.map_err(|e| format!("QQ回复请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("QQ回复请求失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("QQ回复解析失败: {}", e))?;

    eprintln!("[QQ回复] topid={}, rootcommentid={}, body keys: {:?}", song_id, comment_id,
        body.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()));

    let mut replies = Vec::new();
    if let Some(arr) = body.get("commentlist").and_then(|r| r.as_array()) {
        for item in arr {
            let reply = parse_qq_comment_reply(item);
            replies.push(reply);
        }
    }

    let total = replies.len() as u32;
    let has_more = total >= page_limit;

    Ok(ReplyResult { replies, total, has_more, cursor: None })
}

/// 解析QQ音乐评论回复
fn parse_qq_comment_reply(item: &serde_json::Value) -> CommentReply {
    let comment_id = item.get("commentid").and_then(|v| v.as_u64()).unwrap_or(0);
    let content = item.get("rootcommentcontent").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let time = item.get("time").and_then(|v| v.as_u64()).unwrap_or(0).saturating_mul(1000);
    let liked_count = item.get("praisenum").and_then(|v| v.as_u64()).map(|c| c as u32);

    let user = CommentUser {
        nickname: item.get("nick").and_then(|v| v.as_str()).unwrap_or("匿名").to_string(),
        avatar_url: item.get("avatarurl").and_then(|v| v.as_str()).map(|s| s.to_string()),
        user_id: item.get("uin").and_then(|v| v.as_u64()),
    };

    // 被回复的用户
    let be_replied_user = item.get("replyname").and_then(|n| {
        if n.is_null() || n.as_str().unwrap_or("").is_empty() { return None; }
        Some(CommentUser {
            nickname: n.as_str().unwrap_or("匿名").to_string(),
            avatar_url: None,
            user_id: None,
        })
    });

        CommentReply {
        comment_id, content, user, time, liked_count,
        be_replied_user, ip_location: None, platform: Some("qq".to_string()), images: vec![],
    }
}

/// 获取酷狗评论回复
async fn fetch_kugou_comment_replies(
    hash: String,
    comment_id: u64,
    page: Option<u32>,
    limit: Option<u32>,
) -> Result<ReplyResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;
    let page_num = page.unwrap_or(1);
    let page_limit = limit.unwrap_or(20);

    // 酷狗回复API - 需要hash参数，这里用comment_id作为parent_id
    let url = format!(
        "http://m.comment.service.kugou.com/index.php?r=commentsv2/getcommentwithlike&extdata={}&code=fc4be23b4e972707f36b8a828a93ba8a&appid=1005&p={}&pagesize={}&parent_id={}",
        hash, page_num, page_limit, comment_id
    );

    let resp = client.get(&url)
        .header("Referer", "https://www.kugou.com/")
        .send().await.map_err(|e| format!("酷狗回复请求失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("酷狗回复请求失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("酷狗回复解析失败: {}", e))?;

    let mut replies = Vec::new();
    if let Some(arr) = body.get("list").and_then(|r| r.as_array()) {
        for item in arr {
            let reply = parse_kugou_comment_reply(item);
            replies.push(reply);
        }
    }

    let total = replies.len() as u32;
    let has_more = total >= page_limit;

    Ok(ReplyResult { replies, total, has_more, cursor: None })
}

/// 解析酷狗评论回复
fn parse_kugou_comment_reply(item: &serde_json::Value) -> CommentReply {
    let comment_id = item.get("id").and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let content = item.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let liked_count = item.get("like").and_then(|l| l.get("likenum")).and_then(|v| v.as_u64()).map(|c| c as u32);

    // 酷狗时间格式: "2018-06-09 08:18:42"
    let time = item.get("addtime").and_then(|v| v.as_str())
        .and_then(|s| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok())
        .map(|t| t.and_utc().timestamp_millis() as u64)
        .unwrap_or(0);

    let user = CommentUser {
        nickname: item.get("user_name").and_then(|v| v.as_str()).unwrap_or("匿名").to_string(),
        avatar_url: item.get("user_pic").and_then(|v| v.as_str()).map(|s| s.to_string()),
        user_id: item.get("user_id").and_then(|v| v.as_u64()),
    };

    // 被回复的用户
    let be_replied_user = item.get("reply_user_name").and_then(|n| {
        if n.is_null() || n.as_str().unwrap_or("").is_empty() { return None; }
        Some(CommentUser {
            nickname: n.as_str().unwrap_or("匿名").to_string(),
            avatar_url: None,
            user_id: None,
        })
    });

        CommentReply {
        comment_id, content, user, time, liked_count,
        be_replied_user, ip_location: None, platform: Some("kg".to_string()), images: vec![],
    }
}

fn parse_song_comment(item: &serde_json::Value, target_id: Option<String>) -> SongComment {
    let comment_id = item.get("commentId").and_then(|v| v.as_u64()).unwrap_or(0);
    let content = item.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let time = item.get("time").and_then(|v| v.as_u64()).unwrap_or(0);
    let liked_count = item.get("likedCount").and_then(|v| v.as_u64()).map(|c| c as u32);
    let reply_count = item.get("replyCount").and_then(|v| v.as_u64()).map(|c| c as u32);

    let user = parse_comment_user(item.get("user"));

    // 解析 IP 属地 - ipLocation 是对象，location 字段为属地文本
    let ip_location = item.get("ipLocation")
        .and_then(|v| v.get("location"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    // 解析平台标签 - 尝试多个可能的字段名
    let platform = item.get("platform")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| item.get("source").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .or_else(|| item.get("platformSource").and_then(|v| v.as_str()).map(|s| s.to_string()));

        // 调试日志 - 只输出酷我平台
    if platform.as_deref() == Some("kw") || platform.as_deref() == Some("kuwo") {
        eprintln!("[Comment] id={}, ip={:?}, platform={:?}", comment_id, ip_location, platform);
    }

        // 提取图片URL - 从 richContent 中解析 img 标签
    let images = extract_images_from_html(item.get("richContent").and_then(|v| v.as_str()).unwrap_or(""));

    SongComment { comment_id, content, user, time, liked_count, reply_count, is_hot: false, ip_location, platform, images, target_id }
}

fn parse_comment_reply(item: &serde_json::Value) -> CommentReply {
    let comment_id = item.get("commentId").and_then(|v| v.as_u64()).unwrap_or(0);
    let content = item.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let time = item.get("time").and_then(|v| v.as_u64()).unwrap_or(0);
    let liked_count = item.get("likedCount").and_then(|v| v.as_u64()).map(|c| c as u32);

    let user = parse_comment_user(item.get("user"));
    let be_replied_user = item.get("beRepliedUser").and_then(|u| {
        if u.is_null() { return None; }
        Some(parse_comment_user(Some(u)))
    });

    // 解析 IP 属地 - ipLocation 是对象，location 字段为属地文本
    let ip_location = item.get("ipLocation")
        .and_then(|v| v.get("location"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    // 解析平台标签
    let platform = item.get("platform")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            item.get("source").and_then(|v| v.as_str()).map(|s| s.to_string())
        });

        // 提取图片URL - 从 richContent 中解析 img 标签
    let images = extract_images_from_html(item.get("richContent").and_then(|v| v.as_str()).unwrap_or(""));

    CommentReply { comment_id, content, user, time, liked_count, be_replied_user, ip_location, platform, images }
}

fn parse_comment_user(opt: Option<&serde_json::Value>) -> CommentUser {
    match opt {
        Some(user) if !user.is_null() => {
            CommentUser {
                nickname: user.get("nickname").and_then(|v| v.as_str()).unwrap_or("匿名").to_string(),
                avatar_url: user.get("avatarUrl").and_then(|v| v.as_str()).map(|s| s.to_string()),
                user_id: user.get("userId").and_then(|v| v.as_u64()),
            }
        }
                _ => CommentUser {
            nickname: "匿名".to_string(),
            avatar_url: None,
            user_id: None,
        },
    }
}

/// 从HTML内容中提取图片URL
fn extract_images_from_html(html: &str) -> Vec<String> {
    let mut images = Vec::new();
    if html.is_empty() {
        return images;
    }

    // 手动解析 <img src="..."> 标签
    let lower = html.to_lowercase();
    let mut pos = 0;
    while let Some(img_start) = lower[pos..].find("<img") {
        let abs_start = pos + img_start;
        // 找 src= 属性
        if let Some(src_pos) = lower[abs_start..].find("src=") {
            let quote_start = abs_start + src_pos + 4;
            if quote_start >= html.len() { break; }
            let quote_char = html.as_bytes()[quote_start] as char;
            if quote_char == '"' || quote_char == '\'' {
                // 带引号的 src
                if let Some(quote_end) = html[quote_start+1..].find(quote_char) {
                    let url = &html[quote_start+1..quote_start+1+quote_end];
                    // 过滤表情图片
                    let url_lower = url.to_lowercase();
                    if !url_lower.contains("emoji") && !url_lower.contains("smiley") && !url_lower.contains("face") && !url_lower.contains("emot") {
                        images.push(url.to_string());
                    }
                    pos = quote_start + 1 + quote_end + 1;
                } else {
                    break;
                }
            } else {
                // 无引号的 src
                if let Some(space_pos) = html[quote_start..].find(|c: char| c == ' ' || c == '>' || c == '/') {
                    let url = &html[quote_start..quote_start+space_pos];
                    let url_lower = url.to_lowercase();
                    if !url_lower.contains("emoji") && !url_lower.contains("smiley") && !url_lower.contains("face") && !url_lower.contains("emot") {
                        images.push(url.to_string());
                    }
                    pos = quote_start + space_pos;
                } else {
                    let url = &html[quote_start..];
                    let url_lower = url.to_lowercase();
                    if !url_lower.contains("emoji") && !url_lower.contains("smiley") && !url_lower.contains("face") && !url_lower.contains("emot") {
                        images.push(url.to_string());
                    }
                    break;
                }
            }
        } else {
            pos = abs_start + 4;
        }
    }

    images
}

// ═══════════════════════════════════════════════════════════════
// 多平台评论 API
// ═══════════════════════════════════════════════════════════════

/// 生成酷我音乐 reqId（基于UUID v1算法的变体）
/// 参考：https://www.cnblogs.com/sbhglqy/p/18443120
fn generate_kuwo_req_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    // 固定的 node 数组（从JS逆向获取）
    let m: [u8; 16] = [
        43, 64, 160, 14, 221, 55, 249, 97,
        86, 170, 120, 218, 66, 188, 238, 102
    ];

    let f: [u8; 6] = [m[0], m[1], m[2], m[3], m[4], m[5]];
    let v: u16 = (m[6] as u16) << 8 | m[7] as u16;

    // 获取当前时间戳（毫秒）
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    // 加上 UUID v1 的时间偏移（12219292800000ms = 1582-10-15 00:00:00 UTC）
    let y = now + 122192928_000_000u64;
    let w: u16 = 1; // nsecs counter

    let mut b = [0u8; 18];
    let mut i = 0;

    // 时间低32位
    let a = (10000u64 * (y & 0x0FFF_FFFF) + w as u64) % 4294967296;
    b[i] = (a >> 24) as u8; i += 1;
    b[i] = (a >> 16) as u8; i += 1;
    b[i] = (a >> 8) as u8; i += 1;
    b[i] = a as u8; i += 1;

    // 时间中间16位
    let x = (y as f64 / 4294967296.0 * 10000.0) as u64 & 0x0FFF_FFFF;
    b[i] = (x >> 8) as u8; i += 1;
    b[i] = x as u8; i += 1;
    b[i] = ((x >> 24) as u8 & 0x0F) | 0x10; i += 1; // version 1
    b[i] = (x >> 16) as u8; i += 1;

    // 时钟序列
    b[i] = ((v >> 8) as u8) | 0x80; i += 1; // variant 1
    b[i] = v as u8; i += 1;

    // Node
    for t in 0..6 {
        b[i + t] = f[t];
    }

        // 转换为十六进制字符串（不带破折号）
    let hex: Vec<String> = b.iter().map(|byte| format!("{:02x}", byte)).collect();
    format!("{}{}{}{}{}{}{}{}{}{}{}{}{}{}{}{}",
        hex[0], hex[1], hex[2], hex[3],
        hex[4], hex[5],
        hex[6], hex[7],
        hex[8], hex[9],
        hex[10], hex[11], hex[12], hex[13], hex[14], hex[15]
    )
}

/// 获取酷我音乐评论
#[tauri::command]
async fn fetch_kuwo_comments(song_id: u64, start: Option<u32>, count: Option<u32>) -> Result<CommentResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;

    let page_start = start.unwrap_or(0);
    let page_count = count.unwrap_or(30);
    let req_id = generate_kuwo_req_id();

        // 使用旧端点 + reqId 参数
    let url = format!(
        "http://ncomment.kuwo.cn/com.s?f=web&type=get_rec_comment&aapiver=1&prod=kwplayer_ar_10.5.2.0&digest=15&sid={}&start={}&msgflag=1&count={}&newver=3&uid=0&reqId={}",
        song_id, page_start, page_count, req_id
    );

    let resp = client.get(&url)
        .header("Referer", "https://www.kuwo.cn/")
        .header("Cookie", "kw_token=AFDCMVOU717")
        .header("csrf", "AFDCMVOU717")
        .send().await.map_err(|e| format!("酷我评论请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("酷我评论请求失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("酷我评论解析失败: {}", e))?;

    // 支持两种code格式：字符串"200"或整数200
        let _code = body.get("code").and_then(|c| c.as_str().or_else(|| c.as_i64().map(|_| "")));
    let code_valid = body.get("code").map(|c| {
        c.as_str().map(|s| s == "200").or_else(|| c.as_i64().map(|n| n == 200)).unwrap_or(false)
    }).unwrap_or(false);
    
    if !code_valid {
        return Err(format!("酷我API错误: code={:?}", body.get("code")));
    }

        // 支持多种响应结构：新格式 data.total/data.list 或旧格式 comments_counts/comments/hot_comments
    let (total, comments_list) = if let Some(data) = body.get("data") {
        let total = data.get("total").and_then(|c| c.as_u64()).unwrap_or(0) as u32;
        let list = data.get("list").and_then(|l| l.as_array()).cloned().unwrap_or_default();
        (total, list)
    } else {
        let total = body.get("comments_counts").and_then(|c| c.as_u64()).unwrap_or(0) as u32;
        // 合并 hot_comments 和 comments
        let mut list = body.get("hot_comments").and_then(|l| l.as_array()).cloned().unwrap_or_default();
        if let Some(comments) = body.get("comments").and_then(|l| l.as_array()) {
            list.extend(comments.iter().cloned());
        }
        (total, list)
    };

    let has_more = (page_start + page_count) < total;

    let new_cursor = if has_more {
        Some((page_start + page_count).to_string())
    } else {
        None
    };

        let kw_target_id = Some(song_id.to_string());
    let mut comments = Vec::new();
    for item in &comments_list {
        let comment = parse_kuwo_comment(item, kw_target_id.clone());
        comments.push(comment);
    }

    // 按点赞数降序，前5条标记为热评
    comments.sort_by(|a, b| b.liked_count.unwrap_or(0).cmp(&a.liked_count.unwrap_or(0)));
    for comment in comments.iter_mut().take(5) {
        if comment.liked_count.unwrap_or(0) > 0 {
            comment.is_hot = true;
        }
    }

    Ok(CommentResult { comments, total, has_more, cursor: new_cursor })
}

fn parse_kuwo_comment(item: &serde_json::Value, target_id: Option<String>) -> SongComment {
    let comment_id = item.get("id").and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    // 酷我评论内容在 msg 字段
    let content = item.get("msg").and_then(|v| v.as_str()).unwrap_or("").to_string();
    // 酷我时间是字符串格式的秒级时间戳
    let time = item.get("time").and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    // 酷我点赞数是字符串格式
    let liked_count = item.get("like_num").and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u32>().ok());
    // 酷我回复数在 child_comment_count 字段
    let reply_count = item.get("child_comment_count").and_then(|v| v.as_u64())
        .map(|c| c as u32);

    let user = CommentUser {
        nickname: item.get("u_name").and_then(|v| v.as_str()).unwrap_or("匿名").to_string(),
        avatar_url: item.get("u_pic").and_then(|v| v.as_str()).map(|s| s.to_string()),
        user_id: item.get("u_id").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()),
    };

    SongComment {
        comment_id, content, user, time: time * 1000, liked_count, reply_count,
        is_hot: false, ip_location: None, platform: Some("kw".to_string()), images: vec![],
        target_id,
    }
}

/// 获取QQ音乐评论
#[tauri::command]
async fn fetch_qq_comments(song_id: u64, pagenum: Option<u32>, pagesize: Option<u32>) -> Result<CommentResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;
    let page_num = pagenum.unwrap_or(0);
    let page_size = pagesize.unwrap_or(30);

    let url = format!(
        "https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg?biztype=1&topid={}&cmd=8&pagenum={}&pagesize={}",
        song_id, page_num, page_size
    );

    let resp = client.get(&url)
        .header("Referer", "https://y.qq.com/")
        .send().await.map_err(|e| format!("QQ音乐评论请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("QQ音乐评论请求失败: HTTP {}", resp.status()));
    }

        let body: serde_json::Value = resp.json().await.map_err(|e| format!("QQ音乐评论解析失败: {}", e))?;

    let qq_target_id = Some(song_id.to_string());
    let mut comments = Vec::new();
    let mut total = 0u32;

    // 热门评论
    if let Some(hot) = body.get("hot_comment").and_then(|h| h.get("commentlist")).and_then(|l| l.as_array()) {
        for item in hot {
            let mut comment = parse_qq_comment(item, qq_target_id.clone());
            comment.is_hot = true;
            comments.push(comment);
        }
    }

    // 最新评论
    if let Some(new_comments) = body.get("comment").and_then(|c| c.get("commentlist")).and_then(|l| l.as_array()) {
        // 从API返回的commenttotal字段获取总数（QQ音乐使用commenttotal而非total）
        total = body.get("comment").and_then(|c| c.get("commenttotal")).and_then(|t| t.as_u64()).unwrap_or(new_comments.len() as u64) as u32;
        for (idx, item) in new_comments.iter().enumerate() {
            if idx == 0 && comments.is_empty() { eprintln!("[QQ评论调试] 最新评论: {}", serde_json::to_string_pretty(item).unwrap_or_default()); }
            let comment = parse_qq_comment(item, qq_target_id.clone());
            comments.push(comment);
        }
    }

    let has_more = total >= page_size;
    let new_cursor = if has_more {
        Some((page_num + 1).to_string())
    } else {
        None
    };

    Ok(CommentResult { comments, total, has_more, cursor: new_cursor })
}

fn parse_qq_comment(item: &serde_json::Value, target_id: Option<String>) -> SongComment {
    let comment_id = item.get("commentid").and_then(|v| v.as_u64()).unwrap_or(0);
    let content = item.get("rootcommentcontent").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let time = item.get("time").and_then(|v| v.as_u64()).unwrap_or(0).saturating_mul(1000); // QQ返回秒级时间戳
    let liked_count = item.get("praisenum").and_then(|v| v.as_u64()).map(|c| c as u32);

    let user = CommentUser {
        nickname: item.get("nick").and_then(|v| v.as_str()).unwrap_or("匿名").to_string(),
        avatar_url: item.get("avatarurl").and_then(|v| v.as_str()).map(|s| s.to_string()),
        user_id: item.get("uin").and_then(|v| v.as_u64()),
    };

    // QQ音乐API有replynum字段表示回复数
    let reply_count = item.get("replynum").and_then(|v| v.as_u64()).map(|c| c as u32);

    SongComment {
        comment_id, content, user, time, liked_count, reply_count,
        is_hot: false, ip_location: None, platform: Some("qq".to_string()), images: vec![],
        target_id,
    }
}

/// 获取酷狗音乐评论
#[tauri::command]
async fn fetch_kugou_comments(hash: String, p: Option<u32>, pagesize: Option<u32>) -> Result<CommentResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;
    let page = p.unwrap_or(1);
    let page_size = pagesize.unwrap_or(20);

    // 使用全部评论接口（getcommentwithlike）而不是最热评论接口（topliked）
    let url = format!(
        "http://m.comment.service.kugou.com/index.php?r=commentsv2/getcommentwithlike&extdata={}&code=fc4be23b4e972707f36b8a828a93ba8a&appid=1005&p={}&pagesize={}",
        hash, page, page_size
    );

    let resp = client.get(&url)
        .header("Referer", "https://www.kugou.com/")
        .send().await.map_err(|e| format!("酷狗评论请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("酷狗评论请求失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("酷狗评论解析失败: {}", e))?;
    let status = body.get("status").and_then(|s| s.as_i64()).unwrap_or(0);
    if status != 1 {
        return Err(format!("酷狗API错误: status={}", status));
    }

    let total = body.get("count").and_then(|c| c.as_u64()).unwrap_or(0) as u32;
    let has_more = (page as u32 * page_size) < total;

    let new_cursor = if has_more {
        Some((page + 1).to_string())
    } else {
        None
    };

    let kg_target_id = Some(hash.clone());
    let mut comments = Vec::new();
    if let Some(arr) = body.get("list").and_then(|l| l.as_array()) {
        for item in arr {
            let comment = parse_kugou_comment(item, kg_target_id.clone());
            comments.push(comment);
        }
    }

    // 按点赞数降序，前5条标记为热评
    comments.sort_by(|a, b| b.liked_count.unwrap_or(0).cmp(&a.liked_count.unwrap_or(0)));
    for comment in comments.iter_mut().take(5) {
        if comment.liked_count.unwrap_or(0) > 0 {
            comment.is_hot = true;
        }
    }

    Ok(CommentResult { comments, total, has_more, cursor: new_cursor })
}

fn parse_kugou_comment(item: &serde_json::Value, target_id: Option<String>) -> SongComment {
    let comment_id = item.get("id").and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
    let content = item.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let liked_count = item.get("like").and_then(|l| l.get("likenum")).and_then(|v| v.as_u64()).map(|c| c as u32);

    // 酷狗时间格式: "2018-06-09 08:18:42"
    let time = item.get("addtime").and_then(|v| v.as_str())
        .and_then(|s| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok())
        .map(|t| t.and_utc().timestamp_millis() as u64)
        .unwrap_or(0);

    let user = CommentUser {
        nickname: item.get("user_name").and_then(|v| v.as_str()).unwrap_or("匿名").to_string(),
        avatar_url: item.get("user_pic").and_then(|v| v.as_str()).map(|s| s.to_string()),
        user_id: item.get("user_id").and_then(|v| v.as_u64()),
    };

    // 酷狗API可能有reply_count字段
    let reply_count = item.get("reply_count").and_then(|v| v.as_u64()).map(|c| c as u32);

    SongComment {
        comment_id, content, user, time, liked_count, reply_count,
        is_hot: false, ip_location: None, platform: Some("kg".to_string()), images: vec![],
        target_id,
    }
}

/// 搜索酷我音乐歌曲ID（优先匹配原版，排除remix/live等版本）
#[tauri::command]
async fn search_kuwo_song_id(keyword: String) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;

    // 搜索更多结果以便筛选
    let url = format!(
        "https://kuwo.cn/search/searchMusicBykeyWord?vipver=1&client=kt&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&mobi=1&issubtitle=1&show_copyright_off=1&pn=0&rn=20&all={}",
        keyword
    );

    let resp = client.get(&url)
        .header("Referer", "https://www.kuwo.cn/")
        .header("Cookie", "kw_token=AFDCMVOU717")
        .header("csrf", "AFDCMVOU717")
        .send().await.map_err(|e| format!("酷我搜索失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("酷我搜索失败: HTTP {}", resp.status()));
    }

        let body: serde_json::Value = resp.json().await.map_err(|e| format!("酷我搜索解析失败: {}", e))?;

        // 从返回的abslist中筛选最佳匹配
    let abslist = body.get("abslist").and_then(|a| a.as_array()).ok_or("酷我搜索结果为空")?;

    // 排除remix、live、翻唱等版本的关键词
    let exclude_keywords = ["remix", "live", "翻唱", "cover", "伴奏", "karaoke", "inst", "环境音", "bootleg", "dj"];

    // 从搜索关键词中提取歌名和歌手（keyword 格式为 "title artist"）
    let keyword_lower = keyword.to_lowercase();
    // 取最后一个空格分隔的部分作为歌手，其余作为歌名
    let (keyword_song_name, keyword_artist_name) = if let Some(last_space) = keyword.rfind(' ') {
        let (name, artist) = keyword.split_at(last_space);
        (name.trim().to_lowercase(), artist.trim().to_lowercase())
    } else {
        (keyword_lower.clone(), String::new())
    };

    // 匹配策略分级：
    // 1. 歌名精确 + 艺术家匹配
    // 2. 歌名精确 + 专辑匹配
    // 3. 歌名精确（任意）
    // 4. 歌名包含 + 艺术家匹配
    // 5. 专辑匹配
    // 6. 兜底（最短专辑名）
    let mut best: Option<(&serde_json::Value, u32)> = None; // (item, score)

    for item in abslist {
        let name = item.get("SONGNAME").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
        let album = item.get("ALBUM").and_then(|a| a.as_str()).unwrap_or("").to_lowercase();
        let artist = item.get("ARTIST").and_then(|a| a.as_str()).unwrap_or("").to_lowercase();

        // 检查是否包含排除关键词
        let is_excluded = exclude_keywords.iter().any(|kw| {
            name.contains(kw) || album.contains(kw)
        });
        if is_excluded { continue; }

        // 计算匹配分数（越高越好）
        let mut score = 0u32;

        let name_exact = name == keyword_song_name || name == keyword_lower;
        let name_partial = !name_exact && (name.contains(&keyword_song_name) || keyword_song_name.contains(&name));
        let artist_match = keyword_artist_name.is_empty() || artist_name_match(&artist, &keyword_artist_name);
        let album_match = !keyword_song_name.is_empty() && (album.contains(&keyword_song_name) || keyword_song_name.contains(&album));

        if name_exact { score += 100; }
        if name_partial { score += 50; }
        if artist_match { score += 30; }
        if album_match { score += 20; }

        // 专辑名包含歌名（原版特征加分）
        if album_match && name_exact { score += 10; }

        if score == 0 { continue; }

        match &best {
            None => best = Some((item, score)),
            Some((_, best_score)) if score > *best_score => best = Some((item, score)),
            Some((best_item, best_score)) if score == *best_score => {
                // 同分时选专辑名短的（原版特征）
                let cur_album_len = best_item.get("ALBUM").and_then(|a| a.as_str()).unwrap_or("").len();
                let new_album_len = item.get("ALBUM").and_then(|a| a.as_str()).unwrap_or("").len();
                if new_album_len < cur_album_len {
                    best = Some((item, score));
                }
            }
            _ => {}
        }
    }

    // 选择最佳匹配
    let selected = best.map(|(item, _)| item).ok_or("酷我搜索无匹配结果")?;
    
    let musicrid = selected.get("MUSICRID").and_then(|r| r.as_str()).ok_or("无法获取MUSICRID")?;
    // MUSICRID格式: "MUSIC_123456"，提取数字部分
    let id_str = musicrid.trim_start_matches("MUSIC_");
    let song_id = id_str.parse::<u64>().map_err(|e| format!("解析歌曲ID失败: {}", e))?;
    
    eprintln!("[酷我搜索] 选中歌曲: {:?}, 专辑: {:?}, ID: {}", 
        selected.get("SONGNAME").and_then(|n| n.as_str()),
        selected.get("ALBUM").and_then(|a| a.as_str()),
        song_id);
    eprintln!("[酷我搜索] 搜索关键词: {}, 结果数: {}", keyword, abslist.len());

    Ok(song_id)
}


/// 搜索酷我音乐所有匹配的歌曲ID（返回所有歌名+艺术家匹配的结果）
#[tauri::command]
async fn search_kuwo_song_ids(keyword: String, local_title: Option<String>, local_artist: Option<String>, local_album: Option<String>) -> Result<Vec<u64>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;

    let url = format!(
        "https://kuwo.cn/search/searchMusicBykeyWord?vipver=1&client=kt&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&mobi=1&issubtitle=1&show_copyright_off=1&pn=0&rn=30&all={}",
        keyword
    );

    let resp = client.get(&url)
        .header("Referer", "https://www.kuwo.cn/")
        .header("Cookie", "kw_token=AFDCMVOU717")
        .header("csrf", "AFDCMVOU717")
        .send().await.map_err(|e| format!("酷我搜索失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("酷我搜索失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("酷我搜索解析失败: {}", e))?;
    let abslist = body.get("abslist").and_then(|a| a.as_array()).ok_or("酷我搜索结果为空")?;

    let exclude_keywords = ["remix", "live", "翻唱", "cover", "伴奏", "karaoke", "inst", "环境音", "bootleg", "dj"];
    let keyword_lower = keyword.to_lowercase();
    let (keyword_song_name, _keyword_artist_name) = if let Some(last_space) = keyword.rfind(' ') {
        let (name, artist) = keyword.split_at(last_space);
        (name.trim().to_lowercase(), artist.trim().to_lowercase())
    } else {
        (keyword_lower.clone(), String::new())
    };
    let local_title_lower = local_title.as_ref().map(|t| t.to_lowercase());
    let local_artist_lower = local_artist.as_ref().map(|a| a.to_lowercase());
    let local_album_lower = local_album.as_ref().map(|a| a.to_lowercase());

    let mut matched_ids = Vec::new();

    // 调试：打印前3个搜索结果
    for (i, item) in abslist.iter().take(3).enumerate() {
        let name = item.get("SONGNAME").and_then(|n| n.as_str()).unwrap_or("");
        let album = item.get("ALBUM").and_then(|a| a.as_str()).unwrap_or("");
        let artist = item.get("ARTIST").and_then(|a| a.as_str()).unwrap_or("");
        eprintln!("[酷我调试] 结果{}: name={}, album={}, artist={}", i, name, album, artist);
    }
    eprintln!("[酷我调试] 本地: title={:?}, album={:?}, artist={:?}", local_title, local_album, local_artist);

    for item in abslist {
        let name = item.get("SONGNAME").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
        let album = item.get("ALBUM").and_then(|a| a.as_str()).unwrap_or("").to_lowercase();
        let artist = item.get("ARTIST").and_then(|a| a.as_str()).unwrap_or("").to_lowercase();

        let is_excluded = exclude_keywords.iter().any(|kw| name.contains(kw) || album.contains(kw));
        if is_excluded { continue; }

        // 匹配逻辑：1.专辑精确匹配 2.歌名+艺术家精确匹配
        let mut matched = false;
        
        // 优先：专辑名称精确匹配 + 歌手匹配
        if let Some(ref la) = local_album_lower {
            if album == *la {
                if let Some(ref lartist) = local_artist_lower {
                    if artist_name_match(&artist, lartist) {
                        matched = true;
                    }
                } else {
                    matched = true;
                }
            }
        }
        
        // 其次：歌名+艺术家精确匹配
        if !matched {
            if let Some(ref lt) = local_title_lower {
                if name == *lt {
                    if let Some(ref la) = local_artist_lower {
                        if artist_name_match(&artist, la) {
                            matched = true;
                        }
                    } else {
                        matched = true;
                    }
                }
            }
        }
        
        // 兜底：歌名完全匹配（忽略歌手和专辑）
        if !matched {
            if let Some(ref lt) = local_title_lower {
                if name == *lt {
                    matched = true;
                }
            }
        }

        if matched {
            if let Some(musicrid) = item.get("MUSICRID").and_then(|r| r.as_str()) {
                let id_str = musicrid.trim_start_matches("MUSIC_");
                if let Ok(song_id) = id_str.parse::<u64>() {
                    matched_ids.push(song_id);
                }
            }
        }
    }

    eprintln!("[酷我搜索-多版本] 关键词: {}, 匹配: {} 首", keyword, matched_ids.len());
    Ok(matched_ids)
}
/// 搜索QQ音乐歌曲ID（topid）
#[tauri::command]
async fn search_qq_song_id(keyword: String) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;

    let url = format!(
        "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w={}&format=json&p=1&n=1&cr=1",
        keyword
    );

    let resp = client.get(&url)
        .header("Referer", "https://y.qq.com/")
        .send().await.map_err(|e| format!("QQ音乐搜索失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("QQ音乐搜索失败: HTTP {}", resp.status()));
    }

        let body: serde_json::Value = resp.json().await.map_err(|e| format!("QQ音乐搜索解析失败: {}", e))?;

        // 从song.list中提取songmid，然后用songmid获取评论用的topid
    let song_list = body.get("data").and_then(|d| d.get("song")).and_then(|s| s.get("list"))
        .and_then(|l| l.as_array()).ok_or("QQ音乐搜索结果为空")?;

    // 按歌名匹配选择最佳结果
    let keyword_lower = keyword.to_lowercase();
    let (keyword_song_name, keyword_artist_name) = if let Some(last_space) = keyword.rfind(' ') {
        let (name, artist) = keyword.split_at(last_space);
        (name.trim().to_lowercase(), artist.trim().to_lowercase())
    } else {
        (keyword_lower.clone(), String::new())
    };
    let mut best: Option<(&serde_json::Value, u32)> = None;
    for item in song_list {
        let name = item.get("songname").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
        let album = item.get("albumname").and_then(|a| a.as_str()).unwrap_or("").to_lowercase();
        let singer = item.get("singer").and_then(|s| s.as_array())
            .and_then(|arr| arr.first())
            .and_then(|s| s.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_lowercase();

        let name_exact = name == keyword_song_name || name == keyword_lower;
        let name_partial = !name_exact && (name.contains(&keyword_song_name) || keyword_song_name.contains(&name));
        let artist_match = keyword_artist_name.is_empty() || artist_name_match(&singer, &keyword_artist_name);
        let album_match = !keyword_song_name.is_empty() && (album.contains(&keyword_song_name) || keyword_song_name.contains(&album));

        let mut score = 0u32;
        if name_exact { score += 100; }
        if name_partial { score += 50; }
        if artist_match { score += 30; }
        if album_match { score += 20; }
        if album_match && name_exact { score += 10; }

        if score == 0 { continue; }

        match &best {
            None => best = Some((item, score)),
            Some((_, best_score)) if score > *best_score => best = Some((item, score)),
            Some((best_item, best_score)) if score == *best_score => {
                let cur_album_len = best_item.get("albumname").and_then(|a| a.as_str()).unwrap_or("").len();
                let new_album_len = item.get("albumname").and_then(|a| a.as_str()).unwrap_or("").len();
                if new_album_len < cur_album_len {
                    best = Some((item, score));
                }
            }
            _ => {}
        }
    }
    let first = best.map(|(item, _)| item).or(song_list.first()).ok_or("QQ音乐搜索结果为空")?;
    let songmid = first.get("songmid").and_then(|m| m.as_str()).ok_or("无法获取songmid")?;
    
    // 打印搜索日志
    let qq_name = first.get("songname").and_then(|n| n.as_str()).unwrap_or("");
    let qq_singer = first.get("singer").and_then(|s| s.as_array())
        .and_then(|arr| arr.first())
        .and_then(|s| s.get("name")).and_then(|n| n.as_str()).unwrap_or("");
    let qq_album = first.get("albumname").and_then(|a| a.as_str()).unwrap_or("");
        eprintln!("[QQ搜索] 选中歌曲: {:?}, 歌手: {:?}, 专辑: {:?}, songmid: {}", qq_name, qq_singer, qq_album, songmid);
    eprintln!("[QQ搜索] 搜索关键词: {}, 结果数: {}", keyword, song_list.len());

    // QQ音乐评论需要用songmid查询detail获取topid
    let detail_url = format!(
        "https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid={}&format=json",
        songmid
    );
        let detail_resp = client.get(&detail_url)
        .header("Referer", "https://y.qq.com/")
        .send().await.map_err(|e| format!("QQ音乐详情请求失败: {}", e))?;
        let detail_body: serde_json::Value = detail_resp.json().await.map_err(|e| format!("QQ音乐详情解析失败: {}", e))?;

    // 从detail中获取songid作为topid
    let topid = detail_body.get("data").and_then(|d| d.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("id")).and_then(|id| id.as_u64())
        .ok_or("无法获取QQ音乐topid")?;

    Ok(topid)
}


/// 搜索QQ音乐所有匹配的歌曲ID（返回所有歌名+艺术家匹配的结果）
#[tauri::command]
async fn search_qq_song_ids(keyword: String, local_title: Option<String>, local_artist: Option<String>, local_album: Option<String>) -> Result<Vec<u64>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;

    let url = format!(
        "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w={}&format=json&p=1&n=30&cr=1",
        keyword
    );

    let resp = client.get(&url)
        .header("Referer", "https://y.qq.com/")
        .send().await.map_err(|e| format!("QQ音乐搜索失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("QQ音乐搜索失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("QQ音乐搜索解析失败: {}", e))?;
    let song_list = body.get("data").and_then(|d| d.get("song")).and_then(|s| s.get("list"))
        .and_then(|l| l.as_array()).ok_or("QQ音乐搜索结果为空")?;

    let keyword_lower = keyword.to_lowercase();
    let (keyword_song_name, _keyword_artist_name) = if let Some(last_space) = keyword.rfind(' ') {
        let (name, artist) = keyword.split_at(last_space);
        (name.trim().to_lowercase(), artist.trim().to_lowercase())
    } else {
        (keyword_lower.clone(), String::new())
    };
    let local_title_lower = local_title.as_ref().map(|t| t.to_lowercase());
    let local_artist_lower = local_artist.as_ref().map(|a| a.to_lowercase());
    let local_album_lower = local_album.as_ref().map(|a| a.to_lowercase());

    let mut matched_ids = Vec::new();

    for item in song_list {
        let name = item.get("songname").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
        let singer_arr = item.get("singer").and_then(|s| s.as_array());
        let artist_name = singer_arr.and_then(|arr| arr.first())
            .and_then(|s| s.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
        let album_name = item.get("albumname").and_then(|a| a.as_str()).unwrap_or("").to_lowercase();

        // 匹配逻辑：1.专辑精确匹配 2.歌名+艺术家精确匹配
        let mut matched = false;
        
        // 优先：专辑名称精确匹配 + 歌手匹配
        if let Some(ref la) = local_album_lower {
            if album_name == *la {
                if let Some(ref lartist) = local_artist_lower {
                    if artist_name.contains(lartist) || lartist.contains(&artist_name) {
                        matched = true;
                    }
                } else {
                    matched = true;
                }
            }
        }
        
        // 其次：歌名+艺术家精确匹配
        if !matched {
            if let Some(ref lt) = local_title_lower {
                if name == *lt {
                    if let Some(ref la) = local_artist_lower {
                        if artist_name.contains(la) || la.contains(&artist_name) {
                            matched = true;
                        }
                    } else {
                        matched = true;
                    }
                }
            }
        }

        if matched {
            if let Some(songmid) = item.get("songmid").and_then(|m| m.as_str()) {
                let detail_url = format!(
                    "https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?songmid={}&format=json",
                    songmid
                );
                if let Ok(detail_resp) = client.get(&detail_url)
                    .header("Referer", "https://y.qq.com/")
                    .send().await {
                    if let Ok(detail_body) = detail_resp.json::<serde_json::Value>().await {
                        if let Some(topid) = detail_body.get("data").and_then(|d| d.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|item| item.get("id")).and_then(|id| id.as_u64()) {
                            matched_ids.push(topid);
                        }
                    }
                }
            }
        }
    }

    eprintln!("[QQ搜索-多版本] 关键词: {}, 匹配: {} 首", keyword, matched_ids.len());
    Ok(matched_ids)
}
/// 获取歌曲hash（酷狗需要hash才能获取评论）
#[tauri::command]
async fn search_kugou_song_hash(keyword: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;
    let url = format!(
        "http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword={}&page=1&pagesize=10",
        keyword
    );

        let resp = client.get(&url)
        .header("Referer", "https://www.kugou.com/")
        .send().await.map_err(|e| format!("酷狗搜索失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("酷狗搜索失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("酷狗搜索解析失败: {}", e))?;
    let info_list = body.get("data").and_then(|d| d.get("info"))
        .and_then(|i| i.as_array()).ok_or("酷狗搜索结果为空")?;

    // 按歌名匹配选择最佳结果
    let keyword_lower = keyword.to_lowercase();
    let (keyword_song_name, keyword_artist_name) = if let Some(last_space) = keyword.rfind(' ') {
        let (name, artist) = keyword.split_at(last_space);
        (name.trim().to_lowercase(), artist.trim().to_lowercase())
    } else {
        (keyword_lower.clone(), String::new())
    };
    let mut best: Option<(&serde_json::Value, u32)> = None;
    for item in info_list {
        let name = item.get("songname").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
        let album = item.get("album_name").and_then(|a| a.as_str()).unwrap_or("").to_lowercase();
        let singer = item.get("singername").and_then(|s| s.as_str()).unwrap_or("").to_lowercase();

        let name_exact = name == keyword_song_name || name == keyword_lower;
        let name_partial = !name_exact && (name.contains(&keyword_song_name) || keyword_song_name.contains(&name));
        let artist_match = keyword_artist_name.is_empty() || artist_name_match(&singer, &keyword_artist_name);
        let album_match = !keyword_song_name.is_empty() && (album.contains(&keyword_song_name) || keyword_song_name.contains(&album));

        let mut score = 0u32;
        if name_exact { score += 100; }
        if name_partial { score += 50; }
        if artist_match { score += 30; }
        if album_match { score += 20; }
        if album_match && name_exact { score += 10; }

        if score == 0 { continue; }

        match &best {
            None => best = Some((item, score)),
            Some((_, best_score)) if score > *best_score => best = Some((item, score)),
            Some((best_item, best_score)) if score == *best_score => {
                let cur_album_len = best_item.get("album_name").and_then(|a| a.as_str()).unwrap_or("").len();
                let new_album_len = item.get("album_name").and_then(|a| a.as_str()).unwrap_or("").len();
                if new_album_len < cur_album_len {
                    best = Some((item, score));
                }
            }
            _ => {}
        }
    }
    let selected = best.map(|(item, _)| item).or(info_list.first()).ok_or("酷狗搜索无匹配结果")?;
    let hash = selected.get("hash").and_then(|h| h.as_str())
        .ok_or("未找到歌曲hash")?;
    
    // 打印搜索日志
    let kg_name = selected.get("songname").and_then(|n| n.as_str()).unwrap_or("");
    let kg_singer = selected.get("singername").and_then(|s| s.as_str()).unwrap_or("");
    let kg_album = selected.get("album_name").and_then(|a| a.as_str()).unwrap_or("");
        eprintln!("[酷狗搜索] 选中歌曲: {:?}, 歌手: {:?}, 专辑: {:?}, hash: {}", kg_name, kg_singer, kg_album, hash);
    eprintln!("[酷狗搜索] 搜索关键词: {}, 结果数: {}", keyword, info_list.len());

    Ok(hash.to_string())
}


// 歌手名匹配辅助函数：支持 /、&、、等多种分隔符
fn artist_name_match(search_artist: &str, local_artist: &str) -> bool {
    if search_artist == local_artist {
        return true;
    }
    if search_artist.contains(local_artist) || local_artist.contains(search_artist) {
        return true;
    }
    
    // 按分隔符拆分后逐个匹配
    let search_parts: Vec<&str> = search_artist.split(|c| c == '/' || c == '&' || c == '、' || c == ',' || c == '，')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    let local_parts: Vec<&str> = local_artist.split(|c| c == '/' || c == '&' || c == '、' || c == ',' || c == '，')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    
    // 本地歌手的每个部分都能在搜索结果中找到
    local_parts.iter().all(|lp| search_parts.iter().any(|sp| sp.contains(lp) || lp.contains(sp)))
}

/// 搜索酷狗所有匹配的歌曲hash（返回所有歌名+艺术家匹配的结果）
#[tauri::command]
async fn search_kugou_song_hashes(keyword: String, local_title: Option<String>, local_artist: Option<String>, local_album: Option<String>) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("创建客户端失败: {}", e))?;
    let url = format!(
        "http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword={}&page=1&pagesize=30",
        keyword
    );

    let resp = client.get(&url)
        .header("Referer", "https://www.kugou.com/")
        .send().await.map_err(|e| format!("酷狗搜索失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("酷狗搜索失败: HTTP {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("酷狗搜索解析失败: {}", e))?;
    let info_list = body.get("data").and_then(|d| d.get("info"))
        .and_then(|i| i.as_array()).ok_or("酷狗搜索结果为空")?;

    let keyword_lower = keyword.to_lowercase();
    let (keyword_song_name, _keyword_artist_name) = if let Some(last_space) = keyword.rfind(' ') {
        let (name, artist) = keyword.split_at(last_space);
        (name.trim().to_lowercase(), artist.trim().to_lowercase())
    } else {
        (keyword_lower.clone(), String::new())
    };
    let local_title_lower = local_title.as_ref().map(|t| t.to_lowercase());
    let local_artist_lower = local_artist.as_ref().map(|a| a.to_lowercase());
    let local_album_lower = local_album.as_ref().map(|a| a.to_lowercase());

    let mut matched_hashes = Vec::new();

    // 调试：打印前3个搜索结果
    for (i, item) in info_list.iter().take(3).enumerate() {
        let name = item.get("songname").and_then(|n| n.as_str()).unwrap_or("");
        let singer = item.get("singername").and_then(|s| s.as_str()).unwrap_or("");
        let album = item.get("album_name").and_then(|a| a.as_str()).unwrap_or("");
        eprintln!("[酷狗调试] 结果{}: name={}, singer={}, album={}", i, name, singer, album);
    }
    eprintln!("[酷狗调试] 本地: title={:?}, album={:?}, artist={:?}", local_title, local_album, local_artist);

    for item in info_list {
        let name = item.get("songname").and_then(|n| n.as_str()).unwrap_or("").to_lowercase();
        let singer = item.get("singername").and_then(|s| s.as_str()).unwrap_or("").to_lowercase();
        let album_name = item.get("album_name").and_then(|a| a.as_str()).unwrap_or("").to_lowercase();

        // 匹配逻辑：1.专辑精确匹配 2.歌名+艺术家精确匹配
        let mut matched = false;
        
        // 优先：专辑名称精确匹配 + 歌手匹配
        if let Some(ref la) = local_album_lower {
            if album_name == *la {
                if let Some(ref lartist) = local_artist_lower {
                    if artist_name_match(&singer, lartist) {
                        matched = true;
                    }
                } else {
                    matched = true;
                }
            }
        }
        
        // 其次：歌名+艺术家精确匹配
        if !matched {
            if let Some(ref lt) = local_title_lower {
                if name == *lt {
                    if let Some(ref la) = local_artist_lower {
                        if artist_name_match(&singer, la) {
                            matched = true;
                        }
                    } else {
                        matched = true;
                    }
                }
            }
        }
        
        // 兜底：歌名完全匹配（忽略歌手和专辑）
        if !matched {
            if let Some(ref lt) = local_title_lower {
                if name == *lt {
                    matched = true;
                }
            }
        }

        if matched {
            if let Some(hash) = item.get("hash").and_then(|h| h.as_str()) {
                matched_hashes.push(hash.to_string());
            }
        }
    }

    eprintln!("[酷狗搜索-多版本] 关键词: {}, 匹配: {} 首", keyword, matched_hashes.len());
    Ok(matched_hashes)
}
/// 统一多平台评论获取
#[tauri::command]
async fn fetch_multi_platform_comments(
    app: tauri::AppHandle,
    song_id: u64,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    platforms: Option<Vec<String>>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<MultiPlatformCommentResult, String> {
    let target_platforms = platforms.unwrap_or_else(|| vec!["wy".to_string(), "kw".to_string(), "qq".to_string(), "kg".to_string()]);
    let page_limit = limit.unwrap_or(20);

    // 构建搜索关键词（只用歌名）
    let keyword = title.clone();

    let mut results = Vec::new();
    let mut futures = Vec::new();

    // 并发请求各平台
    for platform in &target_platforms {
                let platform = platform.clone();
        let song_id = song_id;
        let _title = title.clone();
        let _artist = artist.clone();
        let _album = album.clone();
        let cursor = cursor.clone();
        let keyword = keyword.clone();
        let app_handle = app.clone();

        let future = async move {
            let platform_task = async {
                match platform.as_str() {
                    "wy" => {
                        let offset = cursor.as_ref().and_then(|c| c.split(':').nth(0))
                            .and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
                        fetch_song_comments(song_id, Some(offset.to_string()), Some(page_limit)).await
                            .map(|mut r| { r.comments.iter_mut().for_each(|c| c.platform = Some("wy".to_string())); r })
                    }
                    "kw" => {
                        match search_kuwo_song_ids(keyword.clone(), Some(_title.clone()), _artist.clone(), _album.clone()).await {
                            Ok(kw_song_ids) => {
                                let start = cursor.as_ref().and_then(|c| c.split(':').nth(1))
                                    .and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
                                let mut all_comments = Vec::new();
                                let mut max_total = 0u32;
                                let mut has_more = false;
                                for kw_id in kw_song_ids.iter().take(2) {
                                    if let Ok(mut r) = fetch_kuwo_comments(*kw_id, Some(start), Some(page_limit)).await {
                                        max_total = max_total.max(r.total);
                                        has_more = has_more || r.has_more;
                                        for mut c in r.comments.into_iter() {
                                            c.platform = Some("kw".to_string());
                                            all_comments.push(c);
                                        }
                                    }
                                }
                                Ok(CommentResult { comments: all_comments, total: max_total, has_more, cursor: None })
                            }
                            Err(e) => Err(format!("酷我搜索失败: {}", e))
                        }
                    }
                    "qq" => {
                        match search_qq_song_ids(keyword.clone(), Some(_title.clone()), _artist.clone(), _album.clone()).await {
                            Ok(qq_song_ids) => {
                                let p = cursor.as_ref().and_then(|c| c.split(':').nth(2))
                                    .and_then(|s| s.parse::<u32>().ok()).unwrap_or(1);
                                let mut all_comments = Vec::new();
                                let mut max_total = 0u32;
                                let mut has_more = false;
                                for qq_id in qq_song_ids.iter().take(2) {
                                    if let Ok(mut r) = fetch_qq_comments(*qq_id, Some(p), Some(page_limit)).await {
                                        max_total = max_total.max(r.total);
                                        has_more = has_more || r.has_more;
                                        for mut c in r.comments.into_iter() {
                                            c.platform = Some("qq".to_string());
                                            all_comments.push(c);
                                        }
                                    }
                                }
                                Ok(CommentResult { comments: all_comments, total: max_total, has_more, cursor: None })
                            }
                            Err(e) => Err(format!("QQ音乐搜索失败: {}", e))
                        }
                    }
                    "kg" => {
                        match search_kugou_song_hashes(keyword.clone(), Some(_title.clone()), _artist.clone(), _album.clone()).await {
                            Ok(hashes) => {
                                let p = cursor.as_ref().and_then(|c| c.split(':').nth(3))
                                    .and_then(|s| s.parse::<u32>().ok()).unwrap_or(1);
                                let mut all_comments = Vec::new();
                                let mut seen_ids = std::collections::HashSet::new();
                                let mut max_total = 0u32;
                                let mut has_more = false;
                                for hash in hashes.iter().take(2) {
                                    if let Ok(mut r) = fetch_kugou_comments(hash.clone(), Some(p), Some(page_limit)).await {
                                        max_total = max_total.max(r.total);
                                        has_more = has_more || r.has_more;
                                        for mut c in r.comments.into_iter() {
                                            c.platform = Some("kg".to_string());
                                            // 去重：使用 comment_id 去重
                                            if seen_ids.insert(c.comment_id) {
                                                all_comments.push(c);
                                            }
                                        }
                                    }
                                }
                                Ok(CommentResult { comments: all_comments, total: max_total, has_more, cursor: None })
                            }
                            Err(e) => Err(format!("酷狗搜索失败: {}", e))
                        }
                    }
                    _ => Err(format!("不支持的平台: {}", platform)),
                }
            };

            let result = platform_task.await;

            // 每个平台完成后立即发送事件给前端
            let event_name = "comment-platform-loaded";
            match &result {
                Ok(comment_result) => {
                    let payload = PlatformCommentResult {
                        platform: platform.clone(),
                        comments: comment_result.comments.clone(),
                        total: comment_result.total,
                        has_more: comment_result.has_more,
                        error: None,
                    };
                    let _ = app_handle.emit(event_name, payload);
                }
                Err(e) => {
                    let payload = PlatformCommentResult {
                        platform: platform.clone(),
                        comments: Vec::new(),
                        total: 0,
                        has_more: false,
                        error: Some(e.clone()),
                    };
                    let _ = app_handle.emit(event_name, payload);
                }
            }

            (platform, result)
        };
        futures.push(future);
    }

    // 等待所有请求完成，汇总返回
    for future in futures {
        let (platform, result) = future.await;
        match result {
            Ok(comment_result) => {
                results.push(PlatformCommentResult {
                    platform,
                    comments: comment_result.comments,
                    total: comment_result.total,
                    has_more: comment_result.has_more,
                    error: None,
                });
            }
            Err(e) => {
                results.push(PlatformCommentResult {
                    platform,
                    comments: Vec::new(),
                    total: 0,
                    has_more: false,
                    error: Some(e),
                });
            }
        }
    }

    Ok(MultiPlatformCommentResult { platforms: results })
}

// ═══════════════════════════════════════════════════════════════
// 系统托盘状态管理
// ═══════════════════════════════════════════════════════════════

struct TrayState {
    is_playing: bool,
    desktop_lyrics_enabled: bool,
    current_song: Option<String>, // "歌名 - 歌手" 格式
}

static TRAY_STATE: OnceLock<Mutex<TrayState>> = OnceLock::new();

struct TrayIconState(TrayIcon);

fn get_tray_state() -> &'static Mutex<TrayState> {
    TRAY_STATE.get_or_init(|| Mutex::new(TrayState {
        is_playing: false,
        desktop_lyrics_enabled: false,
        current_song: None,
    }))
}

fn build_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let state = get_tray_state().lock().unwrap();

    // ── 播放控制（置顶） ──
    let prev = MenuItem::with_id(app, "tray-prev", "⏮  上一首", true, Some("Left"))?;
    let play_text = if state.is_playing { "⏯  暂停" } else { "⏯  播放" };
    let play_pause = MenuItem::with_id(app, "tray-play-pause", play_text, true, Some("Space"))?;
    let next = MenuItem::with_id(app, "tray-next", "⏭  下一首", true, Some("Right"))?;
    let sep1 = PredefinedMenuItem::separator(app)?;

    // ── 当前歌曲信息（不可点击） ──
    let song_info_text = state.current_song.as_deref().unwrap_or("未在播放");
    let song_info = MenuItem::with_id(app, "tray-song-info", format!("♫  {}", song_info_text), false, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    // ── 功能开关 ──
    let lyrics = CheckMenuItem::with_id(app, "tray-desktop-lyrics", "显示桌面歌词", true, state.desktop_lyrics_enabled, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;

    // ── 系统操作 ──
    let show = MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "tray-settings", "设置", true, None::<&str>)?;
    let sep4 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出", true, Some("Alt+F4"))?;

    let menu = Menu::with_items(app, &[
        &prev, &play_pause, &next, &sep1,
        &song_info, &sep2,
        &lyrics, &sep3,
        &show, &settings, &sep4, &quit,
    ])?;
    Ok(menu)
}

#[tauri::command]
fn update_tray_info(
    tray_state: tauri::State<'_, TrayIconState>,
    is_playing: bool,
    desktop_lyrics_enabled: bool,
    song_info: Option<String>,
) -> Result<(), String> {
    {
        let mut state = get_tray_state().lock().map_err(|e| e.to_string())?;
        state.is_playing = is_playing;
        state.desktop_lyrics_enabled = desktop_lyrics_enabled;
        state.current_song = song_info.clone();
    }

    // 重建菜单以更新播放/暂停文本和桌面歌词勾选状态
    let app = tray_state.0.app_handle();
    let menu = build_tray_menu(app).map_err(|e| e.to_string())?;
    let _ = tray_state.0.set_menu(Some(menu));

    // 更新 tooltip（包含播放状态图标）
    let state = get_tray_state().lock().map_err(|e| e.to_string())?;
    let indicator = if state.is_playing { " ▶" } else { " ⏸" };
    let tooltip = match &song_info {
        Some(info) => format!("{}{}", info, indicator),
        None => "KimoPlayer".to_string(),
    };
    let _ = tray_state.0.set_tooltip(Some(&tooltip));

    Ok(())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(())
}

/// 下载进度事件 payload
#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
    percent: f64,
}

/// 字体下载进度事件 payload
#[derive(Clone, serde::Serialize)]
struct FontDownloadProgress {
    filename: String,
    downloaded: u64,
    total: u64,
    percent: f64,
}

/// 应用内下载字体文件到安装目录 resources/fonts（不可写时回退应用数据目录）。
/// 支持 zip 包内提取（extract 指定条目）；流式下载并推送 font-download-progress 事件。
#[tauri::command]
async fn download_font(
    app: tauri::AppHandle,
    url: String,
    filename: String,
    extract: Option<String>,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    // 目标目录：优先资源目录（安装目录 resources/fonts），
    // 通过写探针验证可写性（Program Files 等只读位置 create_dir_all 也会成功），失败回退应用数据目录
    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let fonts_dir = resource_dir.join("fonts");
    let data_fallback = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("fonts");

    fn dir_writable(dir: &std::path::Path) -> bool {
        let probe = dir.join(".kimo-write-probe");
        match std::fs::File::create(&probe) {
            Ok(mut f) => {
                use std::io::Write;
                let _ = f.write_all(b"ok");
                let _ = std::fs::remove_file(&probe);
                true
            }
            Err(_) => false,
        }
    }

    let dir = if std::fs::create_dir_all(&fonts_dir).is_ok() && dir_writable(&fonts_dir) {
        fonts_dir
    } else {
        std::fs::create_dir_all(&data_fallback).map_err(|e| e.to_string())?;
        data_fallback
    };
    let target = dir.join(&filename);
    // 原子写：先写 .part 临时文件，完成后 rename 覆盖——主窗口与其它窗口并发下载时不会交叉写坏目标文件
    let part_path = dir.join(format!("{filename}.part"));

    // 纵深防御：仅允许纯文件名（拒绝路径分隔符 / ..，防路径穿越）
    if (filename.contains('/') || filename.contains('\\') || filename.contains("..")) {
        return Err("非法的文件名".to_string());
    }

    // 已存在且非空 → 幂等返回
    if target.exists()
        && target
            .metadata()
            .map(|m| m.len() > 0)
            .unwrap_or(false)
    {
        return Ok(target.to_string_lossy().to_string());
    }

    // 失败时清理残留文件：避免截断文件被幂等判断误认为已安装
    let cleanup = |err: String| -> String {
        let _ = std::fs::remove_file(&part_path);
        err
    };

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| cleanup(format!("下载失败：{e}")))?;
    if !resp.status().is_success() {
        return Err(cleanup(format!("下载失败：HTTP {}", resp.status())));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;

    let emit_progress = |downloaded: u64| {
        let percent = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        let _ = app.emit(
            "font-download-progress",
            FontDownloadProgress {
                filename: filename.clone(),
                downloaded,
                total,
                percent,
            },
        );
    };

    if let Some(entry_name) = extract {
        // zip 包：先下载到内存，再解压出目标条目
        let mut buf: Vec<u8> = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| cleanup(format!("下载中断：{e}")))?;
            buf.extend_from_slice(&chunk);
            downloaded += chunk.len() as u64;
            emit_progress(downloaded);
        }
        let reader = std::io::Cursor::new(buf);
        let mut archive =
            zip::ZipArchive::new(reader).map_err(|e| cleanup(format!("压缩包解析失败：{e}")))?;
        let mut entry = archive
            .by_name(&entry_name)
            .map_err(|e| cleanup(format!("压缩包中未找到 {entry_name}：{e}")))?;
        let mut file = std::fs::File::create(&part_path).map_err(|e| cleanup(e.to_string()))?;
        std::io::copy(&mut entry, &mut file).map_err(|e| cleanup(e.to_string()))?;
    } else {
        // 普通字体文件：流式写入 .part 临时文件
        let mut file = std::fs::File::create(&part_path).map_err(|e| cleanup(e.to_string()))?;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| cleanup(format!("下载中断：{e}")))?;
            file.write_all(&chunk).map_err(|e| cleanup(e.to_string()))?;
            downloaded += chunk.len() as u64;
            emit_progress(downloaded);
        }
    }
    emit_progress(downloaded);
    // 原子落盘：rename 覆盖目标（Windows 上目标已存在时 replace 更稳）
    if target.exists() {
        std::fs::remove_file(&target).map_err(|e| cleanup(e.to_string()))?;
    }
    std::fs::rename(&part_path, &target).map_err(|e| cleanup(e.to_string()))?;
    Ok(target.to_string_lossy().to_string())
}

/// 下载安装包并静默安装（流式下载 + 进度推送）
#[tauri::command]
async fn download_and_install_update(url: String, app: tauri::AppHandle) -> Result<(), String> {
    use std::io::Write;

    // 获取临时目录
    let temp_dir = std::env::temp_dir();
    let file_name = url.split('/').last().unwrap_or("update.exe");
    let download_path = temp_dir.join(file_name);

    // 创建下载客户端
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("创建下载客户端失败: {}", e))?;

    let resp = client.get(&url).send().await.map_err(|e| format!("下载请求失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }

    // 从 Content-Length 获取文件总大小
    let total = resp.content_length().unwrap_or(0);

    // 流式下载并写入文件
    let mut file = std::fs::File::create(&download_path)
        .map_err(|e| format!("创建临时文件失败: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut resp = resp;

    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("读取数据失败: {}", e))? {
        file.write_all(&chunk).map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += chunk.len() as u64;

        // 推送下载进度到前端
        let percent = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        let _ = app.emit("update-download-progress", DownloadProgress {
            downloaded,
            total,
            percent,
        });
    }

    file.flush().map_err(|e| format!("刷新文件失败: {}", e))?;
    drop(file);

    // 静默安装（NSIS 支持 /S 静默模式）
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let current_exe = std::env::current_exe()
            .map_err(|e| format!("无法获取当前程序路径: {}", e))?;
        let quote_ps = |path: &std::path::Path| {
            path.to_string_lossy().replace('\'', "''")
        };
        let installer_path = quote_ps(&download_path);
        let app_path = quote_ps(&current_exe);

        // Run the installer from a detached hidden helper. The current app
        // must exit before Inno Setup can replace its executable; once installation
        // completes, the helper launches the updated executable from the same
        // install path.
        let update_script = format!(
            "$installer='{}'; $app='{}'; \
             Start-Sleep -Milliseconds 700; \
             $process=Start-Process -FilePath $installer -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -PassThru; \
             $process.WaitForExit(); \
             Start-Sleep -Milliseconds 900; \
             if (Test-Path -LiteralPath $app) {{ Start-Process -FilePath $app }}",
            installer_path,
            app_path,
        );

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &update_script,
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("启动更新助手失败: {}", e))?;
    }

    // 关闭当前应用，让安装程序接管
    app.exit(0);
    Ok(())
}

/// Supported audio file extensions for OS file association
const MUSIC_EXTENSIONS: [&str; 10] = [
    ".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".wma", ".opus", ".ape", ".aiff",
];

/// Check if a command-line argument looks like a supported audio file path
fn extract_music_file_arg(args: &[String]) -> Option<String> {
    for arg in args {
        // Skip flags like --protocol or -t
        if arg.starts_with('-') {
            continue;
        }
        let lower = arg.to_lowercase();
        if MUSIC_EXTENSIONS.iter().any(|ext| lower.ends_with(ext)) {
            // Basic sanity check: the path should exist as a file
            let path = std::path::Path::new(arg);
            if path.is_file() {
                return Some(arg.clone());
            }
        }
    }
    None
}

/// State holding a file path passed at launch (before the frontend was ready to listen)
struct PendingFile(Mutex<Option<String>>);

/// Tauri command: frontend calls this on startup to retrieve a file that was
/// passed as a command-line argument when the app was launched by the OS.
#[tauri::command]
fn take_pending_file(state: tauri::State<'_, PendingFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

// ══════════════════════════════════════════════════════════════════════════
// ═══ SQLite 歌库持久化模块 ═══
// ══════════════════════════════════════════════════════════════════════════

fn db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("library.db"))
}

fn row_to_metadata(row: &rusqlite::Row) -> rusqlite::Result<AudioMetadata> {
    Ok(AudioMetadata {
        file_path: row.get(0)?,
        title: row.get(1)?,
        artist: row.get(2)?,
        album: row.get(3)?,
        duration: row.get::<_, Option<i64>>(4)?.map(|v| v as u64),
        year: row.get::<_, Option<i32>>(5)?.map(|v| v as u32),
        track_number: row.get::<_, Option<i32>>(6)?.map(|v| v as u32),
        disc_number: row.get::<_, Option<i32>>(7)?.map(|v| v as u32),
        genre: row.get(8)?,
        album_artist: row.get(9)?,
        bitrate: row.get::<_, Option<i32>>(10)?.map(|v| v as u32),
        sample_rate: row.get::<_, Option<i32>>(11)?.map(|v| v as u32),
        bit_depth: row.get::<_, Option<i32>>(12)?.map(|v| v as u8),
        cover_image: row.get(13)?,
        composer: None,
        lyricist: None,
        comment: None,
        lyrics: None,
    })
}

/// 共享的 SQLite 连接状态（惰性初始化 + schema 迁移）
#[derive(Clone, Default)]
struct LibraryDb(Arc<Mutex<Option<Connection>>>);

/// 确保数据库连接已初始化（打开、WAL、迁移），返回连接 Arc。
fn ensure_db(app: &tauri::AppHandle) -> Result<Arc<Mutex<Option<Connection>>>, String> {
    let db = app.state::<LibraryDb>().inner().0.clone();
    let mut guard = db.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        let path = db_path(app)?;
        let conn = Connection::open(&path).map_err(|e| e.to_string())?;
        // WAL 提升并发读性能；PRAGMA 只对当前连接生效，因此每次打开都设置
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
            .map_err(|e| e.to_string())?;
        migrate_schema(&conn)?;
        *guard = Some(conn);
    }
    drop(guard);
    Ok(db)
}

/// 只读访问数据库连接（复用单例，不再每次 open）。
fn with_db<T>(app: &tauri::AppHandle, f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let db = ensure_db(app)?;
    let guard = db.lock().map_err(|e| e.to_string())?;
    f(guard.as_ref().expect("connection initialized"))
}

/// 可写访问数据库连接。
fn with_db_mut<T>(app: &tauri::AppHandle, f: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
    let db = ensure_db(app)?;
    let mut guard = db.lock().map_err(|e| e.to_string())?;
    f(guard.as_mut().expect("connection initialized"))
}

/// Schema 迁移：基于 PRAGMA user_version 逐级升级。
/// 旧库（v0，已有 songs 表）会自动补建索引与 FTS5 全文索引，无需删库重扫。
fn migrate_schema(conn: &Connection) -> Result<(), String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if version < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS songs (
                file_path     TEXT PRIMARY KEY,
                title         TEXT,
                artist        TEXT,
                album         TEXT,
                duration      INTEGER,
                year          INTEGER,
                track_number  INTEGER,
                disc_number   INTEGER,
                genre         TEXT,
                album_artist  TEXT,
                bitrate       INTEGER,
                sample_rate   INTEGER,
                bit_depth     INTEGER,
                cover_path    TEXT,
                last_modified INTEGER,
                indexed_at    INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_artist ON songs(artist);
            CREATE INDEX IF NOT EXISTS idx_album  ON songs(album);
            CREATE INDEX IF NOT EXISTS idx_genre  ON songs(genre);
            -- 列表页按标题排序分页，补一个可用的排序索引
            CREATE INDEX IF NOT EXISTS idx_title_nocase ON songs(title COLLATE NOCASE);"
        ).map_err(|e| e.to_string())?;

        // FTS5 全文索引：部分环境可能未编译 FTS5，失败时自动降级为 LIKE 搜索
        let fts_ok = conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS songs_fts USING fts5(title, artist, album, tokenize='unicode61');
             CREATE TRIGGER IF NOT EXISTS songs_fts_ai AFTER INSERT ON songs BEGIN
               INSERT INTO songs_fts(rowid, title, artist, album)
               VALUES (new.rowid, new.title, new.artist, new.album);
             END;
             CREATE TRIGGER IF NOT EXISTS songs_fts_ad AFTER DELETE ON songs BEGIN
               DELETE FROM songs_fts WHERE rowid = old.rowid;
             END;
             CREATE TRIGGER IF NOT EXISTS songs_fts_au AFTER UPDATE ON songs BEGIN
               DELETE FROM songs_fts WHERE rowid = old.rowid;
               INSERT INTO songs_fts(rowid, title, artist, album)
               VALUES (new.rowid, new.title, new.artist, new.album);
             END;
             -- 回填已有歌曲（旧库升级场景）
             INSERT INTO songs_fts(rowid, title, artist, album)
               SELECT rowid, title, artist, album FROM songs;"
        ).is_ok();
        if !fts_ok {
            eprintln!("[library-db] FTS5 unavailable, search falls back to LIKE");
        }

        conn.execute_batch("PRAGMA user_version = 1;").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn init_library_db(app: tauri::AppHandle) -> Result<(), String> {
    ensure_db(&app)?;
    Ok(())
}

#[tauri::command]
async fn scan_and_index_library(app: tauri::AppHandle, dirs: Vec<String>) -> Result<u32, String> {
    let db = app.state::<LibraryDb>().inner().0.clone();
    let app_handle = app.clone();
    tokio::task::spawn_blocking(move || {
        // 初始化连接（与 ensure_db 相同逻辑，在 blocking 线程内持锁）
        let mut guard = db.lock().map_err(|e| e.to_string())?;
        if guard.is_none() {
            let path = db_path(&app_handle)?;
            let conn = Connection::open(&path).map_err(|e| e.to_string())?;
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")
                .map_err(|e| e.to_string())?;
            migrate_schema(&conn)?;
            *guard = Some(conn);
        }
        let conn = guard.as_mut().expect("connection initialized");

        // 1. 收集所有音频文件
        let extensions = ["mp3", "flac", "wav", "ape", "m4a", "ogg", "aac", "wma", "opus", "aiff"];
        let mut all_files: Vec<String> = Vec::new();
        for dir in &dirs {
            for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
                if let Some(ext) = entry.path().extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if extensions.contains(&ext_lower.as_str()) {
                        all_files.push(entry.path().to_string_lossy().into_owned());
                    }
                }
            }
        }
        all_files.sort();
        all_files.dedup();

        let total = all_files.len() as u32;
        let mut indexed: u32 = 0;

        // 2. 单事务内完成增量索引 + 失效清理，中途失败整体回滚，避免半成品数据
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for (i, file_path) in all_files.iter().enumerate() {
            let path_obj = std::path::Path::new(file_path);
            let file_name = path_obj.file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            // 获取文件 mtime
            let mtime = std::fs::metadata(path_obj)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            // 检查 DB 中是否已有相同 mtime 的记录
            let existing_mtime: Option<i64> = tx.query_row(
                "SELECT last_modified FROM songs WHERE file_path = ?1",
                [file_path.as_str()],
                |row| row.get(0),
            ).ok();

            // 推送扫描进度
            let _ = app_handle.emit("scan-progress", serde_json::json!({
                "current": i + 1,
                "total": total,
                "title": &file_name,
                "skipped": existing_mtime == Some(mtime) && mtime > 0
            }));

            if existing_mtime == Some(mtime) && mtime > 0 {
                continue; // 文件未修改，跳过
            }

            // 调用现有函数读取元数据
            match read_audio_metadata(app_handle.clone(), file_path.clone()) {
                Ok(meta) => {
                    let now = chrono::Utc::now().timestamp();
                    tx.execute(
                        "INSERT OR REPLACE INTO songs (file_path, title, artist, album, duration, year, track_number, disc_number, genre, album_artist, bitrate, sample_rate, bit_depth, cover_path, last_modified, indexed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
                        params![
                            meta.file_path,
                            meta.title,
                            meta.artist,
                            meta.album,
                            meta.duration.map(|d| d as i64),
                            meta.year.map(|y| y as i32),
                            meta.track_number.map(|t| t as i32),
                            meta.disc_number.map(|d| d as i32),
                            meta.genre,
                            meta.album_artist,
                            meta.bitrate.map(|b| b as i32),
                            meta.sample_rate.map(|s| s as i32),
                            meta.bit_depth.map(|b| b as i32),
                            meta.cover_image,
                            mtime,
                            now
                        ],
                    ).map_err(|e| e.to_string())?;
                    indexed += 1;
                }
                Err(e) => {
                    eprintln!("[scan] Failed to read metadata for {}: {}", file_path, e);
                }
            }
        }

        // 3. 清理：用临时表保存现存路径，一次性删除磁盘上已不存在的记录
        tx.execute_batch(
            "CREATE TEMP TABLE IF NOT EXISTS _library_keep_paths(path TEXT PRIMARY KEY);
             DELETE FROM _library_keep_paths;"
        ).map_err(|e| e.to_string())?;
        for file_path in &all_files {
            tx.execute(
                "INSERT OR IGNORE INTO _library_keep_paths(path) VALUES (?1)",
                [file_path.as_str()],
            ).map_err(|e| e.to_string())?;
        }
        let removed = tx.execute(
            "DELETE FROM songs WHERE file_path NOT IN (SELECT path FROM _library_keep_paths)",
            [],
        ).map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| e.to_string())?;
        eprintln!("[scan] indexed={}, removed={}", indexed, removed);
        Ok(indexed)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_library_songs(app: tauri::AppHandle, offset: u32, limit: u32) -> Result<Vec<AudioMetadata>, String> {
    with_db(&app, |conn| {
        let mut stmt = conn.prepare(
            "SELECT file_path, title, artist, album, duration, year, track_number, disc_number, genre, album_artist, bitrate, sample_rate, bit_depth, cover_path FROM songs ORDER BY title COLLATE NOCASE LIMIT ?1 OFFSET ?2"
        ).map_err(|e| e.to_string())?;

        let songs: Vec<AudioMetadata> = stmt.query_map(
            params![limit as i64, offset as i64],
            row_to_metadata,
        )
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

        Ok(songs)
    })
}

#[tauri::command]
fn search_library(app: tauri::AppHandle, query: String, limit: u32) -> Result<Vec<AudioMetadata>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    with_db(&app, |conn| {
        // FTS5 可用时走全文索引；否则降级为 LIKE（带通配符转义）
        let fts_available: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'songs_fts'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count > 0)
            .unwrap_or(false);
        if fts_available {
            match search_library_fts(conn, query, limit) {
                Ok(songs) => Ok(songs),
                Err(e) => {
                    // 纯标点等特殊输入可能触发 FTS5 语法错误，降级为 LIKE 搜索
                    eprintln!("[library-db] FTS query failed, falling back to LIKE: {}", e);
                    search_library_like(conn, query, limit)
                }
            }
        } else {
            search_library_like(conn, query, limit)
        }
    })
}

/// FTS5 全文搜索：查询词按空格拆分、AND 组合，标题/歌手/专辑任一命中，按相关性排序。
/// unicode61 分词器不切分连续中文，因此所有词使用前缀匹配（"词"*），
/// 可覆盖中文标题开头、英文词前缀等常见搜索场景。
fn search_library_fts(conn: &Connection, query: &str, limit: u32) -> Result<Vec<AudioMetadata>, String> {
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
        .collect();
    let match_expr = terms
        .iter()
        .map(|term| format!("(title : {term} OR artist : {term} OR album : {term})"))
        .collect::<Vec<_>>()
        .join(" AND ");

    let mut stmt = conn.prepare(
        "SELECT file_path, title, artist, album, duration, year, track_number, disc_number, genre, album_artist, bitrate, sample_rate, bit_depth, cover_path
         FROM songs WHERE rowid IN (
             SELECT rowid FROM songs_fts WHERE songs_fts MATCH ?1 ORDER BY rank LIMIT ?2
         )"
    ).map_err(|e| e.to_string())?;

    let songs: Vec<AudioMetadata> = stmt.query_map(
        params![match_expr, limit as i64],
        row_to_metadata,
    )
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    Ok(songs)
}

/// LIKE 降级搜索：转义 % _ \ 通配符，避免用户输入被当作模式。
fn search_library_like(conn: &Connection, query: &str, limit: u32) -> Result<Vec<AudioMetadata>, String> {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let pattern = format!("%{escaped}%");

    let mut stmt = conn.prepare(
        "SELECT file_path, title, artist, album, duration, year, track_number, disc_number, genre, album_artist, bitrate, sample_rate, bit_depth, cover_path
         FROM songs
         WHERE title LIKE ?1 ESCAPE '\\' OR artist LIKE ?1 ESCAPE '\\' OR album LIKE ?1 ESCAPE '\\'
         ORDER BY title COLLATE NOCASE LIMIT ?2"
    ).map_err(|e| e.to_string())?;

    let songs: Vec<AudioMetadata> = stmt.query_map(
        params![pattern, limit as i64],
        row_to_metadata,
    )
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

    Ok(songs)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // 第二实例尝试启动时触发：把已有的主窗口显示并聚焦
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            // 检查是否通过文件关联打开（双击音频文件）
            if let Some(file_path) = extract_music_file_arg(&args) {
                let _ = app.emit("open-file", file_path);
            }
        }))
        .manage(PendingFile(Mutex::new(None)))
        .setup(|app| {
            // 注册共享 SQLite 连接状态（惰性初始化，首次访问时打开 + 迁移）
            app.manage(LibraryDb::default());
            // 在 setup 阶段 Tokio 运行时已完全准备就绪，安全启动本地 HTTP 音频代理
            start_luna_audio_proxy_server();

            let handle = app.handle().clone();
            app.listen("tray-quit", move |_| {
                handle.exit(0);
            });
            let handle_show = app.handle().clone();
            app.listen("tray-show-main", move |_| {
                if let Some(window) = handle_show.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                if let Some(tray) = handle_show.get_webview_window("tray-window") {
                    let _ = tray.hide();
                }
            });
            // 检查是否通过文件关联启动（首次启动时前端还未注册监听器）
            let launch_args: Vec<String> = std::env::args().collect();
            if let Some(file_path) = extract_music_file_arg(&launch_args) {
                let state = app.state::<PendingFile>();
                *state.0.lock().unwrap() = Some(file_path);
            }

            if let Some(icon) = app.default_window_icon() {
                // Explicitly refresh the main window icon on every launch.
                // The transparent, decoration-free window can otherwise keep
                // Windows' cached taskbar icon after an in-app update even
                // though the executable, desktop shortcut and tray are new.
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_icon(icon.clone());
                }

                let tray_window = tauri::WebviewWindowBuilder::new(
                    app,
                    "tray-window",
                    tauri::WebviewUrl::App("tray-window.html".into())
                )
                .title("KimoPlayer Tray")
                .inner_size(280.0, 340.0) // 设置更紧凑的高度避免底部留白过大
                .decorations(false)
                .transparent(true)
                .shadow(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .visible(false)
                .build()?;

                let tray_win_clone = tray_window.clone();
                tray_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = tray_win_clone.hide();
                    }
                });

                let _tray = TrayIconBuilder::with_id("main-tray")
                    .icon(icon.clone())
                    .tooltip("KimoPlayer")
                    .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent| {
                        let app = tray.app_handle();
                        match event {
                            tauri::tray::TrayIconEvent::Click { position, button_state, .. } => {
                                // 不再区分左右键，只要弹起就显示
                                if button_state == tauri::tray::MouseButtonState::Up {
                                    if let Some(window) = app.get_webview_window("tray-window") {
                                        if window.is_visible().unwrap_or(false) {
                                            let _ = window.hide();
                                        } else {
                                            if let Ok(Some(monitor)) = window.current_monitor() {
                                                let scale_factor = monitor.scale_factor();
                                                // 避免隐藏窗口 size = 0 导致溢出，强制计算物理尺寸
                                                let width = (280.0 * scale_factor) as i32;
                                                let height = (340.0 * scale_factor) as i32;
                                                let m_size = monitor.size();
                                                let m_pos = monitor.position();
                                                
                                                let mut x = position.x as i32 - (width / 2);
                                                let mut y = position.y as i32 - height - 12;
                                                
                                                // 防止超出屏幕边界
                                                if x + width > m_pos.x + (m_size.width as i32) {
                                                    x = m_pos.x + (m_size.width as i32) - width - 10;
                                                }
                                                if x < m_pos.x {
                                                    x = m_pos.x + 10;
                                                }
                                                if y < m_pos.y {
                                                    y = position.y as i32 + 12;
                                                }
                                                
                                                let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: width as u32, height: height as u32 }));
                                                let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
                                            }
                                            let _ = window.show();
                                            let _ = window.set_focus();
                                        }
                                    }
                                }
                            }
                            tauri::tray::TrayIconEvent::DoubleClick { .. } => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                            _ => {}
                        }
                    })
                    .build(app)?;
                app.manage(TrayIconState(_tray));
            }
            Ok(())
        })
                .invoke_handler(tauri::generate_handler![
            scan_directory,
            read_audio_metadata,
            get_lyrics,
            ai_transcribe_audio,
            ai_align_single_line,
            save_lyrics_cache,
            minimize_window,
            toggle_maximize_window,
            close_window,
            show_in_folder,
            write_audio_metadata,
            open_metadata_editor_window,
            set_desktop_lyrics_visible,
            read_text_file,
            toggle_fullscreen,
            set_fullscreen,
            is_fullscreen,
                        set_prevent_sleep,
            is_sleep_prevented,
            download_font,
                                                search_song_for_comments,
            fetch_song_comments,
            fetch_comment_replies,
            fetch_kuwo_comments,
            fetch_qq_comments,
            fetch_kugou_comments,
            search_kugou_song_hash,
            search_kuwo_song_id,
            search_qq_song_id,
            fetch_multi_platform_comments,
            update_tray_info,
            show_main_window,
            download_and_install_update,
            take_pending_file,
            luna_proxy_get,
            luna_proxy_post,
            luna_proxy_download,
            get_luna_proxy_port,
            init_library_db,
            scan_and_index_library,
            get_library_songs,
            search_library
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // 主窗口关闭时隐藏到托盘，而非退出应用
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod library_db_tests {
    use super::*;

    fn insert_song(conn: &Connection, path: &str, title: &str, artist: &str, album: &str) {
        conn.execute(
            "INSERT OR REPLACE INTO songs (file_path, title, artist, album, duration, last_modified, indexed_at)
             VALUES (?1,?2,?3,?4,0,0,0)",
            params![path, title, artist, album],
        )
        .unwrap();
    }

    #[test]
    fn migrate_creates_fts_and_version() {
        let conn = Connection::open_in_memory().unwrap();
        migrate_schema(&conn).unwrap();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 1);
        let fts: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='songs_fts'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fts, 1);
        // 幂等：重复迁移不报错
        migrate_schema(&conn).unwrap();
    }

    #[test]
    fn fts_syncs_on_insert_replace_and_delete() {
        let conn = Connection::open_in_memory().unwrap();
        migrate_schema(&conn).unwrap();
        insert_song(&conn, "/a/1.mp3", "海阔天空", "Beyond", "乐与怒");
        insert_song(&conn, "/a/2.mp3", "真的爱你", "Beyond", "秘密警察");
        // REPLACE 触发 delete+insert 触发器，FTS 应同步为新值
        insert_song(&conn, "/a/1.mp3", "海阔天空（remix）", "Beyond", "乐与怒");

        let rows = search_library_fts(&conn, "海阔", 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].file_path, "/a/1.mp3");
        assert_eq!(rows[0].title.as_deref(), Some("海阔天空（remix）"));

        let rows2 = search_library_fts(&conn, "Beyond", 10).unwrap();
        assert_eq!(rows2.len(), 2);

        // 删除歌曲 → FTS 同步删除
        conn.execute("DELETE FROM songs WHERE file_path = ?1", ["/a/2.mp3"]).unwrap();
        let rows3 = search_library_fts(&conn, "Beyond", 10).unwrap();
        assert_eq!(rows3.len(), 1);
    }

    #[test]
    fn like_fallback_escapes_wildcards() {
        let conn = Connection::open_in_memory().unwrap();
        migrate_schema(&conn).unwrap();
        insert_song(&conn, "/a/1.mp3", "100%真爱", "A_B", "x");
        // 转义后 % 与 _ 按字面量匹配
        assert_eq!(search_library_like(&conn, "100%", 10).unwrap().len(), 1);
        assert_eq!(search_library_like(&conn, "A_", 10).unwrap().len(), 1);
        assert_eq!(search_library_like(&conn, "10_", 10).unwrap().len(), 0);
    }

    #[test]
    fn fts_punctuation_query_errors_then_like_still_works() {
        // 纯标点输入在 FTS5 中不崩溃、返回空结果；LIKE 路径同样安全。
        // （若某环境 FTS5 对这类输入报语法错误，上层 search_library 会降级 LIKE。）
        let conn = Connection::open_in_memory().unwrap();
        migrate_schema(&conn).unwrap();
        insert_song(&conn, "/a/1.mp3", "!!", "Artist", "Album");
        assert_eq!(search_library_fts(&conn, "!!", 10).unwrap().len(), 0);
        assert_eq!(search_library_like(&conn, "!!", 10).unwrap().len(), 1);
        // 正常词不受影响
        assert_eq!(search_library_fts(&conn, "Artist", 10).unwrap().len(), 1);
    }

    #[test]
    fn legacy_v0_db_upgrades_with_backfill() {
        // 模拟旧库：只有 songs 表、user_version=0、已有数据
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE songs (
                file_path TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT,
                duration INTEGER, year INTEGER, track_number INTEGER, disc_number INTEGER,
                genre TEXT, album_artist TEXT, bitrate INTEGER, sample_rate INTEGER,
                bit_depth INTEGER, cover_path TEXT, last_modified INTEGER, indexed_at INTEGER
            );
            INSERT INTO songs (file_path, title, artist, album)
            VALUES ('/old/1.mp3', '老歌', '老歌手', '老专辑');"
        )
        .unwrap();

        migrate_schema(&conn).unwrap();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, 1);
        // 旧数据已回填 FTS
        let rows = search_library_fts(&conn, "老歌", 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].file_path, "/old/1.mp3");
    }
}
