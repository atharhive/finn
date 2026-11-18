import { expect, it, vi } from 'vitest';
const host = vi.hoisted(() => ({ commands: new Map<string, (...args: any[]) => unknown>(), views: new Map<string, any>(), content: new Map<string, any>(), trusted: false }));
vi.mock('vscode', () => ({
  workspace: { get isTrusted() { return host.trusted; }, workspaceFolders: [{uri:{scheme:'file',fsPath:'/workspace'},name:'workspace'}], getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }), registerTextDocumentContentProvider: (scheme: string, provider: any) => {host.content.set(scheme,provider); return {dispose:vi.fn()};}, onDidChangeConfiguration: () => ({dispose:vi.fn()}), onDidGrantWorkspaceTrust: () => ({dispose:vi.fn()}), onDidChangeWorkspaceFolders: () => ({dispose:vi.fn()}), textDocuments: [] },
  window: { registerWebviewViewProvider: (id: string, provider: any) => {host.views.set(id,provider);return {dispose:vi.fn()};}, showErrorMessage:vi.fn(), showWarningMessage:vi.fn(), showInformationMessage:vi.fn(), activeTextEditor:undefined },
  commands: { registerCommand: (id: string, callback: (...args:any[]) => unknown) => {host.commands.set(id,callback);return {dispose:vi.fn()};}, executeCommand:vi.fn(async()=>{}) },
  Uri:{parse:vi.fn()},
}));
import { activate, deactivate } from '../../src/extension/index.js';

it('registers the declared commands and publishes an explicit workspace trust gate', async () => {
  activate({subscriptions:[],extensionPath:'/extension'} as any);
  for(const command of ['finn.openAgent','finn.inlineEdit','finn.cancel','finn.undo','finn.restart']) expect(host.commands.has(command)).toBe(true);
  expect(host.content.has('finn-preview')).toBe(true);
  const messages: any[] = [];
  let receive!: (message: unknown) => void;
  const view = {webview:{options:{},html:'',postMessage:vi.fn((message:unknown)=>{messages.push(message);return Promise.resolve(true);}),onDidReceiveMessage:vi.fn(callback=>{receive=callback;return{dispose:vi.fn()};})},onDidDispose:vi.fn(()=>({dispose:vi.fn()})),show:vi.fn()};
  host.views.get('finn.agent').resolveWebviewView(view);
  await receive({type:'ready'});
  expect(messages.at(-1).state.ready).toBe(false);
  expect(messages.at(-1).state.status).toMatch(/trust/i);
  expect(view.webview.html).toContain("default-src 'none'");
  await receive({type:'run',prompt:'Do not run'});
  expect(messages.at(-1).state.busy).toBe(false);
  await deactivate();
});
