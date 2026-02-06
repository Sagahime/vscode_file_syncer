import * as vscode from 'vscode';
import { SyncManager } from './syncManager';
import { ProfileManager } from '../config/profileManager';

export class SyncScheduler {
  private static instance: SyncScheduler;
  private syncManager: SyncManager;
  private profileManager: ProfileManager;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isAutoUploadEnabled: boolean = false;

  private constructor() {
    this.syncManager = SyncManager.getInstance();
    this.profileManager = ProfileManager.getInstance();
    this.setupConfigWatcher();
    this.isAutoUploadEnabled = this.getAutoUploadConfig();
  }

  static getInstance(): SyncScheduler {
    if (!SyncScheduler.instance) {
      SyncScheduler.instance = new SyncScheduler();
    }
    return SyncScheduler.instance;
  }

  private setupConfigWatcher(): void {
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('filesyncer.autoUpload')) {
        this.isAutoUploadEnabled = this.getAutoUploadConfig();
      }
    });
  }

  private getAutoUploadConfig(): boolean {
    return vscode.workspace.getConfiguration('filesyncer').get<boolean>('autoUpload', false);
  }

  scheduleUpload(document: vscode.TextDocument): void {
    if (!this.isAutoUploadEnabled) {
      return;
    }

    if (!this.shouldAutoUpload(document)) {
      return;
    }

    const activeProfile = this.profileManager.getActiveProfile();
    if (!activeProfile) {
      return;
    }

    const delay = vscode.workspace.getConfiguration('filesyncer').get<number>('autoUploadDelay', 1000);
    const filePath = document.uri.fsPath;

    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      try {
        await this.syncManager.uploadFile(filePath);
        this.debounceTimers.delete(filePath);
      } catch (error) {
        console.error('Auto-upload failed:', error);
      }
    }, delay);

    this.debounceTimers.set(filePath, timer);
  }

  private shouldAutoUpload(document: vscode.TextDocument): boolean {
    if (document.uri.scheme !== 'file') {
      return false;
    }

    const activeProfile = this.profileManager.getActiveProfile();
    if (!activeProfile) {
      return false;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return false;
    }

    const filePath = document.uri.fsPath;
    if (!filePath.startsWith(workspaceFolder.uri.fsPath)) {
      return false;
    }

    const relativePath = filePath.substring(workspaceFolder.uri.fsPath.length + 1);

    return !this.shouldExclude(relativePath, activeProfile.exclude);
  }

  private shouldExclude(filePath: string, excludePatterns: string[]): boolean {
    const minimatch = require('minimatch');
    for (const pattern of excludePatterns) {
      if (minimatch(filePath, pattern) || minimatch(filePath, pattern, { dot: true })) {
        return true;
      }
    }
    return false;
  }

  cancelScheduledUpload(filePath: string): void {
    const timer = this.debounceTimers.get(filePath);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(filePath);
    }
  }

  cancelAllScheduledUploads(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  dispose(): void {
    this.cancelAllScheduledUploads();
  }
}
