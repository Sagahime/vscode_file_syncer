import * as vscode from 'vscode';
import { RemoteFileProvider } from './treeView/remoteFileProvider';
import { RemoteFileItem } from './treeView/remoteFileItem';
import { SFTPManager } from './sftp/sftpManager';
import { ConfigManager } from './config/configManager';
import { ConfigEditorProvider } from './config/configEditor';
import { SyncManager } from './sync/syncManager';
import { SyncScheduler } from './sync/syncScheduler';
import { DiffViewer } from './diff/diffViewer';
import { HistoryManager } from './history/historyManager';
import { RollbackManager } from './history/rollbackManager';
import { PathUtils } from './utils/pathUtils';

let sftpManager: SFTPManager;
let configManager: ConfigManager;
let configEditorProvider: ConfigEditorProvider;
let syncManager: SyncManager;
let syncScheduler: SyncScheduler;
let diffViewer: DiffViewer;
let historyManager: HistoryManager;
let rollbackManager: RollbackManager;
let remoteFileProvider: RemoteFileProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('FileSyncer is now active!');

  sftpManager = SFTPManager.getInstance();
  configManager = ConfigManager.getInstance();
  configEditorProvider = ConfigEditorProvider.getInstance();
  syncManager = SyncManager.getInstance();
  syncScheduler = SyncScheduler.getInstance();
  diffViewer = new DiffViewer();
  historyManager = HistoryManager.getInstance();
  rollbackManager = RollbackManager.getInstance();

  remoteFileProvider = new RemoteFileProvider();
  vscode.window.registerTreeDataProvider('remoteFilesExplorer', remoteFileProvider);

  const openConfigDisposable = vscode.commands.registerCommand('filesyncer.openConfig', () => {
    console.log('Opening config editor...');
    configEditorProvider.show();
  });
  context.subscriptions.push(openConfigDisposable);

  console.log('FileSyncer commands registered successfully!');

  vscode.commands.registerCommand('filesyncer.connect', async () => {
    const profileManager = configManager.getProfileManager();
    const profiles = profileManager.getProfiles();

    if (profiles.length === 0) {
      const shouldCreate = await vscode.window.showInformationMessage(
        'No server profile configured. Would you like to create one?',
        'Create',
        'Cancel'
      );
      if (shouldCreate === 'Create') {
        const profile = await configManager.promptForProfile();
        if (profile) {
          await profileManager.addProfile(profile);
          await profileManager.setActiveProfile(profile.name);
          await sftpManager.connect(profile.name);
          remoteFileProvider.refresh();
        }
      }
      return;
    }

    const items = profiles.map(p => ({
      label: p.name,
      description: `${p.username}@${p.host}:${p.port}`,
      profile: p
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a server to connect to'
    });

    if (selected) {
      try {
        await sftpManager.connect(selected.profile.name);
        await profileManager.setActiveProfile(selected.profile.name);

        // Check if remote directory exists
        const remoteExists = await sftpManager.checkRemoteDirectoryExists(selected.profile.remotePath);
        if (!remoteExists) {
          const shouldCreate = await vscode.window.showWarningMessage(
            `Remote directory "${selected.profile.remotePath}" does not exist. Create it?`,
            'Create',
            'Cancel'
          );
          if (shouldCreate === 'Create') {
            await sftpManager.createRemoteDirectory(selected.profile.remotePath);
            vscode.window.showInformationMessage(`Created directory: ${selected.profile.remotePath}`);
          }
        }

        remoteFileProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to connect: ${error}`);
      }
    }
  });

  vscode.commands.registerCommand('filesyncer.disconnect', async () => {
    await sftpManager.disconnect();
    remoteFileProvider.refresh();
  });

  vscode.commands.registerCommand('filesyncer.switchProfile', async () => {
    const profileManager = configManager.getProfileManager();
    const profiles = profileManager.getProfiles();

    if (profiles.length === 0) {
      vscode.window.showInformationMessage('No server profiles configured');
      return;
    }

    const items = profiles.map(p => ({
      label: p.name,
      description: `${p.username}@${p.host}:${p.port}`,
      profile: p
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a server profile'
    });

    if (selected) {
      await profileManager.setActiveProfile(selected.profile.name);
      const status = sftpManager.getConnectionStatus(selected.profile.name);

      if (status === 'connected') {
        vscode.window.showInformationMessage(`Switched to ${selected.profile.name}`);
      } else {
        const shouldConnect = await vscode.window.showInformationMessage(
          `Switched to ${selected.profile.name}. Connect now?`,
          'Connect',
          'Cancel'
        );
        if (shouldConnect === 'Connect') {
          await sftpManager.connect(selected.profile.name);
        }
      }
      remoteFileProvider.refresh();
    }
  });

  vscode.commands.registerCommand('filesyncer.download', async (item: RemoteFileItem) => {
    if (!item) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No file selected');
        return;
      }
      const profileManager = configManager.getProfileManager();
      const activeProfile = profileManager.getActiveProfile();
      if (!activeProfile) {
        vscode.window.showInformationMessage('No active server profile');
        return;
      }
      const localPath = editor.document.uri.fsPath;
      const remotePath = PathUtils.getRemotePath(
        localPath,
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        activeProfile.remotePath
      );
      await syncManager.downloadFile(remotePath, localPath);
      return;
    }

    if (item.type === 'folder') {
      await syncManager.downloadFolder(item.remotePath, item.localPath);
    } else {
      await syncManager.downloadFile(item.remotePath, item.localPath);
    }
    remoteFileProvider.refresh();
  });

  vscode.commands.registerCommand('filesyncer.upload', async (item: RemoteFileItem) => {
    if (!item) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No file selected');
        return;
      }
      const localPath = editor.document.uri.fsPath;
      await syncManager.uploadFile(localPath);
      return;
    }

    if (item.type === 'folder') {
      await syncManager.uploadFolder(item.localPath, item.remotePath);
    } else {
      await syncManager.uploadFile(item.localPath, item.remotePath);
    }
    remoteFileProvider.refresh();
  });

  vscode.commands.registerCommand('filesyncer.compare', async (item: RemoteFileItem) => {
    if (!item) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No file selected');
        return;
      }
      const localPath = editor.document.uri.fsPath;
      const profileManager = configManager.getProfileManager();
      const activeProfile = profileManager.getActiveProfile();
      if (!activeProfile) {
        vscode.window.showInformationMessage('No active server profile');
        return;
      }
      const remotePath = PathUtils.getRemotePath(
        localPath,
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        activeProfile.remotePath
      );
      await diffViewer.showDiff(localPath, remotePath);
      return;
    }

    if (item.type === 'file') {
      await diffViewer.showDiff(item.localPath, item.remotePath);
    } else {
      vscode.window.showInformationMessage('Cannot compare folders');
    }
  });

  vscode.commands.registerCommand('filesyncer.sync', async () => {
    await syncManager.syncAll();
    remoteFileProvider.refresh();
  });

  vscode.commands.registerCommand('filesyncer.refresh', () => {
    remoteFileProvider.refresh();
  });

  vscode.commands.registerCommand('filesyncer.showHistory', async (item: RemoteFileItem) => {
    if (item) {
      historyManager.showHistoryPanel(item.localPath);
    } else {
      historyManager.showHistoryPanel();
    }
  });

  vscode.commands.registerCommand('filesyncer.rollback', async (item: RemoteFileItem) => {
    if (item) {
      await rollbackManager.rollbackFile(item.localPath);
      remoteFileProvider.refresh();
    } else {
      await rollbackManager.showHistoryAndRollback();
    }
  });

  vscode.commands.registerCommand('filesyncer.openFile', async (item: RemoteFileItem) => {
    if (item.type === 'file') {
      const document = await vscode.workspace.openTextDocument(item.localPath);
      await vscode.window.showTextDocument(document);
    }
  });

  vscode.commands.registerCommand('filesyncer.createRemoteDirectory', async (item: RemoteFileItem) => {
    const parentPath = item ? item.remotePath : (configManager.getProfileManager().getActiveProfile()?.remotePath || '');

    const dirName = await vscode.window.showInputBox({
      prompt: 'Enter directory name',
      placeHolder: 'new-folder',
      validateInput: value => {
        if (!value || value.trim() === '') {
          return 'Directory name is required';
        }
        if (value.includes('/') || value.includes('\\')) {
          return 'Directory name cannot contain slashes';
        }
        return null;
      }
    });

    if (dirName) {
      try {
        const newPath = `${parentPath}/${dirName.trim()}`;
        await sftpManager.createRemoteDirectory(newPath);
        vscode.window.showInformationMessage(`Directory created: ${dirName}`);
        remoteFileProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create directory: ${error}`);
      }
    }
  });

  vscode.commands.registerCommand('filesyncer.deleteRemote', async (item: RemoteFileItem) => {
    if (!item) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete ${item.type === 'folder' ? 'folder' : 'file'} "${item.remotePath}"?`,
      { modal: true },
      'Delete',
      'Cancel'
    );

    if (confirm === 'Delete') {
      try {
        await sftpManager.deleteRemotePath(item.remotePath);
        vscode.window.showInformationMessage(`Deleted: ${item.remotePath}`);
        remoteFileProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to delete: ${error}`);
      }
    }
  });

  vscode.commands.registerCommand('filesyncer.renameRemote', async (item: RemoteFileItem) => {
    if (!item) {
      return;
    }

    const oldName = item.remotePath.split('/').pop() || '';
    const newName = await vscode.window.showInputBox({
      prompt: 'Enter new name',
      value: oldName,
      validateInput: value => {
        if (!value || value.trim() === '') {
          return 'Name is required';
        }
        return null;
      }
    });

    if (newName && newName !== oldName) {
      try {
        const parentPath = item.remotePath.substring(0, item.remotePath.lastIndexOf('/'));
        const newPath = parentPath + '/' + newName.trim();
        await sftpManager.renameRemotePath(item.remotePath, newPath);
        vscode.window.showInformationMessage(`Renamed to: ${newName}`);
        remoteFileProvider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to rename: ${error}`);
      }
    }
  });

  vscode.workspace.onDidSaveTextDocument(document => {
    syncScheduler.scheduleUpload(document);
  });

  context.subscriptions.push(
    sftpManager,
    configManager,
    historyManager,
    syncScheduler
  );
}

export function deactivate() {
  sftpManager?.dispose();
  configManager?.dispose();
  historyManager?.dispose();
  syncScheduler?.dispose();
}
