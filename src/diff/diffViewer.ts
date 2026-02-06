import * as vscode from 'vscode';
import { SFTPManager } from '../sftp/sftpManager';
import { FileComparator } from '../utils/fileComparator';

export class DiffViewer {
  private sftpManager: SFTPManager;
  private fileComparator: FileComparator;

  constructor() {
    this.sftpManager = SFTPManager.getInstance();
    this.fileComparator = new FileComparator();
  }

  async showDiff(localPath: string, remotePath: string): Promise<void> {
    try {
      const client = await this.sftpManager.ensureConnected();
      const tempPath = `/tmp/filesyncer_diff_${Date.now()}`;

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Comparing files...',
        cancellable: false
      }, async () => {
        await client.getFile(remotePath, tempPath);
      });

      const localUri = vscode.Uri.file(localPath);
      const remoteUri = vscode.Uri.file(tempPath);

      await vscode.commands.executeCommand(
        'vscode.diff',
        localUri,
        remoteUri,
        `${localPath} (Local) ↔ ${remotePath} (Remote)`,
        {
          preview: true,
          preserveFocus: true
        }
      );

      const disposable = vscode.workspace.onDidCloseTextDocument(doc => {
        if (doc.uri.fsPath === tempPath) {
          const fs = require('fs');
          try {
            fs.unlinkSync(tempPath);
          } catch (e) {
            console.error('Failed to delete temp file:', e);
          }
          disposable.dispose();
        }
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to compare files: ${error}`);
      throw error;
    }
  }

  async compareInline(localPath: string, remotePath: string): Promise<void> {
    const diff = await this.fileComparator.getFileDiff(localPath, remotePath);

    const diffContent = this.generateInlineDiff(diff.localLines, diff.remoteLines);

    const doc = await vscode.workspace.openTextDocument({
      language: 'diff',
      content: diffContent
    });

    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside
    });
  }

  private generateInlineDiff(localLines: string[], remoteLines: string[]): string {
    const lines: string[] = [];
    const maxLines = Math.max(localLines.length, remoteLines.length);

    for (let i = 0; i < maxLines; i++) {
      const localLine = localLines[i] ?? '';
      const remoteLine = remoteLines[i] ?? '';

      if (localLine === remoteLine) {
        lines.push(` ${localLine}`);
      } else {
        if (localLine) {
          lines.push(`-${localLine}`);
        }
        if (remoteLine) {
          lines.push(`+${remoteLine}`);
        }
      }
    }

    return lines.join('\n');
  }
}
