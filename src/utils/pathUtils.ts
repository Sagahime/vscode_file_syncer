import * as path from 'path';
import * as vscode from 'vscode';

export class PathUtils {
  static getLocalPath(remotePath: string, remoteBase: string, localBase: string): string {
    const relativePath = path.posix.relative(remoteBase, remotePath);
    return path.join(localBase, relativePath);
  }

  static getRemotePath(localPath: string, localBase: string, remoteBase: string): string {
    const relativePath = path.relative(localBase, localPath);
    return path.posix.join(remoteBase, relativePath.split(path.sep).join(path.posix.sep));
  }

  static normalizeRemotePath(remotePath: string): string {
    return remotePath.replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  static isChildOf(childPath: string, parentPath: string): boolean {
    const relative = path.relative(parentPath, childPath);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  static getWorkspacePath(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    return workspaceFolder?.uri.fsPath;
  }

  static ensureAbsolutePath(inputPath: string, basePath?: string): string {
    if (path.isAbsolute(inputPath)) {
      return inputPath;
    }
    return basePath ? path.join(basePath, inputPath) : inputPath;
  }
}
