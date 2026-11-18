//! End-to-end integration tests.
//!
//! Spawns the real `finn_mcp` binary and drives the Model Context Protocol over
//! stdio with raw JSON-RPC frames, verifying the advertised surface: tools,
//! resources, prompts, and error handling. The tests use the *installed*
//! `finn_mcp` binary built from this crate (`CARGO_BIN_EXE_finn_mcp`), so they
//! exercise the real handler, engine bridge, and transports without mocking.

use std::{collections::BTreeSet, process::Stdio, time::Duration};

use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
};

const TIMEOUT: Duration = Duration::from_secs(30);

/// Spawn the real `finn_mcp` binary with stdio transport.
fn spawn_server() -> Child {
    let exe = env!("CARGO_BIN_EXE_finn_mcp");
    Command::new(exe)
        .arg("--transport")
        .arg("stdio")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .expect("spawn finn_mcp server")
}

/// MCP session over the spawned server's stdio pipes.
struct McpClient {
    writer: tokio::process::ChildStdin,
    reader: BufReader<tokio::process::ChildStdout>,
    child: Child,
    next_id: u64,
    notifications: Vec<Value>,
}

impl McpClient {
    async fn connect() -> anyhow::Result<(Self, Value)> {
        let mut child = spawn_server();
        let writer = child.stdin.take().expect("server stdin");
        let reader = BufReader::new(child.stdout.take().expect("server stdout"));

        let mut client = Self {
            writer,
            reader,
            child,
            next_id: 1,
            notifications: Vec::new(),
        };
        let initialize = client
            .request(json!({
                "jsonrpc": "2.0",
                "id": 0,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": { "name": "integration-test", "version": "0.0.0" }
                }
            }))
            .await?;
        client
            .notify(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .await?;
        Ok((client, initialize))
    }

    /// Send a request, read responses until `id`, and return its `result`.
    async fn request(&mut self, message: Value) -> anyhow::Result<Value> {
        let response = self.raw_request(message).await?;
        if let Some(error) = response.get("error") {
            anyhow::bail!("RPC error: {error}");
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    /// Send a request and return the full JSON-RPC response (error or result).
    async fn raw_request(&mut self, message: Value) -> anyhow::Result<Value> {
        let id = message
            .get("id")
            .and_then(Value::as_u64)
            .expect("request id");
        self.write(&message).await?;
        self.read_until_id(id).await
    }

    /// Send a notification (no response expected).
    async fn notify(&mut self, message: Value) -> anyhow::Result<()> {
        self.write(&message).await
    }

    async fn write(&mut self, message: &Value) -> anyhow::Result<()> {
        let serialized = serde_json::to_string(message)?;
        self.writer.write_all(serialized.as_bytes()).await?;
        self.writer.write_all(b"\n").await?;
        self.writer.flush().await?;
        Ok(())
    }

    async fn read_until_id(&mut self, expected_id: u64) -> anyhow::Result<Value> {
        let deadline = tokio::time::Instant::now() + TIMEOUT;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                anyhow::bail!("timed out waiting for response id {expected_id}");
            }
            let mut line = String::new();
            let read_result =
                tokio::time::timeout(remaining, self.reader.read_line(&mut line)).await;
            let Ok(Ok(read)) = read_result else {
                anyhow::bail!("failed reading from server");
            };
            if read == 0 {
                anyhow::bail!("server closed stdout while waiting for id {expected_id}");
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let value: Value = serde_json::from_str(trimmed)?;
            if value.get("method").is_some() && value.get("id").is_none() {
                self.notifications.push(value.clone());
            }
            if let Some(id) = value.get("id").and_then(Value::as_u64) {
                if id == expected_id {
                    return Ok(value);
                }
            }
        }
    }

    async fn next_call(&mut self, method: &str, params: Value) -> anyhow::Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        self.request(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
        .await
    }

    async fn shutdown(mut self) {
        let _ = tokio::time::timeout(Duration::from_secs(2), self.child.wait()).await;
        if self.child.id().is_some() {
            let _ = self.child.kill().await;
        }
    }
}

fn tool_names(tools: &Value) -> BTreeSet<String> {
    tools
        .get("tools")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|t| t.get("name").and_then(Value::as_str).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn resource_template_uris(templates: &Value) -> BTreeSet<String> {
    templates
        .get("resourceTemplates")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|t| {
                    t.get("uriTemplate")
                        .and_then(Value::as_str)
                        .map(String::from)
                })
                .collect()
        })
        .unwrap_or_default()
}

