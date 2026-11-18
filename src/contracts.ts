export interface SelectionContext {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface AgentEvent {
  type: 'text' | 'status' | 'tool' | 'context' | 'error' | 'session' | 'done';
  text?: string;
  sessionId?: string;
  data?: unknown;
}

export interface AgentConfig {
  baseUrl: string;
  model: string;
  fallbackModel?: string;
  mcpUrl: string;
  mcpToken: string;
  workspaceRoot: string;
  requestTimeoutMs?: number;
  maxRetries?: number;
}

export interface AgentRunOptions {
  prompt: string;
  mode: 'agent' | 'inline';
  selection?: SelectionContext;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

export interface ContextRequest {
  query: string;
  maxTokens: number;
  mentions?: string[];
  signal?: AbortSignal;
}

export interface ContextFile {
  path: string;
  content: string;
  tokens: number;
  reasons: string[];
}

export interface ContextBundle {
  files: ContextFile[];
  tokens: number;
  budget: number;
  strategy: string;
  warnings: string[];
}

export interface CommandRequest {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}
