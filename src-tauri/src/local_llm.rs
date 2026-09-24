use log::{debug, info};
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

const LOCAL_LLM_DIR: &str = "llm_models";
const HELPER_TIMEOUT: Duration = Duration::from_secs(120);

static INFERENCE_LOCK: OnceCell<tokio::sync::Mutex<()>> = OnceCell::new();

#[derive(Serialize)]
struct HelperRequest {
    model_path: String,
    system_prompt: String,
    user_content: String,
}

#[derive(Deserialize)]
struct HelperResponse {
    ok: bool,
    text: Option<String>,
    error: Option<String>,
}

fn inference_lock() -> &'static tokio::sync::Mutex<()> {
    INFERENCE_LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::portable::app_data_dir(app)
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?
        .join(LOCAL_LLM_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create local LLM models directory: {e}"))?;
    Ok(dir)
}

fn valid_model_filename(name: &str) -> bool {
    let path = Path::new(name);
    path.components().count() == 1
        && path.file_name() == Some(OsStr::new(name))
        && path
            .extension()
            .and_then(OsStr::to_str)
            .is_some_and(|ext| ext.eq_ignore_ascii_case("gguf"))
}

pub fn model_path(app: &AppHandle, model_name: &str) -> Result<PathBuf, String> {
    if !valid_model_filename(model_name) {
        return Err("Local LLM model must be a GGUF file in Handy's model directory".to_string());
    }
    let path = models_dir(app)?.join(model_name);
    if !path.is_file() {
        return Err(format!("Local LLM model is not installed: {model_name}"));
    }
    Ok(path)
}

pub fn list_models(app: &AppHandle) -> Result<Vec<String>, String> {
    let dir = models_dir(app)?;
    let mut models = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read local LLM models directory: {e}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let name = path.file_name()?.to_str()?.to_string();
            valid_model_filename(&name).then_some(name)
        })
        .collect::<Vec<_>>();
    models.sort_by_key(|name| name.to_lowercase());
    Ok(models)
}

pub fn import_model(app: &AppHandle, source_path: &str) -> Result<String, String> {
    let source = std::fs::canonicalize(source_path)
        .map_err(|e| format!("Failed to access selected model: {e}"))?;
    if !source.is_file() {
        return Err("Selected local LLM model is not a regular file".to_string());
    }

    let file_name = source
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| "Selected model filename is not valid UTF-8".to_string())?
        .to_string();
    if !valid_model_filename(&file_name) {
        return Err("Only .gguf local LLM models are supported".to_string());
    }

    let dir = models_dir(app)?;
    let destination = dir.join(&file_name);
    if source == destination {
        return Ok(file_name);
    }

    let temp_name = format!(".{file_name}.{}.part", std::process::id());
    let temp = dir.join(temp_name);
    let _ = std::fs::remove_file(&temp);

    if let Err(error) = std::fs::copy(&source, &temp) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("Failed to copy local LLM model: {error}"));
    }

    if let Err(error) = std::fs::rename(&temp, &destination) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("Failed to install local LLM model: {error}"));
    }

    Ok(file_name)
}

fn helper_path() -> Result<PathBuf, String> {
    let executable =
        std::env::current_exe().map_err(|e| format!("Failed to resolve Handy executable: {e}"))?;
    if let Some(parent) = executable.parent() {
        let bundled = parent.join("handy-local-llm");
        if bundled.is_file() {
            return Ok(bundled);
        }
    }

    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join("handy-local-llm-aarch64-apple-darwin");
    if development.is_file() {
        return Ok(development);
    }

    Err("Bundled direct local LLM helper is missing".to_string())
}

fn short_stderr(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .take(2000)
        .collect::<String>()
        .trim()
        .to_string()
}

pub async fn process(
    app: &AppHandle,
    model_name: &str,
    system_prompt: String,
    user_content: String,
) -> Result<String, String> {
    let _guard = inference_lock().lock().await;
    let path = model_path(app, model_name)?;
    let helper = helper_path()?;
    let started = Instant::now();

    let request = HelperRequest {
        model_path: path.to_string_lossy().into_owned(),
        system_prompt,
        user_content,
    };
    let payload =
        serde_json::to_vec(&request).map_err(|e| format!("Failed to encode helper request: {e}"))?;

    let operation = async {
        let mut child = Command::new(&helper)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to launch local LLM helper: {e}"))?;

        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Local LLM helper stdin is unavailable".to_string())?;
        stdin
            .write_all(&payload)
            .await
            .map_err(|e| format!("Failed to send request to local LLM helper: {e}"))?;
        drop(stdin);

        child
            .wait_with_output()
            .await
            .map_err(|e| format!("Local LLM helper failed to finish: {e}"))
    };

    let output = tokio::time::timeout(HELPER_TIMEOUT, operation)
        .await
        .map_err(|_| "Local LLM post-processing timed out after 120 seconds".to_string())??;

    let response: HelperResponse = serde_json::from_slice(&output.stdout).map_err(|e| {
        let stderr = short_stderr(&output.stderr);
        if stderr.is_empty() {
            format!("Local LLM helper returned invalid JSON: {e}")
        } else {
            format!("Local LLM helper returned invalid JSON: {e}; stderr: {stderr}")
        }
    })?;

    if !output.status.success() || !response.ok {
        let detail = response
            .error
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                let stderr = short_stderr(&output.stderr);
                if stderr.is_empty() {
                    format!("helper exited with status {}", output.status)
                } else {
                    stderr
                }
            });
        debug!(
            "Direct local LLM post-processing with '{}' failed: {}",
            model_name, detail
        );
        return Err(detail);
    }

    let text = response
        .text
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Local LLM helper returned an empty response".to_string())?;

    info!(
        "Direct local LLM post-processing completed with '{}' in {:.2}s ({} chars)",
        model_name,
        started.elapsed().as_secs_f64(),
        text.len()
    );
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::valid_model_filename;

    #[test]
    fn accepts_only_plain_gguf_filenames() {
        assert!(valid_model_filename("Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"));
        assert!(valid_model_filename("MODEL.GGUF"));
        assert!(!valid_model_filename("../model.gguf"));
        assert!(!valid_model_filename("folder/model.gguf"));
        assert!(!valid_model_filename("model.bin"));
    }
}
