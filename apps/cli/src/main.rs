use std::sync::Arc;

use clap::{Parser, Subcommand};
use driver_http::HttpDriver;
use execution_engine::{sample_http_get, ExecutionEngine};
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
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let cli = Cli::parse();
    let mut engine = ExecutionEngine::new();
    engine.register(Arc::new(HttpDriver::new()));
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
    }

    Ok(())
}
