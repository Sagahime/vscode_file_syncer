import * as vscode from 'vscode';
import * as fs from 'fs';
import { HistoryStorage, HistoryEntry } from './historyStorage';
import { ProfileManager } from '../config/profileManager';

export class HistoryManager {
  private static instance: HistoryManager;
  private storage: HistoryStorage;
  private profileManager: ProfileManager;
  private pendingBackups: Map<string, HistoryEntry> = new Map();

  private constructor() {
    this.storage = HistoryStorage.getInstance();
    this.profileManager = ProfileManager.getInstance();
  }

  static getInstance(): HistoryManager {
    if (!HistoryManager.instance) {
      HistoryManager.instance = new HistoryManager();
    }
    return HistoryManager.instance;
  }

  async recordBeforeUpload(localPath: string, remotePath: string): Promise<void> {
    const profile = this.profileManager.getActiveProfile();
    if (!profile) {
      return;
    }

    const entry: HistoryEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      operation: 'upload',
      localPath,
      remotePath,
      profileName: profile.name,
      fileSize: 0,
      hash: ''
    };

    if (fs.existsSync(localPath)) {
      await this.storage.backupFile(localPath, entry);
      this.pendingBackups.set(this.getBackupKey(localPath, remotePath, 'upload'), entry);
    }
  }

  async recordAfterUpload(localPath: string, remotePath: string): Promise<void> {
    const key = this.getBackupKey(localPath, remotePath, 'upload');
    const entry = this.pendingBackups.get(key);

    if (entry) {
      await this.storage.addEntry(entry);
      this.pendingBackups.delete(key);
    }
  }

  async recordBeforeDownload(localPath: string, remotePath: string): Promise<void> {
    const profile = this.profileManager.getActiveProfile();
    if (!profile) {
      return;
    }

    const entry: HistoryEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      operation: 'download',
      localPath,
      remotePath,
      profileName: profile.name,
      fileSize: 0,
      hash: ''
    };

    if (fs.existsSync(localPath)) {
      await this.storage.backupFile(localPath, entry);
      this.pendingBackups.set(this.getBackupKey(localPath, remotePath, 'download'), entry);
    }
  }

  async recordAfterDownload(localPath: string, remotePath: string): Promise<void> {
    const key = this.getBackupKey(localPath, remotePath, 'download');
    const entry = this.pendingBackups.get(key);

    if (entry) {
      await this.storage.addEntry(entry);
      this.pendingBackups.delete(key);
    }
  }

  getHistoryForFile(localPath: string): HistoryEntry[] {
    return this.storage.getHistoryForFile(localPath);
  }

  getAllHistory(): HistoryEntry[] {
    return this.storage.getAllEntries();
  }

  async restoreFromHistory(entry: HistoryEntry): Promise<void> {
    const backupPath = await this.storage.getBackupPath(entry);
    if (!backupPath || !fs.existsSync(backupPath)) {
      throw new Error('Backup file not found');
    }

    fs.copyFileSync(backupPath, entry.localPath);
    vscode.window.showInformationMessage(`Restored ${entry.localPath} to version from ${new Date(entry.timestamp).toLocaleString()}`);
  }

  showHistoryPanel(localPath?: string): void {
    const entries = localPath
      ? this.getHistoryForFile(localPath)
      : this.getAllHistory();

    if (entries.length === 0) {
      vscode.window.showInformationMessage(localPath
        ? 'No history found for this file'
        : 'No history found');
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'filesyncer.history',
      'File History',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    panel.webview.html = this.getHistoryWebviewContent(entries);
  }

  private getHistoryWebviewContent(entries: HistoryEntry[]): string {
    const items = entries.map(entry => `
      <div class="history-item">
        <div class="history-header">
          <span class="history-operation">${entry.operation}</span>
          <span class="history-date">${new Date(entry.timestamp).toLocaleString()}</span>
        </div>
        <div class="history-path">${entry.localPath}</div>
        <div class="history-remote">${entry.remotePath}</div>
        <div class="history-meta">
          <span>${entry.profileName}</span>
          <span>${this.formatFileSize(entry.fileSize)}</span>
        </div>
      </div>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>File History</title>
        <style>
          body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 10px;
          }
          .history-item {
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 10px;
            background: var(--vscode-editor-background);
          }
          .history-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
          }
          .history-operation {
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
          }
          .history-date {
            color: var(--vscode-descriptionForeground);
          }
          .history-path {
            font-family: var(--vscode-editor-font-family);
            margin: 5px 0;
          }
          .history-remote {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            margin: 5px 0;
          }
          .history-meta {
            display: flex;
            justify-content: space-between;
            color: var(--vscode-descriptionForeground);
            font-size: 0.85em;
            margin-top: 8px;
          }
        </style>
      </head>
      <body>
        <h2>File History (${entries.length} entries)</h2>
        ${items}
      </body>
      </html>
    `;
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private getBackupKey(localPath: string, remotePath: string, operation: string): string {
    return `${localPath}|${remotePath}|${operation}`;
  }

  clearHistory(): void {
    this.storage.clearHistory();
    vscode.window.showInformationMessage('History cleared');
  }

  dispose(): void {
    this.storage.dispose();
  }
}
