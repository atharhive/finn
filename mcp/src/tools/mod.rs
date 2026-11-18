//! Tool definitions: one file per tool, plus the assembled router.
//!
//! Each `#[tool]` handler lives in its own file with its `Parameters` struct.
//! The `#[tool]` macro emits a `pub fn <name>_tool_attr()` metadata function
//! next to each handler; `tool_router()` assembles them into a single
//! [`ToolRouter`].

pub mod agents;
pub mod analyze;
pub mod cache;
pub mod graph;
pub mod optimize;
pub mod report;

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
        .with_route((
            FinnServer::schedule_agents_tool_attr(),
            FinnServer::schedule_agents,
        ))
        .with_route((FinnServer::list_agents_tool_attr(), FinnServer::list_agents))
        .with_route((
            FinnServer::advance_agents_tool_attr(),
            FinnServer::advance_agents,
        ))
        .with_route((
            FinnServer::get_cache_stats_tool_attr(),
            FinnServer::get_cache_stats,
        ))
        .with_route((FinnServer::clear_cache_tool_attr(), FinnServer::clear_cache))
        .with_route((
            FinnServer::generate_report_tool_attr(),
            FinnServer::generate_report,
        ))
}
