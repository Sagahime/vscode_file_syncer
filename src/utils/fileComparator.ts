import * as fs from 'fs';
import * as crypto from 'crypto';
import { SFTPManager } from '../sftp/sftpManager';

export class FileComparator {
  private sftpManager: SFTPManager;

  constructor() {
    this.sftpManager = SFTPManager.getInstance();
  }

  async compareFiles(localPath: string, remotePath: string): Promise<boolean> {
    try {
      const localHash = await this.getLocalFileHash(localPath);
      const remoteContent = await this.getRemoteFileContent(remotePath);
      const remoteHash = this.computeHash(remoteContent);

      return localHash === remoteHash;
    } catch (error) {
      console.error(`Error comparing files: ${error}`);
      return false;
    }
  }

  async getFileDiff(localPath: string, remotePath: string): Promise<{
    localContent: string;
    remoteContent: string;
    localLines: string[];
    remoteLines: string[];
  }> {
    const localContent = fs.readFileSync(localPath, 'utf-8');
    const remoteContent = await this.getRemoteFileContent(remotePath);

    return {
      localContent,
      remoteContent,
      localLines: localContent.split('\n'),
      remoteLines: remoteContent.split('\n')
    };
  }

  private async getLocalFileHash(filePath: string): Promise<string> {
    const content = fs.readFileSync(filePath);
    return this.computeHash(content);
  }

  private async getRemoteFileContent(remotePath: string): Promise<string> {
    const client = await this.sftpManager.ensureConnected();
    const tempPath = `/tmp/filesyncer_temp_${Date.now()}`;
    await client.getFile(remotePath, tempPath);
    const content = fs.readFileSync(tempPath, 'utf-8');
    fs.unlinkSync(tempPath);
    return content;
  }

  private computeHash(content: Buffer | string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  isBinaryFile(content: Buffer): boolean {
    const binaryCheck = content.slice(0, 8000);
    for (let i = 0; i < binaryCheck.length; i++) {
      const byte = binaryCheck[i];
      if (byte === 0 || (byte < 8 && byte !== 9 && byte !== 10 && byte !== 13)) {
        return true;
      }
    }
    return false;
  }
}
