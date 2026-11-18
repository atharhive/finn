//! Finn MCP server — repository-context support for TrueForge.
//!
//! Tools: `analyze_repository`, `build_dependency_graph`, `optimize_context`.
//! Resources: `finn://analysis/{root}`, `finn://graph/{root}`.
//! Prompt: `prepare_context`. Finn does not execute agents or simulate progress.
//!
//! Transports: stdio (default), optional Streamable HTTP (`--features http`).
//! Actual-result logging (`FINN_REPORT_DIR`) writes to disk, never stdout.

mod engine;
mod handler;
mod prompts;
mod reporting;
mod resources;
mod tools;

use rmcp::ServiceExt;

use handler::FinnServer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut transport = String::from("stdio");
    let mut addr = String::from("0.0.0.0:3000");

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--transport" => {
                transport = args.next().unwrap_or_else(|| "stdio".to_owned());
            }
            "--addr" => {
                addr = args.next().unwrap_or_else(|| "0.0.0.0:3000".to_owned());
            }
            "--help" | "-h" => {
                println!(
                    "Usage: finn_mcp [--transport stdio|http] [--addr HOST:PORT]\n\n\
                     Transports:\n  \
                     stdio (default)  Model Context Protocol over stdin/stdout.\n  \
                     http             Streamable HTTP (requires the `http` feature)."
                );
                return Ok(());
            }
            other => {
                eprintln!("[finn] ignoring unknown argument: {other}");
            }
        }
    }

    match transport.as_str() {
        "stdio" => {
            let service = FinnServer::new().serve(rmcp::transport::stdio()).await?;
            service.waiting().await?;
        }
        "http" => run_http(&addr).await?,
        other => anyhow::bail!("unknown transport `{other}` (expected `stdio` or `http`)"),
    }
    Ok(())
}

/// Serve the MCP server over Streamable HTTP.
///
/// Requires the `http` cargo feature (axum + rmcp's streamable-http server).
#[cfg(not(feature = "http"))]
async fn run_http(_addr: &str) -> anyhow::Result<()> {
    anyhow::bail!("http transport requires building with `--features http`")
}

#[cfg(feature = "http")]
async fn run_http(addr: &str) -> anyhow::Result<()> {
    use std::sync::Arc;

    use axum::{routing::get, Router};
    use rmcp::transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    };
    use tokio::net::TcpListener;

    let listener = TcpListener::bind(addr).await?;
    let local = listener.local_addr()?;
    let bind_host = local.ip();

    let mut allowed_hosts = vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "[::1]".to_string(),
    ];
    if let Ok(host) = std::env::var("FINN_ALLOWED_HOSTS") {
        allowed_hosts = host
            .split(',')
            .map(|h| h.trim().to_owned())
            .filter(|h| !h.is_empty())
            .collect();
    } else if bind_host.is_unspecified() {
        allowed_hosts.push("0.0.0.0".to_string());
        allowed_hosts.push("[::]".to_string());
    }

    let config = StreamableHttpServerConfig::default()
        .with_allowed_hosts(allowed_hosts)
        .with_allowed_origins(
            std::env::var("FINN_ALLOWED_ORIGINS")
                .ok()
                .map(|origins| {
                    origins
                        .split(',')
                        .map(|o| o.trim().to_owned())
                        .filter(|o| !o.is_empty())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default(),
        );

    let service = StreamableHttpService::new(
        || Ok(FinnServer::new()),
        Arc::new(LocalSessionManager::default()),
        config,
    );

    let app = Router::new()
        .route_service("/mcp", service)
        .route("/health", get(|| async { "ok" }));

    eprintln!("[finn] serving MCP over Streamable HTTP at http://{addr}/mcp");
    axum::serve(listener, app).await?;
    Ok(())
}
