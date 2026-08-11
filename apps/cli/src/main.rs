use std::{collections::HashMap, path::PathBuf, sync::Arc};

use clap::{Parser, Subcommand};
use core_domain::{ExecutionEvent, ExecutionState, HttpPayload, ProtocolPayload, RequestEnvelope};
use driver_graphql::GraphqlDriver;
use driver_grpc::GrpcDriver;
use driver_http::HttpDriver;
use driver_mqtt::MqttDriver;
use driver_redis::RedisDriver;
use driver_rpc_http::{JsonRpcDriver, SoapDriver};
use driver_sse::SseDriver;
use driver_tcp_udp::{TcpDriver, UdpDriver};
use driver_websocket::WebSocketDriver;
use execution_engine::{sample_http_get, ExecutionEngine, VariableScope};
use serde::Serialize;
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(
    name = "apivoy-cli",
    version,
    about = "ApiVoy CLI — Explore Every Protocol."
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Send a simple HTTP GET request through the unified execution engine
    HttpGet {
        /// Target URL
        url: String,
    },
    /// List registered protocol drivers
    Drivers,
    /// Run a JSON collection in CI and optionally write a JSON or JUnit report
    Run {
        file: PathBuf,
        #[arg(long, default_value_t = 1)]
        concurrency: usize,
        #[arg(long)]
        fail_fast: bool,
        #[arg(long)]
        report: Option<PathBuf>,
        #[arg(long, default_value = "json")]
        report_format: String,
        /// JSON array or CSV file whose rows become iteration variables
        #[arg(long)]
        data: Option<PathBuf>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunCase {
    iteration: usize,
    name: String,
    protocol_id: String,
    passed: bool,
    duration_ms: u64,
    error: Option<String>,
    failed_assertions: Vec<String>,
}

fn load_data(path: &PathBuf) -> Result<Vec<HashMap<String, String>>, Box<dyn std::error::Error>> {
    let contents = std::fs::read_to_string(path)?;
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("csv"))
    {
        return parse_csv_data(&contents);
    }
    parse_json_data(&contents)
}

fn parse_csv_data(
    contents: &str,
) -> Result<Vec<HashMap<String, String>>, Box<dyn std::error::Error>> {
    let mut reader = csv::Reader::from_reader(contents.as_bytes());
    let headers = reader.headers()?.clone();
    reader
        .records()
        .map(|record| {
            let record = record?;
            Ok(headers
                .iter()
                .zip(record.iter())
                .map(|(name, value)| (name.to_owned(), value.to_owned()))
                .collect())
        })
        .collect::<Result<Vec<_>, csv::Error>>()
        .map_err(Into::into)
}

fn parse_json_data(
    contents: &str,
) -> Result<Vec<HashMap<String, String>>, Box<dyn std::error::Error>> {
    let value: serde_json::Value = serde_json::from_str(contents)?;
    let rows = value
        .as_array()
        .ok_or("data JSON must be an array of objects")?;
    rows.iter()
        .map(|row| {
            let object = row.as_object().ok_or("each data row must be an object")?;
            Ok(object
                .iter()
                .map(|(name, value)| {
                    (
                        name.clone(),
                        value
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| value.to_string()),
                    )
                })
                .collect())
        })
        .collect()
}

fn load_collection(path: &PathBuf) -> Result<Vec<RequestEnvelope>, Box<dyn std::error::Error>> {
    let value: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    let rows = if value.is_array() {
        value.as_array().cloned().unwrap_or_default()
    } else {
        value
            .get("requests")
            .and_then(|item| item.as_array())
            .cloned()
            .ok_or("collection must be an array or contain requests")?
    };
    rows.into_iter()
        .map(|row| {
            if row.get("protocolId").is_some() {
                return serde_json::from_value(row).map_err(Into::into);
            }
            let name = row
                .get("name")
                .and_then(|item| item.as_str())
                .unwrap_or("Imported request");
            let url = row
                .get("url")
                .and_then(|item| item.as_str())
                .ok_or("portable request is missing url")?;
            let method = row
                .get("method")
                .and_then(|item| item.as_str())
                .unwrap_or("GET");
            let mut request = RequestEnvelope::http_get(name, url);
            let headers = row
                .get("headers")
                .and_then(|item| item.as_object())
                .map(|items| {
                    items
                        .iter()
                        .map(|(name, value)| {
                            (name.clone(), value.as_str().unwrap_or_default().to_owned())
                        })
                        .collect()
                })
                .unwrap_or_default();
            request.payload = ProtocolPayload::Http(HttpPayload {
                method: method.to_owned(),
                headers,
                body: row
                    .get("body")
                    .and_then(|item| item.as_str())
                    .map(str::to_owned),
                multipart: vec![],
                follow_redirects: true,
            });
            Ok(request)
        })
        .collect()
}

