import Client from 'ssh2-sftp-client';
import * as fs from 'fs';
import * as path from 'path';
import { ServerProfile } from '../config/profileManager';

export interface FileInfo {
  type: 'd' | '-' | 'l';
  name: string;
  size: number;
  modifyTime: number;
  accessTime: number;
  rights: {
    user: string;
    group: string;
    other: string;
  };
  owner: number;
  group: number;
  path: string;
}

export class SFTPClient {
  private client: Client;
  private connected: boolean = false;

  constructor() {
    this.client = new Client();
  }

  async connect(profile: ServerProfile): Promise<void> {
    try {
      const config: any = {
        host: profile.host,
        port: profile.port || 22,
        username: profile.username
      };

      if (profile.password) {
        config.password = profile.password;
      } else if (profile.privateKeyPath) {
        try {
          config.privateKey = fs.readFileSync(profile.privateKeyPath);
        } catch (error) {
          throw new Error(`Failed to read private key: ${error}`);
        }
        if (profile.passphrase) {
          config.passphrase = profile.passphrase;
        }
      }

      await this.client.connect(config);
      this.connected = true;
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      try {
        await this.client.end();
        this.connected = false;
      } catch (error) {
        throw new Error(`Failed to disconnect: ${error}`);
      }
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async listDir(remotePath: string): Promise<FileInfo[]> {
    this.ensureConnected();
    try {
      const files = await this.client.list(remotePath);
      return files.map((file: any) => ({
        ...file,
        path: path.posix.join(remotePath, file.name)
      }));
    } catch (error) {
      throw new Error(`Failed to list directory ${remotePath}: ${error}`);
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    this.ensureConnected();
    try {
      await this.client.stat(remotePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  async getFile(remotePath: string, localPath: string): Promise<void> {
    this.ensureConnected();
    try {
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await this.client.fastGet(remotePath, localPath);
    } catch (error) {
      throw new Error(`Failed to download file ${remotePath}: ${error}`);
    }
  }

  async putFile(localPath: string, remotePath: string): Promise<void> {
    this.ensureConnected();
    try {
      const remoteDir = path.posix.dirname(remotePath);
      try {
        await this.client.mkdir(remoteDir, true);
      } catch {
        // Ignore error if directory already exists
      }
      await this.client.fastPut(localPath, remotePath);
    } catch (error) {
      throw new Error(`Failed to upload file ${localPath}: ${error}`);
    }
  }

  async deleteFile(remotePath: string): Promise<void> {
    this.ensureConnected();
    try {
      const stat = await this.client.stat(remotePath);
      if (stat.isDirectory) {
        await this.client.rmdir(remotePath, true);
      } else {
        await this.client.delete(remotePath);
      }
    } catch (error) {
      throw new Error(`Failed to delete ${remotePath}: ${error}`);
    }
  }

  async mkdir(remotePath: string, recursive: boolean = true): Promise<void> {
    this.ensureConnected();
    try {
      await this.client.mkdir(remotePath, recursive);
    } catch (error) {
      throw new Error(`Failed to create directory ${remotePath}: ${error}`);
    }
  }

  async stat(remotePath: string): Promise<FileInfo> {
    this.ensureConnected();
    try {
      const stats = await this.client.stat(remotePath);
      return {
        type: stats.isDirectory ? 'd' : '-',
        name: path.basename(remotePath),
        size: stats.size,
        modifyTime: stats.modifyTime,
        accessTime: stats.accessTime,
        rights: {
          user: '',
          group: '',
          other: ''
        },
        owner: 0,
        group: 0,
        path: remotePath
      };
    } catch (error) {
      throw new Error(`Failed to stat ${remotePath}: ${error}`);
    }
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('Not connected to SFTP server');
    }
  }

  on(event: string, callback: (...args: any[]) => void): void {
    this.client.on(event, callback);
  }

  removeListener(event: string, callback: (...args: any[]) => void): void {
    this.client.removeListener(event, callback);
  }
}
