import * as vscode from 'vscode';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { RemoteFileItem, SyncStatus } from './remoteFileItem';
import { SFTPManager } from '../sftp/sftpManager';
import { ProfileManager } from '../config/profileManager';
import { FileComparator } from '../utils/fileComparator';

export class RemoteFileProvider implements vscode.TreeDataProvider<RemoteFileItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RemoteFileItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private sftpManager: SFTPManager;
  private profileManager: ProfileManager;
  private fileComparator: FileComparator;

  constructor() {
    this.sftpManager = SFTPManager.getInstance();
    this.profileManager = ProfileManager.getInstance();
    this.fileComparator = new FileComparator();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: RemoteFileItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RemoteFileItem): Promise<RemoteFileItem[]> {
    const activeProfile = this.profileManager.getActiveProfile();
    if (!activeProfile) {
      vscode.window.showWarningMessage('Please configure a server profile first');
      return [];
    }

    if (!element) {
      // Check if remote directory exists
      const remoteExists = await this.sftpManager.checkRemoteDirectoryExists(activeProfile.remotePath);
      if (!remoteExists) {
        return [new RemoteFileItem(
          activeProfile.remotePath,
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
          'folder',
          'remote-only',
          vscode.TreeItemCollapsibleState.None,
          `⚠️ Remote directory does not exist: ${activeProfile.remotePath}`
        )];
      }

      // Check if directory is empty
      const isEmpty = await this.sftpManager.checkRemoteDirectoryEmpty(activeProfile.remotePath);
      if (isEmpty) {
        return [new RemoteFileItem(
          activeProfile.remotePath,
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
          'folder',
          'synced',
          vscode.TreeItemCollapsibleState.Expanded,
          `📁 Empty directory (right-click to create files/folders)`
        )];
      }

      const client = await this.sftpManager.ensureConnected();
      const basePath = activeProfile.remotePath;
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const localBasePath = workspaceFolder ? workspaceFolder.uri.fsPath : '';

      const rootItem = new RemoteFileItem(
        basePath,
        localBasePath,
        'folder',
        'unknown',
        vscode.TreeItemCollapsibleState.Expanded
      );
      return [rootItem];
    }

    if (element.type !== 'folder') {
      return [];
    }

    try {
      const client = await this.sftpManager.ensureConnected();
      const fileInfos = await client.listDir(element.remotePath);

      const items: RemoteFileItem[] = [];
      for (const fileInfo of fileInfos) {
        if (this.shouldExclude(fileInfo.name, activeProfile.exclude)) {
          continue;
        }

        const localPath = path.join(element.localPath, fileInfo.name);
        const syncStatus = await this.determineSyncStatus(fileInfo, localPath);

        const item = RemoteFileItem.fromFileInfo(fileInfo, element.localPath, syncStatus);
        items.push(item);
      }

      // Show message if directory is empty (excluding . and ..)
      if (items.length === 0) {
        return [new RemoteFileItem(
          element.remotePath,
          element.localPath,
          'folder',
          'synced',
          vscode.TreeItemCollapsibleState.None,
          '📭 Empty folder'
        )];
      }

      items.sort((a, b) => {
        if (a.type === b.type) {
          return a.remotePath.localeCompare(b.remotePath);
        }
        return a.type === 'folder' ? -1 : 1;
      });

      return items;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to list files: ${error}`);
      return [];
    }
  }

  private async determineSyncStatus(fileInfo: any, localPath: string): Promise<SyncStatus> {
    const fs = require('fs');
    const localExists = fs.existsSync(localPath);

    if (!localExists) {
      return 'remote-only';
    }

    const type = fileInfo.type === 'd' ? 'folder' : 'file';
    if (type === 'folder') {
      return 'synced';
    }

    const areEqual = await this.fileComparator.compareFiles(localPath, fileInfo.path);
    return areEqual ? 'synced' : 'modified';
  }

  private shouldExclude(fileName: string, excludePatterns: string[]): boolean {
    if (fileName === '.' || fileName === '..') {
      return true;
    }

    for (const pattern of excludePatterns) {
      if (minimatch(fileName, pattern) || minimatch(fileName, pattern, { dot: true })) {
        return true;
      }
    }

    return false;
  }

  async getParent(element: RemoteFileItem): Promise<RemoteFileItem | undefined> {
    const remoteParentPath = path.dirname(element.remotePath);
    const localParentPath = path.dirname(element.localPath);

    if (remoteParentPath === element.remotePath) {
      return undefined;
    }

    return new RemoteFileItem(
      remoteParentPath,
      localParentPath,
      'folder',
      'unknown',
      vscode.TreeItemCollapsibleState.Collapsed
    );
  }
}
