use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::num::NonZeroU32;
use std::path::Path;

const CONTEXT_TOKENS: u32 = 4096;
const MAX_NEW_TOKENS: usize = 1024;

#[derive(Deserialize)]
struct Request {
    model_path: String,
    system_prompt: String,
    user_content: String,
}

#[derive(Serialize)]
struct Response {
    ok: bool,
    text: Option<String>,
    error: Option<String>,
}

fn main() {
    let response = match run() {
        Ok(text) => Response {
            ok: true,
            text: Some(text),
            error: None,
        },
        Err(error) => Response {
            ok: false,
            text: None,
            error: Some(error),
        },
    };

    let ok = response.ok;
    let encoded = serde_json::to_vec(&response).unwrap_or_else(|error| {
        format!(
            "{{\"ok\":false,\"text\":null,\"error\":\"response serialization failed: {}\"}}",
            error
        )
        .into_bytes()
    });
    let _ = std::io::stdout().write_all(&encoded);
    let _ = std::io::stdout().flush();

    if !ok {
        std::process::exit(2);
    }
}

fn run() -> Result<String, String> {
    let mut input = Vec::new();
    std::io::stdin()
        .read_to_end(&mut input)
        .map_err(|e| format!("Failed to read helper request: {e}"))?;
    let request: Request =
        serde_json::from_slice(&input).map_err(|e| format!("Invalid helper request: {e}"))?;
    infer(
        Path::new(&request.model_path),
        &request.system_prompt,
        &request.user_content,
    )
}

fn infer(model_path: &Path, system_prompt: &str, user_content: &str) -> Result<String, String> {
    if !model_path.is_file() {
        return Err("GGUF model path does not exist".to_string());
    }

    let mut backend =
        LlamaBackend::init().map_err(|e| format!("Failed to initialize llama.cpp: {e}"))?;
    backend.void_logs();

    let model_params = LlamaModelParams::default()
        .with_n_gpu_layers(999)
        .with_use_mmap(true)
        .with_use_mlock(false);

    let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
        .map_err(|e| format!("Failed to load GGUF model: {e}"))?;

    let template = model
        .chat_template(None)
        .map_err(|e| format!("GGUF has no usable embedded chat template: {e}"))?;
    let messages = [
        LlamaChatMessage::new("system".to_string(), system_prompt.to_string())
            .map_err(|e| format!("Invalid system prompt: {e}"))?,
        LlamaChatMessage::new("user".to_string(), user_content.to_string())
            .map_err(|e| format!("Invalid transcription text: {e}"))?,
    ];
    let prompt = model
        .apply_chat_template(&template, &messages, true)
        .map_err(|e| format!("Failed to apply GGUF chat template: {e}"))?;

    let context_size = CONTEXT_TOKENS.min(model.n_ctx_train().max(512));
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(4) as i32)
        .unwrap_or(4);
    let ctx_params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(context_size))
        .with_n_batch(context_size)
        .with_n_threads(threads)
        .with_n_threads_batch(threads);

    let mut ctx = model
        .new_context(&backend, ctx_params)
        .map_err(|e| format!("Failed to create local LLM context: {e}"))?;

    let tokens = model
        .str_to_token(&prompt, AddBos::Always)
        .map_err(|e| format!("Failed to tokenize local LLM prompt: {e}"))?;
    if tokens.is_empty() {
        return Err("Local LLM prompt tokenized to zero tokens".to_string());
    }

    let max_context = usize::try_from(ctx.n_ctx()).unwrap_or(CONTEXT_TOKENS as usize);
    if tokens.len() + 8 >= max_context {
        return Err(format!(
            "Transcription is too long for this local model ({} prompt tokens, {} context tokens)",
            tokens.len(),
            max_context
        ));
    }
    let max_new_tokens = MAX_NEW_TOKENS.min(max_context - tokens.len() - 1);

    let mut batch = LlamaBatch::new(tokens.len().max(1), 1);
    let last_index = tokens.len() as i32 - 1;
    for (index, token) in (0_i32..).zip(tokens.into_iter()) {
        batch
            .add(token, index, &[0], index == last_index)
            .map_err(|e| format!("Failed to build local LLM prompt batch: {e}"))?;
    }
    ctx.decode(&mut batch)
        .map_err(|e| format!("Local LLM prompt evaluation failed: {e}"))?;

    let mut sampler = LlamaSampler::greedy();
    let mut position = batch.n_tokens();
    let mut output = String::new();
    let mut decoder = encoding_rs::UTF_8.new_decoder();

    for _ in 0..max_new_tokens {
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);

        if model.is_eog_token(token) {
            break;
        }

        let piece = model
            .token_to_piece(token, &mut decoder, true, None)
            .map_err(|e| format!("Failed to decode local LLM token: {e}"))?;
        output.push_str(&piece);

        batch.clear();
        batch
            .add(token, position, &[0], true)
            .map_err(|e| format!("Failed to build local LLM decode batch: {e}"))?;
        position += 1;
        ctx.decode(&mut batch)
            .map_err(|e| format!("Local LLM token evaluation failed: {e}"))?;
    }

    let text = output.trim().to_string();
    if text.is_empty() {
        return Err("Local LLM returned an empty response".to_string());
    }
    Ok(text)
}