#[tokio::test]
async fn initialize_advertises_tools_resources_and_prompts() -> anyhow::Result<()> {
    let (client, result) = McpClient::connect().await?;
    client.shutdown().await;

    let capabilities = result.get("capabilities").expect("capabilities");
    assert!(capabilities.get("tools").is_some(), "tools capability");
    assert!(
        capabilities.get("resources").is_some(),
        "resources capability"
    );
    assert!(capabilities.get("prompts").is_some(), "prompts capability");

    let info = result.get("serverInfo").expect("serverInfo");
    assert_eq!(info.get("name").and_then(Value::as_str), Some("finn"));
    Ok(())
}

#[tokio::test]
async fn tools_list_exposes_all_finn_tools() -> anyhow::Result<()> {
    let (mut client, _) = McpClient::connect().await?;
    let result = client.next_call("tools/list", json!({})).await?;
    client.shutdown().await;

    let names = tool_names(&result);
    assert_eq!(
        names,
        BTreeSet::from([
            "analyze_repository".to_string(),
            "build_dependency_graph".to_string(),
            "optimize_context".to_string(),
        ])
    );
    Ok(())
}

#[tokio::test]
async fn requests_do_not_emit_synthetic_progress() -> anyhow::Result<()> {
    let (mut client, _) = McpClient::connect().await?;
    let dir = tempfile::tempdir()?;
    std::fs::write(dir.path().join("main.rs"), "fn main() {}")?;
    let root = dir.path().to_str().unwrap();
    let missing = dir.path().join("missing");
    for root in [root, missing.to_str().unwrap()] {
        for name in [
            "analyze_repository",
            "build_dependency_graph",
            "optimize_context",
        ] {
            let result = client
                .next_call(
                    "tools/call",
                    json!({
                        "name": name,
                        "arguments": {"root": root, "query": "main", "max_tokens": 1000},
                        "_meta": {"progressToken": "test-progress"}
                    }),
                )
                .await?;
            assert_eq!(result["isError"], root == missing.to_str().unwrap());
        }
        for kind in ["analysis", "graph"] {
            let id = client.next_id;
            client.next_id += 1;
            let _ = client
                .raw_request(json!({
                    "jsonrpc": "2.0", "id": id, "method": "resources/read",
                    "params": {"uri": format!("finn://{kind}/{root}"),
                        "_meta": {"progressToken": "test-progress"}}
                }))
                .await?;
        }
    }
    assert!(
        !client
            .notifications
            .iter()
            .any(|n| n["method"] == "notifications/progress"),
        "no invented stage percentages or completion on failure: {:?}",
        client.notifications
    );
    client.shutdown().await;
    Ok(())
}

#[tokio::test]
async fn synthetic_tools_are_rejected() -> anyhow::Result<()> {
    let (mut client, _) = McpClient::connect().await?;
    for name in [
        "schedule_agents",
        "list_agents",
        "advance_agents",
        "generate_report",
        "get_cache_stats",
        "clear_cache",
    ] {
        let id = client.next_id;
        client.next_id += 1;
        let response = client
            .raw_request(json!({
                "jsonrpc": "2.0", "id": id, "method": "tools/call",
                "params": {"name": name, "arguments": {"root": "/repo"}}
            }))
            .await?;
        assert_eq!(
            response["error"]["message"], "tool not found",
            "{name} must not execute"
        );
    }
    client.shutdown().await;
    Ok(())
}

