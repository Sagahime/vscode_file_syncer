import * as vscode from 'vscode';
import * as path from 'path';
import { HistoryManager } from './historyManager';
import { HistoryEntry } from './historyStorage';
import { DiffViewer } from '../diff/diffViewer';
import { SyncManager } from '../sync/syncManager';

export class RollbackManager {
  private static instance: RollbackManager;
  private historyManager: HistoryManager;
  private diffViewer: DiffViewer;
  private syncManager: SyncManager;

  private constructor() {
    this.historyManager = HistoryManager.getInstance();
    this.diffViewer = new DiffViewer();
    this.syncManager = SyncManager.getInstance();
  }

  static getInstance(): RollbackManager {
    if (!RollbackManager.instance) {
      RollbackManager.instance = new RollbackManager();
    }
    return RollbackManager.instance;
  }

  async rollbackFile(localPath: string): Promise<void> {
    const history = this.historyManager.getHistoryForFile(localPath);

    if (history.length === 0) {
      vscode.window.showInformationMessage('No history found for this file');
      return;
    }

    const items = history.map(entry => ({
      label: new Date(entry.timestamp).toLocaleString(),
      description: `${entry.operation} from ${entry.profileName}`,
      detail: `Remote: ${entry.remotePath}`,
      entry
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a version to rollback to',
      title: `Rollback ${path.basename(localPath)}`
    });

    if (!selected) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Rollback ${path.basename(localPath)} to version from ${selected.label}?`,
      { modal: true },
      'Rollback',
      'Preview',
      'Cancel'
    );

    if (confirm === 'Cancel' || !confirm) {
      return;
    }

    if (confirm === 'Preview') {
      await this.previewRollback(localPath, selected.entry);
      const previewConfirm = await vscode.window.showInformationMessage(
        'Preview complete. Do you want to proceed with rollback?',
        'Rollback',
        'Cancel'
      );
      if (previewConfirm !== 'Rollback') {
        return;
      }
    }

    try {
      await this.historyManager.restoreFromHistory(selected.entry);

      const upload = await vscode.window.showInformationMessage(
        'File rolled back successfully. Upload to remote server?',
        'Upload',
        'Skip'
      );

      if (upload === 'Upload') {
        await this.syncManager.uploadFile(localPath, selected.entry.remotePath);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Rollback failed: ${error}`);
    }
  }

  async rollbackBatch(localPaths: string[]): Promise<void> {
    if (localPaths.length === 0) {
      vscode.window.showInformationMessage('No files selected');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Rollback ${localPaths.length} files to their previous versions?`,
      { modal: true },
      'Rollback',
      'Cancel'
    );

    if (confirm !== 'Rollback') {
      return;
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Rolling back ${localPaths.length} files...`,
      cancellable: false
    }, async (progress) => {
      for (let i = 0; i < localPaths.length; i++) {
        const filePath = localPaths[i];
        const history = this.historyManager.getHistoryForFile(filePath);

        if (history.length > 0) {
          try {
            await this.historyManager.restoreFromHistory(history[0]);
            results.success++;
          } catch (error) {
            results.failed++;
            results.errors.push(`${filePath}: ${error}`);
          }
        }

        progress.report({ increment: (i / localPaths.length) * 100, message: path.basename(filePath) });
      }
    });

    if (results.failed > 0) {
      vscode.window.showWarningMessage(
        `Rollback completed: ${results.success} succeeded, ${results.failed} failed`,
        'View Errors'
      ).then(action => {
        if (action === 'View Errors') {
          this.showErrorPanel(results.errors);
        }
      });
    } else {
      vscode.window.showInformationMessage(`Successfully rolled back ${results.success} files`);
    }
  }

  private async previewRollback(localPath: string, entry: HistoryEntry): Promise<void> {
    const backupPath = await this.historyManager['storage'].getBackupPath(entry);
    if (!backupPath) {
      throw new Error('Backup file not found');
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      vscode.Uri.file(localPath),
      vscode.Uri.file(backupPath),
      `${path.basename(localPath)} (Current) ↔ ${path.basename(localPath)} (Version from ${new Date(entry.timestamp).toLocaleString()})`,
      {
        preview: true,
        preserveFocus: true
      }
    );
  }

  private showErrorPanel(errors: string[]): void {
    const panel = vscode.window.createWebviewPanel(
      'filesyncer.errors',
      'Rollback Errors',
      vscode.ViewColumn.Beside,
      {}
    );

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="errors">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Errors</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-errorForeground);
            background: var(--vscode-editor-background);
            padding: 10px;
          }
          .error-item {
            margin-bottom: 15px;
            padding: 10px;
            border-left: 3px solid var(--vscode-errorForeground);
            background: var(--vscode-editor-background);
          }
        </style>
      </head>
      <body>
        <h2>Rollback Errors (${errors.length})</h2>
        ${errors.map(err => `<div class="error-item">${err}</div>`).join('')}
      </body>
      </html>
    `;
  }

  async showHistoryAndRollback(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No file open');
      return;
    }

    const localPath = editor.document.uri.fsPath;
    const history = this.historyManager.getHistoryForFile(localPath);

    if (history.length === 0) {
      vscode.window.showInformationMessage('No history found for this file');
      return;
    }

    const items = history.map(entry => ({
      label: new Date(entry.timestamp).toLocaleString(),
      description: `${entry.operation} from ${entry.profileName}`,
      detail: `Size: ${entry.fileSize} bytes`,
      entry
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a version to view or rollback to',
      title: `History for ${path.basename(localPath)}`
    });

    if (!selected) {
      return;
    }

    const action = await vscode.window.showQuickPick(
      [
        { label: 'Rollback to this version', description: 'Restore file to this version' },
        { label: 'Compare with current', description: 'View differences' },
        { label: 'Cancel', description: 'Go back' }
      ],
      { placeHolder: 'What do you want to do?' }
    );

    if (!action || action.label === 'Cancel') {
      return;
    }

    if (action.label === 'Rollback to this version') {
      await this.rollbackFile(localPath);
    } else if (action.label === 'Compare with current') {
      await this.previewRollback(localPath, selected.entry);
    }
  }
}
