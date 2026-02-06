import * as vscode from 'vscode';
import { ProfileManager, ServerProfile } from './profileManager';

export class ConfigManager {
  private static instance: ConfigManager;
  private profileManager: ProfileManager;

  private constructor() {
    this.profileManager = ProfileManager.getInstance();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  getAutoUpload(): boolean {
    const config = vscode.workspace.getConfiguration('filesyncer');
    return config.get<boolean>('autoUpload', false);
  }

  getAutoUploadDelay(): number {
    const config = vscode.workspace.getConfiguration('filesyncer');
    return config.get<number>('autoUploadDelay', 1000);
  }

  getMaxHistoryVersions(): number {
    const config = vscode.workspace.getConfiguration('filesyncer');
    return config.get<number>('maxHistoryVersions', 10);
  }

  getHistoryMaxAgeDays(): number {
    const config = vscode.workspace.getConfiguration('filesyncer');
    return config.get<number>('historyMaxAgeDays', 30);
  }

  getConfirmBeforeOverwrite(): boolean {
    const config = vscode.workspace.getConfiguration('filesyncer');
    return config.get<boolean>('confirmBeforeOverwrite', true);
  }

  getProfileManager(): ProfileManager {
    return this.profileManager;
  }

  validateProfile(profile: ServerProfile): { valid: boolean; error?: string } {
    if (!profile.name || profile.name.trim() === '') {
      return { valid: false, error: 'Profile name is required' };
    }

    if (!profile.host || profile.host.trim() === '') {
      return { valid: false, error: 'Host is required' };
    }

    if (!profile.username || profile.username.trim() === '') {
      return { valid: false, error: 'Username is required' };
    }

    if (!profile.remotePath || profile.remotePath.trim() === '') {
      return { valid: false, error: 'Remote path is required' };
    }

    if (profile.port && (profile.port < 1 || profile.port > 65535)) {
      return { valid: false, error: 'Port must be between 1 and 65535' };
    }

    return { valid: true };
  }

  async promptForProfile(): Promise<ServerProfile | undefined> {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter profile name',
      placeHolder: 'My Server',
      validateInput: value => {
        if (!value || value.trim() === '') {
          return 'Profile name is required';
        }
        const existing = this.profileManager.getProfile(value);
        if (existing) {
          return 'A profile with this name already exists';
        }
        return null;
      }
    });

    if (!name) {
      return undefined;
    }

    const host = await vscode.window.showInputBox({
      prompt: 'Enter server hostname or IP address',
      placeHolder: 'example.com',
      validateInput: value => {
        if (!value || value.trim() === '') {
          return 'Host is required';
        }
        return null;
      }
    });

    if (!host) {
      return undefined;
    }

    const username = await vscode.window.showInputBox({
      prompt: 'Enter SSH username',
      placeHolder: 'user',
      validateInput: value => {
        if (!value || value.trim() === '') {
          return 'Username is required';
        }
        return null;
      }
    });

    if (!username) {
      return undefined;
    }

    const usePassword = await vscode.window.showQuickPick(
      [
        { label: 'Private Key', description: 'Use SSH private key for authentication' },
        { label: 'Password', description: 'Use password for authentication (not recommended)' }
      ],
      { placeHolder: 'Select authentication method' }
    );

    const profile: ServerProfile = {
      name: name.trim(),
      host: host.trim(),
      port: 22,
      username: username.trim(),
      remotePath: '',
      exclude: ['node_modules/**', '.git/**', '*.log']
    };

    if (usePassword?.label === 'Password') {
      const password = await vscode.window.showInputBox({
        prompt: 'Enter SSH password',
        password: true
      });
      if (password) {
        profile.password = password;
      }
    } else {
      const privateKeyPath = await vscode.window.showInputBox({
        prompt: 'Enter path to private key',
        placeHolder: '~/.ssh/id_rsa'
      });
      if (privateKeyPath) {
        profile.privateKeyPath = privateKeyPath.trim();
      }

      const passphrase = await vscode.window.showInputBox({
        prompt: 'Enter passphrase for private key (optional)',
        password: true
      });
      if (passphrase) {
        profile.passphrase = passphrase;
      }
    }

    const remotePath = await vscode.window.showInputBox({
      prompt: 'Enter remote directory path',
      placeHolder: '/var/www/html',
      validateInput: value => {
        if (!value || value.trim() === '') {
          return 'Remote path is required';
        }
        return null;
      }
    });

    if (!remotePath) {
      return undefined;
    }

    profile.remotePath = remotePath.trim();

    return profile;
  }

  dispose(): void {
    this.profileManager.dispose();
  }
}