#[tokio::test]
async fn tools_call_reports_is_error_on_missing_root() -> anyhow::Result<()> {
    let (mut client, _) = McpClient::connect().await?;
    let result = client
        .next_call(
            "tools/call",
            json!({ "name": "analyze_repository", "arguments": {} }),
        )
        .await?;
    client.shutdown().await;

    // Missing argument -> the tool errors with isError true rather than failing
    // the JSON-RPC layer.
    assert_eq!(result.get("isError").and_then(Value::as_bool), Some(true));
    Ok(())
}

#[tokio::test]
async fn resources_lists_analysis_and_graph_templates() -> anyhow::Result<()> {
    let (mut client, _) = McpClient::connect().await?;
    let result = client
        .next_call("resources/templates/list", json!({}))
        .await?;
    client.shutdown().await;

    let uris = resource_template_uris(&result);
    assert_eq!(
        uris,
        BTreeSet::from([
            "finn://analysis/{root}".to_string(),
            "finn://graph/{root}".to_string(),
        ])
    );
    Ok(())
}

#[tokio::test]
async fn guidance_describes_trueforge_context_support() -> anyhow::Result<()> {
    let (mut client, initialized) = McpClient::connect().await?;
    let instructions = initialized["instructions"].as_str().expect("instructions");
    assert!(instructions.contains("TrueForge"));
    assert!(!instructions.contains("schedule_agents"));
    assert!(!instructions.contains("generate_report"));
    assert!(!instructions.contains("docs/context-strategy.md"));
    let prompt = client.next_call("prompts/get", json!({
        "name": "prepare_context", "arguments": {"root": "/repo", "task": "auth flow", "max_tokens": "3000"}
    })).await?;
    let text = prompt.to_string();
    assert!(text.contains("TrueForge"));
    assert!(text.contains("does not execute"));
    assert!(text.contains("3000"));
    assert!(text.contains("auth flow"));
    client.shutdown().await;
    Ok(())
}

#[test]
fn readme_documents_only_implemented_context_support() {
    let readme = include_str!("../README.md");
    assert!(readme.contains("TrueForge"));
    assert!(readme.contains("prepare_context"));
    for obsolete in [
        "IBM Bob",
        "finn-ibm",
        "schedule_agents",
        "advance_agents",
        "generate_report",
        "get_cache_stats",
        "FINN_API_TOKEN",
        "docs/context-strategy.md",
        "run-mcp-inspector.bat",
    ] {
        assert!(!readme.contains(obsolete), "outdated claim: {obsolete}");
    }
}

#[tokio::test]
async fn prompts_list_exposes_prepare_context() -> anyhow::Result<()> {
    let (mut client, _) = McpClient::connect().await?;
    let result = client.next_call("prompts/list", json!({})).await?;
    client.shutdown().await;

    let names = result
        .get("prompts")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|p| p.get("name").and_then(Value::as_str).map(String::from))
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    assert_eq!(names, BTreeSet::from(["prepare_context".to_string()]));
    Ok(())
}

#[tokio::test]
async fn resources_read_analyzes_a_real_repository() -> anyhow::Result<()> {
    let (mut client, _) = McpClient::connect().await?;
    let root = std::env::var("CARGO_MANIFEST_DIR")?;
    let result = client
        .next_call(
            "resources/read",
            json!({ "uri": format!("finn://analysis/{root}") }),
        )
        .await?;
    client.shutdown().await;

    let contents = result
        .get("contents")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .expect("resource text");
    let document: Value = serde_json::from_str(contents)?;
    assert!(document.get("analysis").is_some() || document.get("summary").is_some());
    Ok(())
}

#[tokio::test]
async fn resources_read_rejects_unknown_uri() -> anyhow::Result<()> {
    let (mut client, _) = McpClient::connect().await?;
    let id = client.next_id;
    client.next_id += 1;
    let response = client
        .raw_request(json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "resources/read",
            "params": { "uri": "finn://bogus/whatever" },
        }))
        .await?;
    client.shutdown().await;
    assert!(response.get("error").is_some(), "expected JSON-RPC error");
    Ok(())
}
