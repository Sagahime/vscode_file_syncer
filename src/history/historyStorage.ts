import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface HistoryEntry {
  id: string;
  timestamp: number;
  operation: 'upload' | 'download';
  localPath: string;
  remotePath: string;
  profileName: string;
  fileSize: number;
  hash: string;
}

export interface HistoryIndex {
  entries: HistoryEntry[];
}

export class HistoryStorage {
  private static instance: HistoryStorage;
  private historyDir: string;
  private indexPath: string;
  private index: HistoryIndex;

  private constructor() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder');
    }
    this.historyDir = path.join(workspaceFolder.uri.fsPath, '.vscode', 'filesyncer', 'history');
    this.indexPath = path.join(this.historyDir, 'index.json');
    this.index = this.loadIndex();
    this.ensureHistoryDir();
  }

  static getInstance(): HistoryStorage {
    if (!HistoryStorage.instance) {
      HistoryStorage.instance = new HistoryStorage();
    }
    return HistoryStorage.instance;
  }

  private ensureHistoryDir(): void {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  private loadIndex(): HistoryIndex {
    try {
      if (fs.existsSync(this.indexPath)) {
        const content = fs.readFileSync(this.indexPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('Failed to load history index:', error);
    }
    return { entries: [] };
  }

  private saveIndex(): void {
    try {
      fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
    } catch (error) {
      console.error('Failed to save history index:', error);
    }
  }

  private computeHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  private getVersionDir(entry: HistoryEntry): string {
    const date = new Date(entry.timestamp);
    const dateStr = date.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    return path.join(this.historyDir, `${dateStr}_${entry.profileName}`);
  }

  async addEntry(entry: HistoryEntry): Promise<void> {
    this.index.entries.push(entry);
    this.saveIndex();
    await this.cleanupOldEntries();
  }

  async backupFile(localPath: string, entry: HistoryEntry): Promise<string> {
    const versionDir = this.getVersionDir(entry);
    if (!fs.existsSync(versionDir)) {
      fs.mkdirSync(versionDir, { recursive: true });
    }

    const fileName = path.basename(localPath);
    const versionSuffix = this.generateVersionSuffix(localPath, entry);
    const backupPath = path.join(versionDir, `${fileName}_v${versionSuffix}`);

    if (fs.existsSync(localPath)) {
      fs.copyFileSync(localPath, backupPath);
      entry.hash = this.computeHash(localPath);
      entry.fileSize = fs.statSync(localPath).size;
    }

    return backupPath;
  }

  private generateVersionSuffix(localPath: string, entry: HistoryEntry): string {
    const existingEntries = this.index.entries.filter(e =>
      e.localPath === localPath &&
      e.operation === entry.operation &&
      e.profileName === entry.profileName
    );
    return String(existingEntries.length + 1);
  }

  getHistoryForFile(localPath: string): HistoryEntry[] {
    return this.index.entries
      .filter(e => e.localPath === localPath)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async getBackupPath(entry: HistoryEntry): Promise<string | undefined> {
    const versionDir = this.getVersionDir(entry);
    const fileName = path.basename(entry.localPath);

    const files = fs.readdirSync(versionDir);
    const backupFile = files.find(f => f.startsWith(fileName) && f.includes('_v'));

    if (backupFile) {
      return path.join(versionDir, backupFile);
    }

    return undefined;
  }

  private async cleanupOldEntries(): Promise<void> {
    const maxVersions = vscode.workspace.getConfiguration('filesyncer').get<number>('maxHistoryVersions', 10);
    const maxAgeDays = vscode.workspace.getConfiguration('filesyncer').get<number>('historyMaxAgeDays', 30);
    const now = Date.now();
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;

    const entriesByFile = new Map<string, HistoryEntry[]>();
    for (const entry of this.index.entries) {
      const entries = entriesByFile.get(entry.localPath) || [];
      entries.push(entry);
      entriesByFile.set(entry.localPath, entries);
    }

    const entriesToDelete: HistoryEntry[] = [];

    for (const [localPath, entries] of entriesByFile.entries()) {
      entries.sort((a, b) => b.timestamp - a.timestamp);

      if (entries.length > maxVersions) {
        entriesToDelete.push(...entries.slice(maxVersions));
      }

      for (const entry of entries) {
        if (now - entry.timestamp > maxAge) {
          entriesToDelete.push(entry);
        }
      }
    }

    for (const entry of entriesToDelete) {
      await this.deleteEntry(entry);
    }
  }

  private async deleteEntry(entry: HistoryEntry): Promise<void> {
    const versionDir = this.getVersionDir(entry);
    const fileName = path.basename(entry.localPath);

    try {
      const files = fs.readdirSync(versionDir);
      const backupFile = files.find(f => f.startsWith(fileName) && f.includes('_v'));

      if (backupFile) {
        const backupPath = path.join(versionDir, backupFile);
        fs.unlinkSync(backupPath);
      }

      const remainingFiles = fs.readdirSync(versionDir);
      if (remainingFiles.length === 0) {
        fs.rmdirSync(versionDir);
      }
    } catch (error) {
      console.error('Failed to delete backup:', error);
    }

    this.index.entries = this.index.entries.filter(e => e.id !== entry.id);
    this.saveIndex();
  }

  getAllEntries(): HistoryEntry[] {
    return [...this.index.entries].sort((a, b) => b.timestamp - a.timestamp);
  }

  clearHistory(): void {
    try {
      const files = fs.readdirSync(this.historyDir);
      for (const file of files) {
        const filePath = path.join(this.historyDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else if (file !== 'index.json') {
          fs.unlinkSync(filePath);
        }
      }
      this.index = { entries: [] };
      this.saveIndex();
    } catch (error) {
      console.error('Failed to clear history:', error);
    }
  }

  dispose(): void {
    this.saveIndex();
  }
}
