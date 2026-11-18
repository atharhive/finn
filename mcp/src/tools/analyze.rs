//! `analyze_repository` — Repository Intelligence JSON for a repository.

use rmcp::schemars::JsonSchema;
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock, ErrorData},
    service::RequestContext,
    tool, RoleServer,
};
use serde::Deserialize;

use crate::engine::run_analysis;
use crate::handler::FinnServer;
use crate::reporting::Reporter;

/// Arguments for `analyze_repository`.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct AnalyzeParams {
    /// Absolute path of the repository to analyze.
    #[schemars(description = "Absolute path of the repository to analyze")]
    pub root: String,
}

impl FinnServer {
    /// Analyze a repository with Repository Intelligence.
    #[tool(
        description = "Analyze a repository and return the Repository Intelligence JSON document"
    )]
    pub async fn analyze_repository(
        &self,
        Parameters(args): Parameters<AnalyzeParams>,
        _ctx: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let result = run_analysis(&args.root);
        match result {
            Ok(json) => {
                Reporter::from_env().record("analyze_repository", &json);
                Ok(CallToolResult::success(vec![ContentBlock::text(json)]))
            }
            Err(message) => {
                let report = format!("[error] {message}");
                Reporter::from_env().record("analyze_repository", &report);
                Ok(CallToolResult::error(vec![ContentBlock::text(report)]))
            }
        }
    }
}
