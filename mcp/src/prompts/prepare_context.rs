//! `prepare_context` — repository-context preparation prompt for TrueForge.

use rmcp::schemars::JsonSchema;
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{ErrorData, PromptMessage, Role},
    prompt,
};
use serde::Deserialize;

use crate::handler::FinnServer;

/// Arguments for the `prepare_context` prompt.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct PrepareContextArgs {
    /// Absolute path of the repository to operate on.
    #[schemars(description = "Absolute path of the repository to operate on")]
    pub root: String,
    /// The developer task to prepare context for.
    #[schemars(description = "The developer task to prepare context for")]
    pub task: String,
    /// Maximum total context bundle size in tokens.
    #[schemars(description = "Maximum total context bundle size in tokens")]
    pub max_tokens: Option<String>,
}

impl FinnServer {
    /// Prepare context for TrueForge without executing agent work.
    #[prompt(
        name = "prepare_context",
        description = "Prepare repository context for TrueForge: analyze files, inspect dependencies and select relevant context. This does not execute agents."
    )]
    pub async fn prepare_context(
        &self,
        Parameters(args): Parameters<PrepareContextArgs>,
    ) -> Result<Vec<PromptMessage>, ErrorData> {
        let mut messages = vec![
            PromptMessage::new_text(Role::User, "Finn supports TrueForge with repository context; it does not execute agents or verify task completion. Prepare context against the repository root, in order:"),
            PromptMessage::new_text(Role::User, format!(
                "1. Analyze the repository at `{}` with the `analyze_repository` tool.",
                args.root
            )),
            PromptMessage::new_text(Role::User, "2. Build the dependency graph with the `build_dependency_graph` tool."),
        ];
        if let Some(max_tokens) = args.max_tokens {
            messages.push(PromptMessage::new_text(
                Role::User,
                format!(
                    "3. Optimize context with the `optimize_context` tool (max_tokens = {max_tokens}) for this task: {}",
                    args.task
                ),
            ));
        } else {
            messages.push(PromptMessage::new_text(
                Role::User,
                format!(
                    "3. Optimize context with the `optimize_context` tool for this task: {}",
                    args.task
                ),
            ));
        }
        messages.push(PromptMessage::new_text(
            Role::User,
            "Return the context and its limitations to TrueForge for planning, execution and verification. Do not claim the task has been implemented or tested based on context analysis alone.",
        ));
        Ok(messages)
    }
}
