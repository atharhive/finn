//! Prompt templates: one file per prompt, plus the assembled router.
//!
//! Each `#[prompt]` handler lives in its own file with its arguments struct.
//! The `#[prompt]` macro emits a `pub fn <name>_prompt_attr()` metadata
//! function next to each handler; `prompt_router()` assembles them into a
//! single [`PromptRouter`].

pub mod prepare_context;

use rmcp::handler::server::router::prompt::PromptRouter;

use crate::handler::FinnServer;

/// Assemble the router that registers every Finn prompt.
pub fn prompt_router() -> PromptRouter<FinnServer> {
    PromptRouter::new().with_route((
        FinnServer::prepare_context_prompt_attr(),
        FinnServer::prepare_context,
    ))
}
