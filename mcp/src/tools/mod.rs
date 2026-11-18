//! Tool definitions: one file per tool, plus the assembled router.
//!
//! Each `#[tool]` handler lives in its own file with its `Parameters` struct.
//! The `#[tool]` macro emits a `pub fn <name>_tool_attr()` metadata function
//! next to each handler; `tool_router()` assembles them into a single
//! [`ToolRouter`].

pub mod analyze;
pub mod graph;
pub mod optimize;

use rmcp::handler::server::router::tool::ToolRouter;

use crate::handler::FinnServer;

/// Assemble the router that registers every Finn tool.
pub fn tool_router() -> ToolRouter<FinnServer> {
    ToolRouter::new()
        .with_route((
            FinnServer::analyze_repository_tool_attr(),
            FinnServer::analyze_repository,
        ))
        .with_route((
            FinnServer::build_dependency_graph_tool_attr(),
            FinnServer::build_dependency_graph,
        ))
        .with_route((
            FinnServer::optimize_context_tool_attr(),
            FinnServer::optimize_context,
        ))
}
