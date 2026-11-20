import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { CommandRequest, ContextBundle, ContextRequest } from '../contracts.js';
import { FinnController, type Backend, type ReviewProposal } from './controller.js';
import { renderWebview } from './view.js';
import { previewHunk, resolveSettings, selectionPath } from './host-utils.js';

let shutdown: (() => Promise<void>) | undefined;

export function activate(extension: vscode.ExtensionContext): void {
  let view: vscode.WebviewView | undefined;
  const previews = new Map<string, string>();
  const resources: vscode.Disposable[] = [];
  let closed = false;
  let controller: FinnController;
  const folder = () => vscode.workspace.workspaceFolders?.[0];
  const settings = () => {
    const config = vscode.workspace.getConfiguration('finn', folder()?.uri);
    return resolveSettings({
      trueforgeUrl: config.get('trueforgeUrl', 'http://127.0.0.1:8790'), model: config.get('model', ''),
      fallbackModel: config.get('fallbackModel', ''), contextBudget: config.get('contextBudget', 8000),
      turnTimeoutSeconds: config.get('turnTimeoutSeconds', 900),
      enginePath: config.get('enginePath', ''),
    });
  };
  const openSettings = async () => { await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:atharhive.finn-agent'); };
  const trust = () => { if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using Finn.'); };
  const report = (error: unknown) => { void vscode.window.showErrorMessage(`Finn: ${error instanceof Error ? error.message : 'Operation failed.'}`); };
  const approveCommand = async (request: CommandRequest): Promise<boolean> => {
    if (!vscode.workspace.isTrusted || closed || !controller.state.busy) return false;
    const approved = await vscode.window.showWarningMessage('Allow Finn to run this command?', {
      modal: true,
      detail: `Executable: ${request.command}\nArguments (exact array): ${JSON.stringify(request.args)}\nDirectory: ${request.cwd ?? '.'}\nCommands can modify files and access the network. Only approve commands you understand.`,
    }, 'Run command');
    return approved === 'Run command' && vscode.workspace.isTrusted && !closed && controller.state.busy;
  };
  const preview = async (proposal: ReviewProposal, hunkId: string) => {
    const id = randomUUID();
    const original = vscode.Uri.parse(`finn-preview:/${id}/original/${encodeURIComponent(basename(proposal.path))}`);
    const proposed = vscode.Uri.parse(`finn-preview:/${id}/proposed/${encodeURIComponent(basename(proposal.path))}`);
    previews.set(original.toString(), proposal.original);
    previews.set(proposed.toString(), previewHunk(proposal, hunkId));
    while (previews.size > 64) previews.delete(previews.keys().next().value!);
    await vscode.commands.executeCommand('vscode.diff', original, proposed, `Finn review: ${proposal.path}`, { preview: true });
  };
  const makeController = () => {
    const config = settings();
    const root = folder();
    const ready = vscode.workspace.isTrusted && root?.uri.scheme === 'file' && config.ready;
    const status = !vscode.workspace.isTrusted ? 'Trust this workspace before using Finn.' : !root ? 'Open a local workspace folder to use Finn.' : root.uri.scheme !== 'file' ? 'Finn requires a local filesystem workspace.' : config.status;
    return new FinnController({ ready, status, contextBudget: config.contextBudget, preview, settings: openSettings,
      changed: state => { if (view && !closed) void view.webview.postMessage({ type: 'state', state }); },
      start: async signal => {
        trust(); signal.throwIfAborted();
        if (!root || !ready) throw new Error(status);
        const [{ createContextProvider }, { createWorkspace }, { FinnAgent }] = await Promise.all([import('../context/index.js'), import('../workspace/index.js'), import('../agent/index.js')]);
        let binaryPath = config.binaryPath;
        if (!binaryPath) {
          const executable = process.platform === 'win32' ? 'finn_mcp.exe' : 'finn_mcp';
          const candidates = [join(extension.extensionPath, 'dist', 'bin', executable), join(extension.extensionPath, 'bin', `${process.platform}-${process.arch}`, executable), join(extension.extensionPath, 'bin', executable), join(extension.extensionPath, 'target', 'release', executable), join(extension.extensionPath, 'target', 'debug', executable)];
          for (const candidate of candidates) { try { await access(candidate); binaryPath = candidate; break; } catch { /* Try the next explicitly supported location. */ } }
        }
        signal.throwIfAborted();
        const context = await createContextProvider({root:root.uri.fsPath, binaryPath});
        let workspace: Awaited<ReturnType<typeof createWorkspace>> | undefined;
        try {
          signal.throwIfAborted();
          const assemble = async (request: ContextRequest): Promise<ContextBundle> => { trust(); return context.assemble(request); };
          workspace = await createWorkspace({root:root.uri.fsPath, onChange: () => controller.refreshProposals(), approveCommand, contextProvider: assemble});
          const mcp = await workspace.startMcpServer();
          signal.throwIfAborted();
          const agent = new FinnAgent({baseUrl:config.baseUrl, model:config.model, fallbackModel:config.fallbackModel, workspaceRoot:root.uri.fsPath, mcpUrl:mcp.url, mcpToken:mcp.token, requestTimeoutMs:config.requestTimeoutMs,maxRetries:2});
          const service = workspace;
          return { workspace:service, agent, assemble,
            dispose: async () => { try { await agent.dispose(); } finally { try { await service.dispose(); } finally { await context.dispose(); } } },
          } satisfies Backend;
        } catch (error) { try { await workspace?.dispose(); } finally { await context.dispose(); } throw error; }
      },
    });
  };
  controller = makeController();
  let restarting: Promise<void> | undefined;
  const restart = async () => {
    if (restarting) return restarting;
    restarting = (async () => { await controller.dispose(); previews.clear(); if (!closed) { controller = makeController(); controller.publish(); } })();
    try { await restarting; } finally { restarting = undefined; }
  };
  const handle = async (message: unknown) => {
    try {
      // A dirty editor buffer must never be overwritten behind VSCode's back.
      const value = message as {type?:string; proposalId?:string} | null;
      if (value?.type === 'accept' || value?.type === 'undo') {
        trust();
        if (vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() === folder()?.uri.toString())) throw new Error('Save or revert unsaved workspace files before accepting or undoing changes.');
      }
      await controller.handle(message);
    } catch (error) { report(error); }
  };
  resources.push(vscode.workspace.registerTextDocumentContentProvider('finn-preview', {provideTextDocumentContent: uri => previews.get(uri.toString()) ?? 'This Finn preview has expired.'}));
  resources.push(vscode.window.registerWebviewViewProvider('finn.agent', {
    resolveWebviewView(resolved) {
      view = resolved;
      resolved.webview.options = { enableScripts:true, localResourceRoots:[] };
      resolved.webview.html = renderWebview(randomBytes(24).toString('base64url'));
      resources.push(resolved.webview.onDidReceiveMessage(message => { void handle(message); }));
      resources.push(resolved.onDidDispose(() => { if (view === resolved) view = undefined; void controller.cancel().catch(report); }));
      controller.publish();
    },
  }));
  const register = (id: string, callback: () => unknown) => resources.push(vscode.commands.registerCommand(id, async () => { try { return await callback(); } catch (error) { report(error); } }));
  register('finn.openAgent', async () => { await vscode.commands.executeCommand('workbench.view.extension.finn'); await vscode.commands.executeCommand('finn.agent.focus'); view?.show?.(false); });
  register('finn.cancel', () => controller.cancel());
  register('finn.undo', () => handle({type:'undo'}));
  register('finn.restart', restart);
  register('finn.inlineEdit', async () => {
    trust();
    const editor = vscode.window.activeTextEditor;
    const root = folder();
    if (!root || !editor || editor.selection.isEmpty || editor.document.uri.scheme !== 'file') throw new Error('Select code in a file inside the first workspace folder.');
    if (!controller.state.ready) { await openSettings(); return; }
    if (controller.state.busy) throw new Error('Stop the current run before editing another selection.');
    const document = editor.document;
    const selection = editor.selection;
    const version = document.version;
    const path = await selectionPath(root.uri.fsPath, document.uri.fsPath);
    const prompt = await vscode.window.showInputBox({title:'Finn: Edit Selection',prompt:`Describe the change to ${path}`,placeHolder:'What should change in this selection?',ignoreFocusOut:true,validateInput:value => !value.trim() ? 'Describe the change.' : value.length > 32000 ? 'Instruction is too long.' : undefined});
    if (!prompt?.trim()) return;
    if (document.version !== version) throw new Error('The selected file changed. Select the code again and retry.');
    const text = document.getText(selection);
    if (text.length > 100000) throw new Error('Selection is too large. Select a smaller section of code.');
    await vscode.commands.executeCommand('finn.openAgent');
    await controller.run(prompt, {path,startLine:selection.start.line+1,endLine:selection.end.line+1,text});
  });
  resources.push(vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('finn')) void restart().catch(report); }));
  resources.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { void restart().catch(report); }));
  resources.push(vscode.workspace.onDidChangeWorkspaceFolders(() => { void restart().catch(report); }));
  shutdown = async () => { if (closed) return; closed = true; previews.clear(); resources.splice(0).forEach(resource => resource.dispose()); await controller.dispose(); };
  extension.subscriptions.push({dispose: () => { void shutdown?.().catch(report); }});
}

export async function deactivate(): Promise<void> { await shutdown?.(); shutdown = undefined; }
