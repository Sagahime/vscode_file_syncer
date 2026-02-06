import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

export interface ServerProfile {
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  remotePath: string;
  exclude: string[];
}

export interface ProfileConfig {
  profiles: ServerProfile[];
  activeProfile: string;
}

export class ProfileManager {
  private static instance: ProfileManager;
  private config: ProfileConfig;
  private configChangeListener?: vscode.Disposable;

  private constructor() {
    this.config = this.loadConfig();
    this.watchConfigChanges();
  }

  static getInstance(): ProfileManager {
    if (!ProfileManager.instance) {
      ProfileManager.instance = new ProfileManager();
    }
    return ProfileManager.instance;
  }

  private loadConfig(): ProfileConfig {
    const config = vscode.workspace.getConfiguration('filesyncer');
    const profiles = config.get<ServerProfile[]>('profiles', []);
    const activeProfile = config.get<string>('activeProfile', '');
    return { profiles, activeProfile };
  }

  private watchConfigChanges(): void {
    this.configChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('filesyncer')) {
        this.config = this.loadConfig();
      }
    });
  }

  getProfiles(): ServerProfile[] {
    return this.config.profiles;
  }

  getProfile(name: string): ServerProfile | undefined {
    return this.config.profiles.find(p => p.name === name);
  }

  getActiveProfile(): ServerProfile | undefined {
    if (!this.config.activeProfile) {
      return this.config.profiles.length > 0 ? this.config.profiles[0] : undefined;
    }
    return this.getProfile(this.config.activeProfile);
  }

  async setActiveProfile(name: string): Promise<void> {
    const profile = this.getProfile(name);
    if (!profile) {
      throw new Error(`Profile "${name}" not found`);
    }

    await vscode.workspace.getConfiguration('filesyncer').update('activeProfile', name, vscode.ConfigurationTarget.Workspace);
    this.config.activeProfile = name;
  }

  expandPath(pathPattern: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspacePath = workspaceFolder?.uri.fsPath || '';

    return pathPattern
      .replace(/\${workspaceFolder}/g, workspacePath)
      .replace(/\${workspaceRoot}/g, workspacePath)
      .replace(/\${userHome}/g, os.homedir())
      .replace(/\${env:(.*?)}/g, (_, envVar) => process.env[envVar] || '');
  }

  getResolvedProfile(profile: ServerProfile): ServerProfile {
    const resolved = { ...profile };
    if (resolved.privateKeyPath) {
      resolved.privateKeyPath = this.expandPath(resolved.privateKeyPath);
    }
    return resolved;
  }

  async addProfile(profile: ServerProfile): Promise<void> {
    const existingIndex = this.config.profiles.findIndex(p => p.name === profile.name);
    if (existingIndex >= 0) {
      this.config.profiles[existingIndex] = profile;
    } else {
      this.config.profiles.push(profile);
    }

    const config = vscode.workspace.getConfiguration('filesyncer');
    await config.update('profiles', this.config.profiles, vscode.ConfigurationTarget.Workspace);
  }

  async removeProfile(name: string): Promise<void> {
    this.config.profiles = this.config.profiles.filter(p => p.name !== name);

    if (this.config.activeProfile === name) {
      this.config.activeProfile = this.config.profiles.length > 0 ? this.config.profiles[0].name : '';
      const config = vscode.workspace.getConfiguration('filesyncer');
      await config.update('activeProfile', this.config.activeProfile, vscode.ConfigurationTarget.Workspace);
    }

    const config = vscode.workspace.getConfiguration('filesyncer');
    await config.update('profiles', this.config.profiles, vscode.ConfigurationTarget.Workspace);
  }

  dispose(): void {
    if (this.configChangeListener) {
      this.configChangeListener.dispose();
    }
  }
}
