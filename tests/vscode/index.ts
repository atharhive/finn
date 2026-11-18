import * as vscode from 'vscode';
import assert from 'node:assert/strict';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('atharhive.finn-agent');
  assert.ok(extension, 'Finn extension must be installed in the development host');
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const command of ['finn.openAgent', 'finn.inlineEdit', 'finn.cancel', 'finn.undo', 'finn.restart']) {
    assert.ok(commands.includes(command), `Missing native command: ${command}`);
  }
  const settings = vscode.workspace.getConfiguration('finn');
  assert.equal(settings.get('trueforgeUrl'), 'http://127.0.0.1:8790');
  assert.equal(settings.get('model'), '');
  await vscode.commands.executeCommand('finn.openAgent');
  console.log('Finn VS Code host smoke: activation, five commands, setup defaults and native view passed.');
}
