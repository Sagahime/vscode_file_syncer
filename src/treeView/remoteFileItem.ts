import * as vscode from 'vscode';
import * as path from 'path';
import { FileInfo } from '../sftp/sftpClient';

export type SyncStatus = 'synced' | 'remote-only' | 'local-only' | 'modified' | 'unknown';

export class RemoteFileItem extends vscode.TreeItem {
  constructor(
    public readonly remotePath: string,
    public readonly localPath: string,
    public readonly type: 'file' | 'folder',
    public readonly syncStatus: SyncStatus = 'unknown',
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly message?: string
  ) {
    super(path.basename(remotePath) || remotePath, collapsibleState);

    if (message) {
      this.label = message;
    }

    this.tooltip = `${remotePath}\n${localPath}`;
    this.description = message ? '' : this.getStatusDescription();
    this.iconPath = message ? new vscode.ThemeIcon('warning') : this.getIcon();
    this.contextValue = `${type}-${syncStatus}${message ? '-message' : ''}`;
  }

  private getIcon(): vscode.ThemeIcon {
    if (this.type === 'folder') {
      return new vscode.ThemeIcon('folder');
    }

    switch (this.syncStatus) {
      case 'synced':
        return new vscode.ThemeIcon('check', new vscode.ThemeColor('terminal.ansiGreen'));
      case 'remote-only':
        return new vscode.ThemeIcon('arrow-down', new vscode.ThemeColor('terminal.ansiBlue'));
      case 'local-only':
        return new vscode.ThemeIcon('arrow-up', new vscode.ThemeColor('terminal.ansiYellow'));
      case 'modified':
        return new vscode.ThemeIcon('diff', new vscode.ThemeColor('terminal.ansiRed'));
      default:
        return new vscode.ThemeIcon('file');
    }
  }

  private getStatusDescription(): string {
    switch (this.syncStatus) {
      case 'synced':
        return 'Synced';
      case 'remote-only':
        return 'Remote only';
      case 'local-only':
        return 'Local only';
      case 'modified':
        return 'Modified';
      default:
        return '';
    }
  }

  static fromFileInfo(fileInfo: FileInfo, localBasePath: string, syncStatus: SyncStatus = 'unknown'): RemoteFileItem {
    const localPath = path.join(localBasePath, fileInfo.name);
    const type = fileInfo.type === 'd' ? 'folder' : 'file';
    const collapsibleState = type === 'folder' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;

    return new RemoteFileItem(
      fileInfo.path,
      localPath,
      type,
      syncStatus,
      collapsibleState
    );
  }
}
