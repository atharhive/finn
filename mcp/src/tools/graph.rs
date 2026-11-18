//! `build_dependency_graph` — dependency graph JSON for a repository.

use rmcp::schemars::JsonSchema;
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock, ErrorData},
    service::RequestContext,
    tool, RoleServer,
};
use serde::Deserialize;

use crate::engine::run_graph;
use crate::handler::FinnServer;
use crate::reporting::Reporter;

/// Arguments for `build_dependency_graph`.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct GraphParams {
    /// Absolute path of the repository to analyze.
    #[schemars(description = "Absolute path of the repository to analyze")]
    pub root: String,
}

impl FinnServer {
    /// Build the dependency graph of a repository.
    #[tool(
        description = "Build the dependency graph for a repository and return the graph JSON document"
    )]
    pub async fn build_dependency_graph(
        &self,
        Parameters(args): Parameters<GraphParams>,
        _ctx: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = run_graph(&args.root);
        match result {
            Ok(json) => {
                Reporter::from_env().record("build_dependency_graph", &json);
                Ok(CallToolResult::success(vec![ContentBlock::text(json)]))
            }
            Err(message) => {
                let report = format!("[error] {message}");
                Reporter::from_env().record("build_dependency_graph", &report);
                Ok(CallToolResult::error(vec![ContentBlock::text(report)]))
            }
        }
    }
}
