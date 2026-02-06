import * as vscode from 'vscode';
import { SFTPClient } from './sftpClient';
import { ServerProfile } from '../config/profileManager';
import { ProfileManager } from '../config/profileManager';

interface ConnectionInfo {
  profile: ServerProfile;
  client: SFTPClient;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
}

export class SFTPManager {
  private static instance: SFTPManager;
  private connections: Map<string, ConnectionInfo> = new Map();
  private profileManager: ProfileManager;
  private statusBarItem: vscode.StatusBarItem;
  private outputChannel: vscode.OutputChannel;

  private constructor() {
    this.profileManager = ProfileManager.getInstance();
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'filesyncer.switchProfile';
    this.outputChannel = vscode.window.createOutputChannel('FileSyncer');
    this.updateStatusBar();
  }

  static getInstance(): SFTPManager {
    if (!SFTPManager.instance) {
      SFTPManager.instance = new SFTPManager();
    }
    return SFTPManager.instance;
  }

  async connect(profileName: string): Promise<SFTPClient> {
    const profile = this.profileManager.getProfile(profileName);
    if (!profile) {
      throw new Error(`Profile "${profileName}" not found`);
    }

    const existing = this.connections.get(profileName);
    if (existing && existing.client.isConnected()) {
      return existing.client;
    }

    const client = new SFTPClient();
    this.connections.set(profileName, {
      profile,
      client,
      status: 'connecting'
    });

    this.updateStatusBar();
    this.log(`Connecting to ${profile.name} (${profile.host})...`);

    try {
      await client.connect(profile);
      this.connections.set(profileName, {
        profile,
        client,
        status: 'connected'
      });
      this.log(`Connected to ${profile.name}`);
      this.updateStatusBar();
      vscode.window.showInformationMessage(`Connected to ${profile.name}`);
      return client;
    } catch (error) {
      const errorMsg = String(error);
      this.connections.set(profileName, {
        profile,
        client,
        status: 'error',
        error: errorMsg
      });
      this.log(`Failed to connect to ${profile.name}: ${errorMsg}`);
      this.updateStatusBar();
      vscode.window.showErrorMessage(`Failed to connect to ${profile.name}: ${errorMsg}`);
      throw error;
    }
  }

  async disconnect(profileName?: string): Promise<void> {
    if (profileName) {
      const connection = this.connections.get(profileName);
      if (connection && connection.client.isConnected()) {
        await connection.client.disconnect();
        this.connections.delete(profileName);
        this.log(`Disconnected from ${connection.profile.name}`);
        vscode.window.showInformationMessage(`Disconnected from ${connection.profile.name}`);
      }
    } else {
      for (const [name, connection] of this.connections.entries()) {
        if (connection.client.isConnected()) {
          await connection.client.disconnect();
          this.log(`Disconnected from ${connection.profile.name}`);
        }
      }
      this.connections.clear();
      vscode.window.showInformationMessage('Disconnected from all servers');
    }
    this.updateStatusBar();
  }

  getClient(profileName?: string): SFTPClient | undefined {
    const activeProfile = profileName || this.profileManager.getActiveProfile()?.name;
    if (!activeProfile) {
      return undefined;
    }

    const connection = this.connections.get(activeProfile);
    return connection?.client.isConnected() ? connection.client : undefined;
  }

  getActiveClient(): SFTPClient | undefined {
    const activeProfile = this.profileManager.getActiveProfile();
    if (!activeProfile) {
      return undefined;
    }
    return this.getClient(activeProfile.name);
  }

  async ensureConnected(profileName?: string): Promise<SFTPClient> {
    const activeProfile = profileName || this.profileManager.getActiveProfile()?.name;
    if (!activeProfile) {
      throw new Error('No active profile. Please configure a server profile first.');
    }

    let client = this.getClient(activeProfile);
    if (!client) {
      client = await this.connect(activeProfile);
    }
    return client;
  }

  getConnectionStatus(profileName: string): string {
    const connection = this.connections.get(profileName);
    return connection?.status || 'disconnected';
  }

  private updateStatusBar(): void {
    const activeProfile = this.profileManager.getActiveProfile();
    if (!activeProfile) {
      this.statusBarItem.text = '$(plug) No Server';
      this.statusBarItem.tooltip = 'No server configured';
      this.statusBarItem.hide();
      return;
    }

    const connection = this.connections.get(activeProfile.name);
    if (!connection) {
      this.statusBarItem.text = `$(plug-disconnected) ${activeProfile.name}`;
      this.statusBarItem.tooltip = 'Click to connect or switch server';
      this.statusBarItem.show();
      return;
    }

    switch (connection.status) {
      case 'connecting':
        this.statusBarItem.text = `$(sync~spin) ${activeProfile.name}`;
        this.statusBarItem.tooltip = 'Connecting...';
        break;
      case 'connected':
        this.statusBarItem.text = `$(check) ${activeProfile.name}`;
        this.statusBarItem.tooltip = `Connected to ${connection.profile.host}`;
        break;
      case 'error':
        this.statusBarItem.text = `$(error) ${activeProfile.name}`;
        this.statusBarItem.tooltip = connection.error || 'Connection error';
        break;
      default:
        this.statusBarItem.text = `$(plug-disconnected) ${activeProfile.name}`;
        this.statusBarItem.tooltip = 'Disconnected';
    }
    this.statusBarItem.show();
  }

  private log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.outputChannel.appendLine(`[${timestamp}] ${message}`);
  }

  showOutput(): void {
    this.outputChannel.show();
  }

  async checkRemoteDirectoryExists(remotePath: string): Promise<boolean> {
    try {
      const client = await this.ensureConnected();
      return await client.exists(remotePath);
    } catch (error) {
      return false;
    }
  }

  async createRemoteDirectory(remotePath: string): Promise<void> {
    const client = await this.ensureConnected();
    await client.mkdir(remotePath, true);
    this.log(`Created directory: ${remotePath}`);
  }

  async deleteRemotePath(remotePath: string): Promise<void> {
    const client = await this.ensureConnected();
    await client.deleteFile(remotePath);
    this.log(`Deleted: ${remotePath}`);
  }

  async renameRemotePath(oldPath: string, newPath: string): Promise<void> {
    const client = await this.ensureConnected();
    const clientPrivate = client as any;
    if (typeof clientPrivate.client.rename === 'function') {
      await clientPrivate.client.rename(oldPath, newPath);
    } else {
      throw new Error('Rename operation not supported');
    }
    this.log(`Renamed: ${oldPath} -> ${newPath}`);
  }

  async checkRemoteDirectoryEmpty(remotePath: string): Promise<boolean> {
    try {
      const client = await this.ensureConnected();
      const files = await client.listDir(remotePath);
      return files.length === 0 || (files.length === 2 && files.every(f => f.name === '.' || f.name === '..'));
    } catch (error) {
      return false;
    }
  }

  dispose(): void {
    this.disconnect().catch(console.error);
    this.statusBarItem.dispose();
    this.outputChannel.dispose();
  }
}
