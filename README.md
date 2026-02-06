# FileSyncer - SFTP Deployment for VSCode

FileSyncer is a VSCode extension that provides SFTP deployment functionality similar to PyCharm's deployment feature. It allows you to sync files with remote servers, view file differences, and manage file history with rollback capabilities.

## Features

- **Multi-Server Support**: Configure and switch between multiple server profiles
- **SFTP Connection**: Secure file transfer via SSH
- **File Synchronization**: Upload and download files/folders with progress tracking
- **Visual Diff Viewer**: Compare local and remote files side-by-side
- **File History**: Track all upload/download operations with automatic backups
- **Rollback**: Restore any file to a previous version
- **Auto Upload**: Automatically upload files when saved (optional)
- **Workspace Configuration**: Settings stored in workspace for team collaboration

## Installation

1. Clone this repository
2. Run `npm install`
3. Press F5 in VSCode to launch the Extension Development Host
4. Or build with `npm run compile` and install the generated .vsix file

## Configuration

Create or edit `.vscode/settings.json` in your workspace:

```json
{
  "filesyncer.profiles": [
    {
      "name": "Production",
      "host": "example.com",
      "port": 22,
      "username": "deploy",
      "privateKeyPath": "${userHome}/.ssh/id_rsa",
      "remotePath": "/var/www/html",
      "exclude": ["node_modules/**", ".git/**", "*.log"]
    },
    {
      "name": "Staging",
      "host": "staging.example.com",
      "port": 22,
      "username": "deploy",
      "privateKeyPath": "${userHome}/.ssh/id_rsa",
      "remotePath": "/var/www/staging",
      "exclude": ["node_modules/**", ".git/**"]
    }
  ],
  "filesyncer.activeProfile": "Production",
  "filesyncer.autoUpload": false,
  "filesyncer.autoUploadDelay": 1000,
  "filesyncer.maxHistoryVersions": 10,
  "filesyncer.historyMaxAgeDays": 30,
  "filesyncer.confirmBeforeOverwrite": true
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `filesyncer.profiles` | array | `[]` | Server connection profiles |
| `filesyncer.activeProfile` | string | `""` | Active server profile name |
| `filesyncer.autoUpload` | boolean | `false` | Automatically upload files on save |
| `filesyncer.autoUploadDelay` | number | `1000` | Delay in ms before auto-upload (debounce) |
| `filesyncer.maxHistoryVersions` | number | `10` | Max history versions per file |
| `filesyncer.historyMaxAgeDays` | number | `30` | Max age of history in days |
| `filesyncer.confirmBeforeOverwrite` | boolean | `true` | Show confirmation before overwriting |

### Profile Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | Profile name |
| `host` | string | Yes | Server hostname or IP |
| `port` | number | No (default: 22) | SSH port |
| `username` | string | Yes | SSH username |
| `password` | string | No | SSH password (not recommended) |
| `privateKeyPath` | string | No | Path to private SSH key |
| `passphrase` | string | No | Passphrase for private key |
| `remotePath` | string | Yes | Remote directory path |
| `exclude` | array | No | File patterns to exclude from sync |

## Usage

### Basic Workflow

1. **Configure Server**: Click the gear icon ⚙️ in the Remote Files panel to open the visual configuration editor
2. **Add Profile**: Fill in the server details and test the connection
3. **Connect**: Click the "Connect to Server" button in the Remote Files panel
4. **Browse Files**: View remote files in the side bar explorer
5. **Sync Files**:
   - Right-click a file/folder to upload or download
   - Use inline buttons for quick actions
   - Or press `Ctrl+Shift+P` and search for FileSyncer commands

### Visual Configuration Editor

FileSyncer includes a visual configuration editor that allows you to manage server profiles without editing JSON directly:

- **Open**: Click the gear icon (⚙️) in the Remote Files panel or use the `filesyncer.openConfig` command
- **Add Profile**: Click "Add Profile" and fill in the form:
  - Profile name, host, port, username
  - Choose authentication method (SSH key or password)
  - Remote path and exclude patterns
- **Test Connection**: Verify your settings before saving
- **Edit**: Modify existing profiles
- **Delete**: Remove profiles you no longer need
- **Set Active**: Choose which profile to use for syncing

### Commands

| Command | Description |
|---------|-------------|
| `filesyncer.openConfig` | Open visual configuration editor |
| `filesyncer.connect` | Connect to a server |
| `filesyncer.disconnect` | Disconnect from server |
| `filesyncer.switchProfile` | Switch active server profile |
| `filesyncer.upload` | Upload selected file/folder |
| `filesyncer.download` | Download selected file/folder |
| `filesyncer.compare` | Compare local and remote files |
| `filesyncer.sync` | Sync all local changes to remote |
| `filesyncer.showHistory` | View file history |
| `filesyncer.rollback` | Rollback file to previous version |
| `filesyncer.createRemoteDirectory` | Create directory on remote server |
| `filesyncer.deleteRemote` | Delete file/folder on remote server |
| `filesyncer.renameRemote` | Rename file/folder on remote server |

### Remote File Operations

FileSyncer supports basic remote file operations directly from the Remote Files panel:

- **Create Directory**: Right-click in Remote Files panel → "Create Directory"
- **Delete**: Right-click a file/folder → "Delete"
- **Rename**: Right-click a file/folder → "Rename"

### Directory Status Messages

The Remote Files panel shows helpful status messages:
- ⚠️ **"Remote directory does not exist"** - Target directory doesn't exist on server
  - Click "Connect" and choose "Create" to automatically create it
- 📁 **"Empty directory"** - Directory exists but has no files
- 📭 **"Empty folder"** - Subdirectory is empty

### Configuration

### File Icons

- ✅ (Green) - File is synced with remote
- ⬇️ (Blue) - File only exists on remote
- ⬆️ (Yellow) - File only exists locally
- 🔄 (Red) - File has been modified

## File History

FileSyncer automatically backs up files before any upload or download operation. History is stored in `.vscode/filesyncer/history/` in your workspace.

To view history:
- Right-click a file and select "Show File History"
- Or use the command palette

To rollback:
- Right-click a file and select "Rollback to Version"
- Select a version from the history
- Choose to preview or directly rollback

## Auto Upload

Enable auto upload to automatically upload files when you save them:

```json
{
  "filesyncer.autoUpload": true,
  "filesyncer.autoUploadDelay": 1000
}
```

Files matching the `exclude` patterns will not be auto-uploaded.

## Security

- Passwords are not stored in workspace settings (use private key authentication instead)
- Private key passphrases are stored in VSCode's secret storage
- All transfers use encrypted SFTP protocol

## Troubleshooting

### Connection Issues

1. Verify your SSH credentials are correct
2. Check if the server allows SSH connections from your IP
3. Try connecting with `ssh user@host` in a terminal first
4. Check the Output panel (FileSyncer channel) for detailed logs

### Permission Issues

- Ensure the remote user has write permissions to the remote path
- Check that local files are not read-only

### Large Files

- Large files may take time to transfer
- Progress is shown in notifications
- Check the Output panel for transfer status

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch

# Run tests
npm test

# Package extension
vsce package
```

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

MIT

## Credits

Inspired by PyCharm's deployment feature and built with:
- [ssh2-sftp-client](https://github.com/theophilusx/ssh2-sftp-client) - SFTP client
- [VSCode Extension API](https://code.visualstudio.com/api) - Extension platform
