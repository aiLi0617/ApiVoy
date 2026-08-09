use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use core_domain::RequestEnvelope;
use rquickjs::{Context, Function, Runtime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use thiserror::Error;

const SCRIPT_MEMORY_LIMIT: usize = 16 * 1024 * 1024;
const SCRIPT_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Debug, Error)]
pub enum ScriptError {
    #[error("script runtime error: {0}")]
    Runtime(String),
    #[error("script timed out after {0}ms")]
    Timeout(u64),
    #[error("script output error: {0}")]
    Output(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResponse {
    pub status: Option<u16>,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub duration_ms: u64,
    pub bytes_received: u64,
}

#[derive(Debug, Clone)]
pub struct ScriptResult {
    pub request: RequestEnvelope,
    pub variables: HashMap<String, String>,
    pub logs: Vec<String>,
}

#[derive(Deserialize)]
struct JsOutput {
    request: RequestEnvelope,
    variables: HashMap<String, String>,
    logs: Vec<String>,
}

fn execute(
    scripts: &[String],
    request: &RequestEnvelope,
    variables: &HashMap<String, String>,
    response: Option<&ScriptResponse>,
) -> Result<JsOutput, ScriptError> {
    let runtime = Runtime::new().map_err(|error| ScriptError::Runtime(error.to_string()))?;
    runtime.set_memory_limit(SCRIPT_MEMORY_LIMIT);
    runtime.set_max_stack_size(512 * 1024);
    let started = Instant::now();
    let interrupted = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&interrupted);
    runtime.set_interrupt_handler(Some(Box::new(move || {
        let timeout = started.elapsed() > SCRIPT_TIMEOUT;
        if timeout {
            flag.store(true, Ordering::Relaxed);
        }
        timeout
    })));
    let context =
        Context::full(&runtime).map_err(|error| ScriptError::Runtime(error.to_string()))?;
    let request_json =
        serde_json::to_string(request).map_err(|error| ScriptError::Output(error.to_string()))?;
    let variables_json =
        serde_json::to_string(variables).map_err(|error| ScriptError::Output(error.to_string()))?;
    let response_json =
        serde_json::to_string(&response).map_err(|error| ScriptError::Output(error.to_string()))?;
    let source = format!("(function(){{'use strict';let request={request_json};let variables={variables_json};const response={response_json};const __logs=[];const console={{log:(...v)=>__logs.push(v.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '))}};const assert=(condition,message='script assertion failed')=>{{if(!condition)throw new Error(message)}};const crypto=Object.freeze({{sha256:__cryptoSha256,base64Encode:__cryptoBase64Encode,base64Decode:__cryptoBase64Decode,randomUUID:__cryptoRandomUuid}});{};return JSON.stringify({{request,variables,logs:__logs}});}})()", scripts.join("\n"));
    let value = context
        .with(|ctx| {
            let globals = ctx.globals();
            globals.set(
                "__cryptoSha256",
                Function::new(ctx.clone(), |value: String| {
                    format!("{:x}", Sha256::digest(value.as_bytes()))
                })?,
            )?;
            globals.set(
                "__cryptoBase64Encode",
                Function::new(ctx.clone(), |value: String| BASE64.encode(value.as_bytes()))?,
            )?;
            globals.set(
                "__cryptoBase64Decode",
                Function::new(ctx.clone(), |value: String| -> rquickjs::Result<String> {
                    let bytes = BASE64.decode(value).map_err(|error| {
                        rquickjs::Error::new_from_js_message(
                            "base64 string",
                            "utf8 string",
                            error.to_string(),
                        )
                    })?;
                    String::from_utf8(bytes).map_err(|error| {
                        rquickjs::Error::new_from_js_message(
                            "base64 bytes",
                            "utf8 string",
                            error.to_string(),
                        )
                    })
                })?,
            )?;
            globals.set(
                "__cryptoRandomUuid",
                Function::new(ctx.clone(), || uuid::Uuid::new_v4().to_string())?,
            )?;
            ctx.eval::<String, _>(source)
        })
        .map_err(|error| {
            if interrupted.load(Ordering::Relaxed) {
                ScriptError::Timeout(SCRIPT_TIMEOUT.as_millis() as u64)
            } else {
                ScriptError::Runtime(error.to_string())
            }
        })?;
    serde_json::from_str(&value).map_err(|error| ScriptError::Output(error.to_string()))
}

pub async fn run_pre_scripts(mut request: RequestEnvelope) -> Result<ScriptResult, ScriptError> {
    if request.pre_scripts.is_empty() {
        return Ok(ScriptResult {
            variables: request.variables.clone(),
            request,
            logs: vec![],
        });
    }
    let scripts = request.pre_scripts.clone();
    let variables = request.variables.clone();
    let request_for_script = request.clone();
    let output = tokio::task::spawn_blocking(move || {
        execute(&scripts, &request_for_script, &variables, None)
    })
    .await
    .map_err(|error| ScriptError::Runtime(error.to_string()))??;
    request = output.request;
    request.variables = output.variables.clone();
    Ok(ScriptResult {
        request,
        variables: output.variables,
        logs: output.logs,
    })
}

pub async fn run_post_scripts(
    request: RequestEnvelope,
    response: ScriptResponse,
) -> Result<ScriptResult, ScriptError> {
    if request.post_scripts.is_empty() {
        return Ok(ScriptResult {
            variables: request.variables.clone(),
            request,
            logs: vec![],
        });
    }
    let scripts = request.post_scripts.clone();
    let variables = request.variables.clone();
    let request_for_script = request.clone();
    let output = tokio::task::spawn_blocking(move || {
        execute(&scripts, &request_for_script, &variables, Some(&response))
    })
    .await
    .map_err(|error| ScriptError::Runtime(error.to_string()))??;
    Ok(ScriptResult {
        request: output.request,
        variables: output.variables,
        logs: output.logs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn pre_script_mutates_request_and_variables() {
        let mut request = RequestEnvelope::http_get("test", "https://example.com");
        request.pre_scripts = vec!["variables.token='abc'; request.target += '/users'; console.log('ready', variables.token);".into()];
        let result = run_pre_scripts(request).await.unwrap();
        assert_eq!(result.request.target, "https://example.com/users");
        assert_eq!(
            result.variables.get("token").map(String::as_str),
            Some("abc")
        );
        assert_eq!(result.logs, vec!["ready abc"]);
    }
    #[tokio::test]
    async fn post_script_can_assert_response() {
        let mut request = RequestEnvelope::http_get("test", "https://example.com");
        request.post_scripts =
            vec!["assert(response.status===200, 'bad status'); variables.id='42';".into()];
        let result = run_post_scripts(
            request,
            ScriptResponse {
                status: Some(200),
                headers: HashMap::new(),
                body: "ok".into(),
                duration_ms: 1,
                bytes_received: 2,
            },
        )
        .await
        .unwrap();
        assert_eq!(result.variables.get("id").map(String::as_str), Some("42"));
    }
    #[tokio::test]
    async fn interrupts_infinite_script() {
        let mut request = RequestEnvelope::http_get("test", "https://example.com");
        request.pre_scripts = vec!["while(true){}".into()];
        assert!(matches!(
            run_pre_scripts(request).await,
            Err(ScriptError::Timeout(_))
        ));
    }

    #[tokio::test]
    async fn exposes_bounded_crypto_helpers() {
        let mut request = RequestEnvelope::http_get("test", "https://example.com");
        request.pre_scripts = vec!["variables.hash=crypto.sha256('abc'); variables.encoded=crypto.base64Encode('ApiVoy'); variables.decoded=crypto.base64Decode(variables.encoded); variables.uuid=crypto.randomUUID();".into()];
        let result = run_pre_scripts(request).await.unwrap();
        assert_eq!(
            result.variables.get("hash").map(String::as_str),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
        assert_eq!(
            result.variables.get("encoded").map(String::as_str),
            Some("QXBpVm95")
        );
        assert_eq!(
            result.variables.get("decoded").map(String::as_str),
            Some("ApiVoy")
        );
        assert!(uuid::Uuid::parse_str(result.variables.get("uuid").unwrap()).is_ok());
    }
}