fn junit(cases: &[RunCase]) -> String {
    let failures = cases.iter().filter(|case| !case.passed).count();
    let body = cases
        .iter()
        .map(|case| {
            let failure_message = case.error.clone().or_else(|| {
                (!case.failed_assertions.is_empty()).then(|| format!("assertions failed: {}", case.failed_assertions.join(", ")))
            });
            let failure = failure_message.as_ref().map(|message| format!("<failure message=\"{}\"/>", xml_escape(message))).unwrap_or_default();
            format!(
                "<testcase name=\"[iteration {}] {}\" classname=\"{}\" time=\"{:.3}\">{}</testcase>",
                case.iteration,
                xml_escape(&case.name),
                xml_escape(&case.protocol_id),
                case.duration_ms as f64 / 1000.0,
                failure
            )
        })
        .collect::<String>();
    format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><testsuite name=\"ApiVoy\" tests=\"{}\" failures=\"{}\">{}</testsuite>", cases.len(), failures, body)
}
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

async fn run_case(
    engine: &ExecutionEngine,
    request: RequestEnvelope,
    scope: VariableScope,
    iteration: usize,
) -> (RunCase, HashMap<String, String>) {
    let name = request.name.clone();
    let protocol_id = request.protocol_id.0.clone();
    match engine.execute_collect_with_scope(request, scope).await {
        Ok((_id, summary, events)) => {
            let failed_assertions = events
                .iter()
                .filter_map(|event| match event {
                    ExecutionEvent::AssertionResult(result) if !result.passed => {
                        Some(result.name.clone())
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();
            let extracted = events
                .iter()
                .rev()
                .find_map(|event| match event {
                    ExecutionEvent::VariablesExtracted { variables } => Some(variables.clone()),
                    _ => None,
                })
                .unwrap_or_default();
            let passed = summary.state == ExecutionState::Completed && failed_assertions.is_empty();
            (
                RunCase {
                    iteration,
                    name,
                    protocol_id,
                    passed,
                    duration_ms: summary.duration_ms,
                    error: None,
                    failed_assertions,
                },
                extracted,
            )
        }
        Err(error) => (
            RunCase {
                iteration,
                name,
                protocol_id,
                passed: false,
                duration_ms: 0,
                error: Some(error.to_string()),
                failed_assertions: vec![],
            },
            HashMap::new(),
        ),
    }
}

async fn run_iteration(
    engine: &ExecutionEngine,
    requests: Vec<RequestEnvelope>,
    data: HashMap<String, String>,
    iteration: usize,
    fail_fast: bool,
) -> Vec<RunCase> {
    let mut cases = Vec::new();
    let mut collection_variables = HashMap::new();
    for request in requests {
        let scope = VariableScope {
            environment: data.clone(),
            collection: collection_variables.clone(),
            ..Default::default()
        };
        let (case, extracted) = run_case(engine, request, scope, iteration).await;
        collection_variables.extend(extracted);
        let failed = !case.passed;
        eprintln!(
            "{} iteration={} {} — {}",
            if case.passed { "PASS" } else { "FAIL" },
            iteration,
            case.protocol_id,
            case.name
        );
        cases.push(case);
        if fail_fast && failed {
            break;
        }
    }
    cases
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let cli = Cli::parse();
    let mut engine = ExecutionEngine::new();
    engine.register(Arc::new(HttpDriver::new()));
    engine.register(Arc::new(SseDriver::new()));
    engine.register(Arc::new(TcpDriver));
    engine.register(Arc::new(UdpDriver));
    engine.register(Arc::new(GraphqlDriver::new()));
    engine.register(Arc::new(WebSocketDriver));
    engine.register(Arc::new(GrpcDriver::new()));
    engine.register(Arc::new(JsonRpcDriver::default()));
    engine.register(Arc::new(SoapDriver::default()));
    engine.register(Arc::new(RedisDriver));
    engine.register(Arc::new(MqttDriver));
    let engine = Arc::new(engine);

    match cli.command {
        Commands::Drivers => {
            for d in engine.list_drivers() {
                println!("{} {} — {}", d.protocol_id, d.version, d.display_name);
            }
        }
        Commands::HttpGet { url } => {
            let req = sample_http_get(url);
            let (id, mut rx, handle) = engine.execute(req).await?;

            let engine_cancel = Arc::clone(&engine);
            let cancel_id = id;
            tokio::spawn(async move {
                if tokio::signal::ctrl_c().await.is_ok() {
                    if engine_cancel.cancel(&cancel_id) {
                        eprintln!("cancelled execution {}", cancel_id.0);
                    }
                }
            });

            let mut events = Vec::new();
            while let Some(event) = rx.recv().await {
                events.push(event);
            }
            let summary = handle.await??;

            println!("{}", serde_json::to_string_pretty(&summary)?);
            println!("executionId: {}", id.0);
            println!("events: {}", events.len());
        }
        Commands::Run {
            file,
            concurrency,
            fail_fast,
            report,
            report_format,
            data,
        } => {
            let requests = load_collection(&file)?;
            if let Some(data_file) = data {
                let rows = load_data(&data_file)?;
                if rows.is_empty() {
                    return Err("data file contains no rows".into());
                }
                let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency.max(1)));
                let mut tasks = tokio::task::JoinSet::new();
                for (index, row) in rows.into_iter().enumerate() {
                    let engine = Arc::clone(&engine);
                    let requests = requests.clone();
                    let semaphore = Arc::clone(&semaphore);
                    tasks.spawn(async move {
                        let _permit = semaphore
                            .acquire_owned()
                            .await
                            .map_err(|error| error.to_string())?;
                        Ok::<_, String>(
                            run_iteration(&engine, requests, row, index + 1, fail_fast).await,
                        )
                    });
                }
                let mut cases = Vec::new();
                while let Some(result) = tasks.join_next().await {
                    let iteration_cases = result.map_err(|error| error.to_string())??;
                    let failed = iteration_cases.iter().any(|case| !case.passed);
                    cases.extend(iteration_cases);
                    if fail_fast && failed {
                        tasks.abort_all();
                        break;
                    }
                }
                cases.sort_by_key(|case| case.iteration);
                let passed = cases.iter().all(|case| case.passed);
                let output = if report_format.eq_ignore_ascii_case("junit") {
                    junit(&cases)
                } else {
                    serde_json::to_string_pretty(&cases)?
                };
                if let Some(path) = report {
                    std::fs::write(path, &output)?;
                } else {
                    println!("{output}");
                }
                if !passed {
                    std::process::exit(1);
                }
                return Ok(());
            }
            if concurrency <= 1 {
                let mut cases = Vec::new();
                let mut collection_variables = HashMap::new();
                for request in requests {
                    let scope = VariableScope {
                        collection: collection_variables.clone(),
                        ..Default::default()
                    };
                    let (case, extracted) = run_case(&engine, request, scope, 1).await;
                    collection_variables.extend(extracted);
                    let failed = !case.passed;
                    eprintln!(
                        "{} {} — {}",
                        if case.passed { "PASS" } else { "FAIL" },
                        case.protocol_id,
                        case.name
                    );
                    cases.push(case);
                    if fail_fast && failed {
                        break;
                    }
                }
                let passed = cases.iter().all(|case| case.passed);
                let output = if report_format.eq_ignore_ascii_case("junit") {
                    junit(&cases)
                } else {
                    serde_json::to_string_pretty(&cases)?
                };
                if let Some(path) = report {
                    std::fs::write(path, &output)?;
                } else {
                    println!("{output}");
                }
                if !passed {
                    std::process::exit(1);
                }
                return Ok(());
            }
            let semaphore = Arc::new(tokio::sync::Semaphore::new(concurrency.max(1)));
            let mut tasks = tokio::task::JoinSet::new();
            for request in requests {
                let engine = Arc::clone(&engine);
                let semaphore = Arc::clone(&semaphore);
                tasks.spawn(async move {
                    let _permit = semaphore
                        .acquire_owned()
                        .await
                        .map_err(|error| error.to_string())?;
                    Ok::<_, String>(
                        run_case(&engine, request, VariableScope::default(), 1)
                            .await
                            .0,
                    )
                });
                if fail_fast && tasks.len() > 0 { /* scheduling remains bounded by semaphore; stop is applied while collecting */
                }
            }
            let mut cases = Vec::new();
            while let Some(result) = tasks.join_next().await {
                let case = result.map_err(|error| error.to_string())??;
                let failed = !case.passed;
                eprintln!(
                    "{} {} — {}",
                    if case.passed { "PASS" } else { "FAIL" },
                    case.protocol_id,
                    case.name
                );
                cases.push(case);
                if fail_fast && failed {
                    tasks.abort_all();
                    break;
                }
            }
            let passed = cases.iter().all(|case| case.passed);
            let output = if report_format.eq_ignore_ascii_case("junit") {
                junit(&cases)
            } else {
                serde_json::to_string_pretty(&cases)?
            };
            if let Some(path) = report {
                std::fs::write(path, &output)?;
            } else {
                println!("{output}");
            }
            if !passed {
                std::process::exit(1);
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_and_csv_iteration_data() {
        let json = parse_json_data(r#"[{"user":"alice","count":2}]"#).unwrap();
        assert_eq!(json[0].get("user").map(String::as_str), Some("alice"));
        assert_eq!(json[0].get("count").map(String::as_str), Some("2"));
        let csv = parse_csv_data("user,note\nbob,\"hello, world\"\n").unwrap();
        assert_eq!(csv[0].get("user").map(String::as_str), Some("bob"));
        assert_eq!(csv[0].get("note").map(String::as_str), Some("hello, world"));
    }

    #[test]
    fn junit_reports_assertion_failures_and_iteration() {
        let xml = junit(&[RunCase {
            iteration: 3,
            name: "request".into(),
            protocol_id: "http".into(),
            passed: false,
            duration_ms: 10,
            error: None,
            failed_assertions: vec!["status".into()],
        }]);
        assert!(xml.contains("[iteration 3] request"));
        assert!(xml.contains("assertions failed: status"));
    }
}
