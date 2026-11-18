export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

/** Static shell. All remote, model and workspace strings enter via textContent. */
export function renderWebview(nonce: string): string {
  const safeNonce = escapeHtml(nonce);
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${safeNonce}'; script-src 'nonce-${safeNonce}'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
<title>Finn</title><style nonce="${safeNonce}">
:root{--accent:var(--vscode-terminal-ansiCyan,#70c9bd);--line:var(--vscode-panel-border);--muted:var(--vscode-descriptionForeground);--surface:var(--vscode-sideBar-background);--focus:var(--vscode-focusBorder)}
*{box-sizing:border-box}body{margin:0;background:var(--vscode-editor-background);color:var(--vscode-foreground);font:var(--vscode-font-size)/1.55 var(--vscode-font-family);padding:20px}header{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:14px}h1{font-size:18px;letter-spacing:-.5px;margin:0}h1 span{color:var(--accent)}h2{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:20px 0 9px}.eyebrow{font-size:10px;letter-spacing:.08em;color:var(--muted);text-transform:uppercase}.intro{margin:24px 0}.intro strong{font-size:20px;line-height:1.3;display:block;letter-spacing:-.4px}.intro p{color:var(--muted);margin:9px 0 0;max-width:52ch}button,textarea{font:inherit}button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:5px 10px;cursor:pointer;border-radius:3px}button:hover{background:var(--vscode-button-secondaryHoverBackground)}button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}button.primary:hover{background:var(--vscode-button-hoverBackground)}button:disabled{opacity:.5;cursor:default}:focus-visible{outline:2px solid var(--focus);outline-offset:2px}textarea{display:block;width:100%;min-height:96px;max-height:360px;resize:vertical;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--line));border-radius:3px;padding:10px}label{display:block;margin-bottom:7px}form{margin-top:20px}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.hint{color:var(--muted);font-size:11px;margin-top:8px}#status{padding:10px 0;color:var(--accent);border-bottom:1px solid var(--line)}#error{color:var(--vscode-errorForeground);white-space:pre-wrap;overflow-wrap:anywhere}.entry{border-left:2px solid var(--line);padding:4px 0 4px 12px;margin:12px 0}.entry.user{border-color:var(--accent)}.entry .kind{font-size:10px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em}.body,pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0;font-family:var(--vscode-editor-font-family);font-size:var(--vscode-editor-font-size,12px)}.proposal{border-top:1px solid var(--line);padding:12px 0}.path{font-family:var(--vscode-editor-font-family);overflow-wrap:anywhere}.hunk{background:var(--surface);padding:10px;margin:9px 0}.context-file{margin:8px 0}.meta{font-size:11px;color:var(--muted)}details{border-bottom:1px solid var(--line);padding:10px 0}summary{cursor:pointer;color:var(--muted)}[hidden]{display:none!important}@media(max-width:360px){body{padding:12px}.intro strong{font-size:18px}}
</style></head><body>
<header><div><h1><span>f</span>inn</h1><div class="eyebrow">Workspace agent</div></div><button id="settings" title="Open Finn settings">Settings</button></header>
<section class="intro" id="intro"><strong>Make the change.<br>Keep the last word.</strong><p>Ask about your workspace or propose a change. Review each hunk before anything is written.</p></section>
<div id="status" role="status" aria-live="polite">Connecting to workspace...</div><p id="error" role="alert" hidden></p>
<details id="context"><summary id="context-summary">Context not assembled yet</summary><div id="context-files"></div></details>
<section id="transcript" aria-label="Conversation" aria-live="polite" aria-relevant="additions text"></section>
<section aria-label="Proposed changes"><h2>Review queue</h2><p id="empty" class="meta">No pending changes. Model edits appear here for your review.</p><div id="proposals"></div><button id="undo">Undo last accepted change</button></section>
<form id="composer"><label for="prompt">What should Finn work on?</label><textarea id="prompt" maxlength="32000" placeholder="Describe a change, ask a question, or mention @path/to/file" required></textarea><div class="actions"><button class="primary" id="send" type="submit">Send to agent</button><button id="cancel" type="button" disabled>Stop</button></div><div class="hint">Ctrl/⌘ + Enter to send. Select code and use Finn: Edit Selection for a scoped edit.</div></form>
<script nonce="${safeNonce}">
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const emit = message => vscode.postMessage(message);
const node = (tag, text, className) => { const item = document.createElement(tag); if(text !== undefined) item.textContent = text; if(className) item.className = className; return item; };
let busy = false;
function button(label, type, proposalId, hunkId, disabled) { const item = node('button', label); item.type = 'button'; item.disabled = disabled; item.addEventListener('click', () => emit({type, proposalId, hunkId})); return item; }
function render(state) {
  busy = state.busy;
  byId('status').textContent = state.status;
  byId('error').textContent = state.error || ''; byId('error').hidden = !state.error;
  byId('send').disabled = busy || !state.ready; byId('cancel').disabled = !busy; byId('undo').disabled = busy || !state.ready;
  byId('intro').hidden = state.entries.length > 0;
  const transcript = byId('transcript'); transcript.replaceChildren();
  for(const entry of state.entries) { const item = node('article', undefined, 'entry ' + entry.kind); item.append(node('div', entry.kind, 'kind'), node('div', entry.text, 'body')); transcript.append(item); }
  const proposals = byId('proposals'); proposals.replaceChildren(); byId('empty').hidden = state.proposals.length > 0;
  for(const proposal of state.proposals) { const section = node('article', undefined, 'proposal'); section.append(node('div', proposal.path, 'path'), node('div', proposal.status, 'meta'));
    for(const hunk of proposal.hunks) { const item = node('div', undefined, 'hunk'); item.append(node('pre', hunk.diff)); const actions = node('div', undefined, 'actions'); actions.append(button('Preview diff', 'preview', proposal.id, hunk.id, false), button('Accept hunk', 'accept', proposal.id, hunk.id, busy || hunk.status !== 'pending'), button('Reject hunk', 'reject', proposal.id, hunk.id, busy || hunk.status !== 'pending')); item.append(node('div', hunk.status, 'meta'), actions); section.append(item); } proposals.append(section); }
  const files = byId('context-files'); files.replaceChildren();
  if(state.context) { byId('context-summary').textContent = 'Context: ' + state.context.tokens + ' / ' + state.context.budget + ' tokens · ' + state.context.strategy;
    for(const file of state.context.files) { const item = node('div', undefined, 'context-file'); item.append(node('div', file.path, 'path'), node('div', file.tokens + ' tokens · ' + file.reasons.join(', '), 'meta')); files.append(item); }
    for(const warning of state.context.warnings) files.append(node('p', warning, 'meta'));
  } else { byId('context-summary').textContent = 'Context not assembled yet'; }
}
byId('composer').addEventListener('submit', event => { event.preventDefault(); const prompt = byId('prompt').value.trim(); if(!busy && prompt) { emit({type:'run',prompt}); byId('prompt').value = ''; } });
byId('prompt').addEventListener('keydown', event => { if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault(); byId('composer').requestSubmit();} });
for(const type of ['cancel','undo','settings']) byId(type).addEventListener('click', () => emit({type}));
window.addEventListener('message', event => { if(event.data && event.data.type === 'state') render(event.data.state); });
emit({type:'ready'});
</script></body></html>`;
}
