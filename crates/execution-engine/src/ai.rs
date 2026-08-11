use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiTask {
    GenerateRequest,
    ExplainResponse,
    GenerateAssertions,
    GenerateDocumentation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistRequest {
    pub endpoint: String,
    pub model: String,
    pub secret_ref: String,
    pub task: AiTask,
    pub input: String,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAssistResponse {
    pub content: String,
    pub model: String,
}

#[derive(Debug, Error)]
pub enum AiError {
    #[error("AI endpoint is invalid or insecure")]
    InvalidEndpoint,
    #[error("AI model is required")]
    MissingModel,
    #[error("AI input is required")]
    MissingInput,
    #[error("AI provider request failed: {0}")]
    Provider(String),
    #[error("AI provider returned no content")]
    EmptyResponse,
}

pub async fn run_ai_assistant(
    request: AiAssistRequest,
    api_key: &str,
) -> Result<AiAssistResponse, AiError> {
    if request.model.trim().is_empty() {
        return Err(AiError::MissingModel);
    }
    if request.input.trim().is_empty() {
        return Err(AiError::MissingInput);
    }
    let url = completion_url(&request.endpoint)?;
    let system=match request.task {
        AiTask::GenerateRequest => "Generate one ApiVoy HTTP request. Return JSON only with keys name, method, url, headers (array of [name,value]), body, assertions (string array), variables (object). Never include credentials or invented secrets.",
        AiTask::ExplainResponse => "Explain the supplied API response concisely. Identify status semantics, important headers/body fields, likely errors, and concrete next checks. Do not invent unseen data.",
        AiTask::GenerateAssertions => "Generate robust ApiVoy assertions for the supplied request/response. Return a newline-delimited list using status == N, duration < N, size < N, header NAME == VALUE, body contains TEXT, or jsonpath PATH == VALUE.",
        AiTask::GenerateDocumentation => "Write concise API documentation from the supplied request context: purpose, request, authentication references, parameters, response, errors, and example usage. Never reveal secret values.",
    };
    let user = match request
        .context
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        Some(context) => format!("Task input:\n{}\n\nContext:\n{}", request.input, context),
        None => request.input.clone(),
    };
    let payload = serde_json::json!({"model":request.model,"temperature":0.2,"messages":[{"role":"system","content":system},{"role":"user","content":user}]});
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| AiError::Provider(error.to_string()))?
        .post(url)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await
        .map_err(|error| AiError::Provider(error.to_string()))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| AiError::Provider(error.to_string()))?;
    if !status.is_success() {
        return Err(AiError::Provider(format!(
            "HTTP {status}: {}",
            truncate(&text, 500)
        )));
    }
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| AiError::Provider(error.to_string()))?;
    let content = value
        .pointer("/choices/0/message/content")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or(AiError::EmptyResponse)?;
    Ok(AiAssistResponse {
        content: content.to_string(),
        model: request.model,
    })
}

fn completion_url(endpoint: &str) -> Result<Url, AiError> {
    let mut url = Url::parse(endpoint.trim()).map_err(|_| AiError::InvalidEndpoint)?;
    let secure = url.scheme() == "https";
    let local =
        url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if !secure && !local || !url.username().is_empty() || url.password().is_some() {
        return Err(AiError::InvalidEndpoint);
    }
    if !url
        .path()
        .trim_end_matches('/')
        .ends_with("/chat/completions")
    {
        let path = format!("{}/chat/completions", url.path().trim_end_matches('/'));
        url.set_path(&path);
    }
    Ok(url)
}
fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_provider_urls_and_blocks_plain_remote_http() {
        assert_eq!(
            completion_url("https://api.example.com/v1")
                .unwrap()
                .as_str(),
            "https://api.example.com/v1/chat/completions"
        );
        assert!(completion_url("http://api.example.com/v1").is_err());
        assert!(completion_url("http://127.0.0.1:11434/v1").is_ok());
    }

    #[tokio::test]
    async fn sends_bearer_request_and_parses_compatible_response() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut bytes = [0u8; 8192];
            let count = socket.read(&mut bytes).unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]);
            assert!(request
                .to_ascii_lowercase()
                .contains("authorization: bearer test-key"));
            assert!(request.contains("test-model"));
            let body = r#"{"choices":[{"message":{"content":"Generated safely"}}]}"#;
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        });
        let result = run_ai_assistant(
            AiAssistRequest {
                endpoint: format!("http://{address}/v1"),
                model: "test-model".into(),
                secret_ref: "ignored".into(),
                task: AiTask::GenerateDocumentation,
                input: "Document this".into(),
                context: None,
            },
            "test-key",
        )
        .await
        .unwrap();
        assert_eq!(result.content, "Generated safely");
        server.join().unwrap();
    }
}
