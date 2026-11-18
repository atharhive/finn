//! The MCP server handler: `FinnServer` type and its `ServerHandler` impl.
//!
//! `FinnServer` is the unit struct that owns the MCP surface. Its tools live in
//! `crate::tools` (router: [`crate::tools::tool_router`]), its prompts in
//! `crate::prompts` (router: [`crate::prompts::prompt_router`]), and its
//! resources in `crate::resources`. This module defines the type, advertises
//! capabilities via `get_info`, implements the resource endpoints, and wires
//! the tool/prompt routers into the `ServerHandler` trait via
//! `#[tool_handler]` / `#[prompt_handler]`.

use rmcp::{
    model::{
        ErrorData, Implementation, ListResourceTemplatesResult, ListResourcesResult,
        PaginatedRequestParams, ReadResourceRequestParams, ReadResourceResult, ServerCapabilities,
        ServerInfo,
    },
    prompt_handler,
    service::RequestContext,
    tool_handler, RoleServer, ServerHandler,
};

/// Stateless repository-context support for TrueForge and other MCP clients.
#[derive(Clone)]
pub struct FinnServer;

impl FinnServer {
    /// Create a repository-context server without synthetic runtime state.
    pub fn new() -> Self {
        Self
    }
}

impl Default for FinnServer {
    fn default() -> Self {
        Self::new()
    }
}

#[tool_handler(router = crate::tools::tool_router())]
#[prompt_handler(router = crate::prompts::prompt_router())]
impl ServerHandler for FinnServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
        )
        .with_server_info(Implementation::new("finn", env!("CARGO_PKG_VERSION")))
        .with_instructions(
            "Finn supports TrueForge with read-only repository context over MCP.\n\
             Use analyze_repository to discover files, languages and entry points.\n\
             Use build_dependency_graph to inspect relationships, cycles and central files.\n\
             Use optimize_context with the task query and token budget to select context.\n\
             Results are heuristic context, not proof of correctness or completed work.\n\
             TrueForge owns planning, execution and verification; Finn does not execute\n\
             agents or track their progress. Each request analyzes the repository afresh.",
        )
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        Ok(crate::resources::list_resources())
    }

    async fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourceTemplatesResult, ErrorData> {
        Ok(crate::resources::list_resource_templates())
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResult, ErrorData> {
        crate::resources::read_resource(&request.uri, &context).await
    }
}
