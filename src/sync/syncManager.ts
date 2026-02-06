import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SFTPManager } from '../sftp/sftpManager';
import { ProfileManager } from '../config/profileManager';
import { HistoryManager } from '../history/historyManager';

export type ConflictResolution = 'local' | 'remote' | 'rename';

export interface SyncResult {
  success: boolean;
  filesProcessed: number;
  errors: string[];
}

export class SyncManager {
  private static instance: SyncManager;
  private sftpManager: SFTPManager;
  private profileManager: ProfileManager;
  private historyManager: HistoryManager;

  private constructor() {
    this.sftpManager = SFTPManager.getInstance();
    this.profileManager = ProfileManager.getInstance();
    this.historyManager = HistoryManager.getInstance();
  }

  static getInstance(): SyncManager {
    if (!SyncManager.instance) {
      SyncManager.instance = new SyncManager();
    }
    return SyncManager.instance;
  }

  async uploadFile(localPath: string, remotePath?: string): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      filesProcessed: 0,
      errors: []
    };

    try {
      const activeProfile = this.profileManager.getActiveProfile();
      if (!activeProfile) {
        throw new Error('No active server profile');
      }

      const targetRemotePath = remotePath || this.getRemotePath(localPath, activeProfile.remotePath);
      const client = await this.sftpManager.ensureConnected();

      const confirmBeforeOverwrite = vscode.workspace.getConfiguration('filesyncer').get<boolean>('confirmBeforeOverwrite', true);

      if (confirmBeforeOverwrite && await client.exists(targetRemotePath)) {
        const choice = await vscode.window.showWarningMessage(
          `Remote file ${targetRemotePath} already exists. Overwrite?`,
          'Overwrite',
          'Cancel'
        );
        if (choice !== 'Overwrite') {
          return result;
        }
      }

      await this.historyManager.recordBeforeUpload(localPath, targetRemotePath);

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Uploading ${path.basename(localPath)}...`,
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0 });
        await client.putFile(localPath, targetRemotePath);
        progress.report({ increment: 100 });
        result.filesProcessed = 1;
      });

      await this.historyManager.recordAfterUpload(localPath, targetRemotePath);

      vscode.window.showInformationMessage(`Successfully uploaded ${path.basename(localPath)}`);
    } catch (error) {
      result.success = false;
      result.errors.push(String(error));
      vscode.window.showErrorMessage(`Failed to upload file: ${error}`);
    }

    return result;
  }

  async downloadFile(remotePath: string, localPath?: string): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      filesProcessed: 0,
      errors: []
    };

    try {
      const activeProfile = this.profileManager.getActiveProfile();
      if (!activeProfile) {
        throw new Error('No active server profile');
      }

      const targetLocalPath = localPath || this.getLocalPath(remotePath, activeProfile.remotePath);
      const client = await this.sftpManager.ensureConnected();

      const confirmBeforeOverwrite = vscode.workspace.getConfiguration('filesyncer').get<boolean>('confirmBeforeOverwrite', true);

      if (confirmBeforeOverwrite && fs.existsSync(targetLocalPath)) {
        const choice = await vscode.window.showWarningMessage(
          `Local file ${targetLocalPath} already exists. Overwrite?`,
          'Overwrite',
          'Cancel'
        );
        if (choice !== 'Overwrite') {
          return result;
        }
      }

      await this.historyManager.recordBeforeDownload(targetLocalPath, remotePath);

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Downloading ${path.basename(remotePath)}...`,
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0 });
        await client.getFile(remotePath, targetLocalPath);
        progress.report({ increment: 100 });
        result.filesProcessed = 1;
      });

      await this.historyManager.recordAfterDownload(targetLocalPath, remotePath);

      vscode.window.showInformationMessage(`Successfully downloaded ${path.basename(remotePath)}`);
    } catch (error) {
      result.success = false;
      result.errors.push(String(error));
      vscode.window.showErrorMessage(`Failed to download file: ${error}`);
    }

    return result;
  }

  async uploadFolder(localFolderPath: string, remotePath?: string): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      filesProcessed: 0,
      errors: []
    };

    try {
      const activeProfile = this.profileManager.getActiveProfile();
      if (!activeProfile) {
        throw new Error('No active server profile');
      }

      const targetRemotePath = remotePath || this.getRemotePath(localFolderPath, activeProfile.remotePath);
      const client = await this.sftpManager.ensureConnected();

      const files = this.getAllFiles(localFolderPath);
      const totalFiles = files.length;

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Uploading ${totalFiles} files...`,
        cancellable: true
      }, async (progress, token) => {
        for (let i = 0; i < files.length; i++) {
          if (token.isCancellationRequested) {
            throw new Error('Upload cancelled');
          }

          const file = files[i];
          const relativePath = path.relative(localFolderPath, file);
          const remoteFilePath = path.posix.join(targetRemotePath, relativePath.split(path.sep).join(path.posix.sep));

          try {
            await this.historyManager.recordBeforeUpload(file, remoteFilePath);
            await client.putFile(file, remoteFilePath);
            await this.historyManager.recordAfterUpload(file, remoteFilePath);
            result.filesProcessed++;
            progress.report({ increment: (i / totalFiles) * 100, message: `${path.basename(file)}` });
          } catch (error) {
            result.errors.push(`${file}: ${error}`);
          }
        }
      });

      if (result.errors.length > 0) {
        vscode.window.showWarningMessage(`Upload completed with ${result.errors.length} errors`);
      } else {
        vscode.window.showInformationMessage(`Successfully uploaded ${result.filesProcessed} files`);
      }
    } catch (error) {
      result.success = false;
      result.errors.push(String(error));
      vscode.window.showErrorMessage(`Failed to upload folder: ${error}`);
    }

    return result;
  }

  async downloadFolder(remoteFolderPath: string, localPath?: string): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      filesProcessed: 0,
      errors: []
    };

    try {
      const activeProfile = this.profileManager.getActiveProfile();
      if (!activeProfile) {
        throw new Error('No active server profile');
      }

      const targetLocalPath = localPath || this.getLocalPath(remoteFolderPath, activeProfile.remotePath);
      const client = await this.sftpManager.ensureConnected();

      const files = await this.getAllRemoteFiles(remoteFolderPath, client);
      const totalFiles = files.length;

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Downloading ${totalFiles} files...`,
        cancellable: true
      }, async (progress, token) => {
        for (let i = 0; i < files.length; i++) {
          if (token.isCancellationRequested) {
            throw new Error('Download cancelled');
          }

          const file = files[i];
          const relativePath = path.posix.relative(remoteFolderPath, file);
          const localFilePath = path.join(targetLocalPath, relativePath.split(path.posix.sep).join(path.sep));

          try {
            await this.historyManager.recordBeforeDownload(localFilePath, file);
            await client.getFile(file, localFilePath);
            await this.historyManager.recordAfterDownload(localFilePath, file);
            result.filesProcessed++;
            progress.report({ increment: (i / totalFiles) * 100, message: `${path.basename(file)}` });
          } catch (error) {
            result.errors.push(`${file}: ${error}`);
          }
        }
      });

      if (result.errors.length > 0) {
        vscode.window.showWarningMessage(`Download completed with ${result.errors.length} errors`);
      } else {
        vscode.window.showInformationMessage(`Successfully downloaded ${result.filesProcessed} files`);
      }
    } catch (error) {
      result.success = false;
      result.errors.push(String(error));
      vscode.window.showErrorMessage(`Failed to download folder: ${error}`);
    }

    return result;
  }

  async syncAll(): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      filesProcessed: 0,
      errors: []
    };

    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        throw new Error('No workspace folder open');
      }

      const activeProfile = this.profileManager.getActiveProfile();
      if (!activeProfile) {
        throw new Error('No active server profile');
      }

      const client = await this.sftpManager.ensureConnected();
      const localFiles = this.getAllFiles(workspaceFolder.uri.fsPath);

      const filesToUpload = localFiles.filter(file => {
        const relativePath = path.relative(workspaceFolder.uri.fsPath, file);
        return !this.shouldExclude(relativePath, activeProfile.exclude);
      });

      const totalFiles = filesToUpload.length;

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Syncing ${totalFiles} files...`,
        cancellable: true
      }, async (progress, token) => {
        for (let i = 0; i < filesToUpload.length; i++) {
          if (token.isCancellationRequested) {
            throw new Error('Sync cancelled');
          }

          const file = filesToUpload[i];
          const relativePath = path.relative(workspaceFolder.uri.fsPath, file);
          const remoteFilePath = path.posix.join(activeProfile.remotePath, relativePath.split(path.sep).join(path.posix.sep));

          try {
            await this.historyManager.recordBeforeUpload(file, remoteFilePath);
            await client.putFile(file, remoteFilePath);
            await this.historyManager.recordAfterUpload(file, remoteFilePath);
            result.filesProcessed++;
            progress.report({ increment: (i / totalFiles) * 100, message: `${path.basename(file)}` });
          } catch (error) {
            result.errors.push(`${file}: ${error}`);
          }
        }
      });

      if (result.errors.length > 0) {
        vscode.window.showWarningMessage(`Sync completed with ${result.errors.length} errors`);
      } else {
        vscode.window.showInformationMessage(`Successfully synced ${result.filesProcessed} files`);
      }
    } catch (error) {
      result.success = false;
      result.errors.push(String(error));
      vscode.window.showErrorMessage(`Failed to sync: ${error}`);
    }

    return result;
  }

  private getAllFiles(dirPath: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  private async getAllRemoteFiles(remotePath: string, client: any): Promise<string[]> {
    const files: string[] = [];
    const fileInfos = await client.listDir(remotePath);

    for (const fileInfo of fileInfos) {
      if (fileInfo.name === '.' || fileInfo.name === '..') {
        continue;
      }

      const fullPath = path.posix.join(remotePath, fileInfo.name);
      if (fileInfo.type === 'd') {
        files.push(...await this.getAllRemoteFiles(fullPath, client));
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }

  private getRemotePath(localPath: string, remoteBase: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return path.posix.join(remoteBase, path.basename(localPath));
    }
    const relativePath = path.relative(workspaceFolder.uri.fsPath, localPath);
    return path.posix.join(remoteBase, relativePath.split(path.sep).join(path.posix.sep));
  }

  private getLocalPath(remotePath: string, remoteBase: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error('No workspace folder open');
    }
    const relativePath = path.posix.relative(remoteBase, remotePath);
    return path.join(workspaceFolder.uri.fsPath, relativePath.split(path.posix.sep).join(path.sep));
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
}
