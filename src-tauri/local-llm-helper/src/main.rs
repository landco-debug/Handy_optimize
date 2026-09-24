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
const PROMPT_BATCH_TOKENS: usize = 256;
const MAX_NEW_TOKENS: usize = 384;

#[derive(Deserialize)]
struct Request {
    model_path: String,
    system_prompt: String,
    user_content: String,
    #[serde(default)]
    force_cpu: bool,
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
        request.force_cpu,
    )
}

fn infer(
    model_path: &Path,
    system_prompt: &str,
    user_content: &str,
    force_cpu: bool,
) -> Result<String, String> {
    if !model_path.is_file() {
        return Err("GGUF model path does not exist".to_string());
    }

    let mut backend =
        LlamaBackend::init().map_err(|e| format!("Failed to initialize llama.cpp: {e}"))?;
    backend.void_logs();

    let model_params = LlamaModelParams::default()
        .with_n_gpu_layers(if force_cpu { 0 } else { 999 })
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
        .with_n_batch(PROMPT_BATCH_TOKENS as u32)
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
    // Post-processing output should be roughly proportional to the input, not
    // an unconstrained chat response. The cap also prevents a malformed chat
    // template/model from keeping the UI in "Processing" for minutes.
    let max_new_tokens = tokens
        .len()
        .clamp(96, MAX_NEW_TOKENS)
        .min(max_context - tokens.len() - 1);

    // Keep n_batch small on 8 GB unified-memory Macs. Decode the prompt in
    // chunks instead of allocating a 4K-token compute batch for short dictation.
    let mut batch = LlamaBatch::new(PROMPT_BATCH_TOKENS, 1);
    let mut position = 0_i32;
    let total_tokens = tokens.len();

    for (chunk_index, chunk) in tokens.chunks(PROMPT_BATCH_TOKENS).enumerate() {
        batch.clear();
        let final_chunk = (chunk_index + 1) * PROMPT_BATCH_TOKENS >= total_tokens;
        for (offset, token) in chunk.iter().copied().enumerate() {
            let is_last = final_chunk && offset + 1 == chunk.len();
            batch
                .add(token, position, &[0], is_last)
                .map_err(|e| format!("Failed to build local LLM prompt batch: {e}"))?;
            position += 1;
        }
        ctx.decode(&mut batch)
            .map_err(|e| format!("Local LLM prompt evaluation failed: {e}"))?;
    }

    let mut sampler = LlamaSampler::greedy();
    let mut output = String::new();
    let mut decoder = encoding_rs::UTF_8.new_decoder();

    let mut reached_eog = false;
    for _ in 0..max_new_tokens {
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);

        if model.is_eog_token(token) {
            reached_eog = true;
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

    if !reached_eog {
        return Err(format!(
            "Local LLM exceeded the bounded output budget of {max_new_tokens} tokens"
        ));
    }

    let text = output.trim().to_string();
    if text.is_empty() {
        return Err("Local LLM returned an empty response".to_string());
    }
    Ok(text)
}
