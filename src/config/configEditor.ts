import * as vscode from 'vscode';
import { ProfileManager, ServerProfile } from './profileManager';
import { ConfigManager } from './configManager';

export class ConfigEditorProvider {
  private static instance: ConfigEditorProvider;
  private panel?: vscode.WebviewPanel;
  private profileManager: ProfileManager;
  private configManager: ConfigManager;
  private disposables: vscode.Disposable[] = [];

  private constructor() {
    this.profileManager = ProfileManager.getInstance();
    this.configManager = ConfigManager.getInstance();
  }

  static getInstance(): ConfigEditorProvider {
    if (!ConfigEditorProvider.instance) {
      ConfigEditorProvider.instance = new ConfigEditorProvider();
    }
    return ConfigEditorProvider.instance;
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'filesyncer.configEditor',
      'Server Configuration',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = this.getWebviewContent();

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.disposables.forEach(d => d.dispose());
    }, null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      async message => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );

    this.sendProfiles();
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case 'getProfiles':
        this.sendProfiles();
        break;

      case 'addProfile':
        await this.addProfile(message.profile);
        break;

      case 'updateProfile':
        await this.updateProfile(message.oldName, message.profile);
        break;

      case 'deleteProfile':
        await this.deleteProfile(message.name);
        break;

      case 'testConnection':
        await this.testConnection(message.profile);
        break;

      case 'setActiveProfile':
        await this.setActiveProfile(message.name);
        break;
    }
  }

  private sendProfiles(): void {
    if (!this.panel) {
      return;
    }

    const profiles = this.profileManager.getProfiles();
    const activeProfile = this.profileManager.getActiveProfile();

    this.panel.webview.postMessage({
      command: 'profiles',
      profiles,
      activeProfile: activeProfile?.name || ''
    });
  }

  private async addProfile(profileData: ServerProfile): Promise<void> {
    const validation = this.configManager.validateProfile(profileData);
    if (!validation.valid) {
      this.panel?.webview.postMessage({
        command: 'error',
        message: validation.error
      });
      return;
    }

    await this.profileManager.addProfile(profileData);
    this.sendProfiles();
    vscode.window.showInformationMessage(`Profile "${profileData.name}" added`);
  }

  private async updateProfile(oldName: string, profileData: ServerProfile): Promise<void> {
    const validation = this.configManager.validateProfile(profileData);
    if (!validation.valid) {
      this.panel?.webview.postMessage({
        command: 'error',
        message: validation.error
      });
      return;
    }

    if (oldName !== profileData.name) {
      await this.profileManager.removeProfile(oldName);
    }
    await this.profileManager.addProfile(profileData);
    this.sendProfiles();
    vscode.window.showInformationMessage(`Profile "${profileData.name}" updated`);
  }

  private async deleteProfile(name: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Are you sure you want to delete profile "${name}"?`,
      { modal: true },
      'Delete',
      'Cancel'
    );

    if (confirm === 'Delete') {
      await this.profileManager.removeProfile(name);
      this.sendProfiles();
      vscode.window.showInformationMessage(`Profile "${name}" deleted`);
    }
  }

  private async testConnection(profileData: ServerProfile): Promise<void> {
    try {
      const { SFTPManager } = await import('../sftp/sftpManager');
      const sftpManager = SFTPManager.getInstance();

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Testing connection to ${profileData.name}...`,
        cancellable: false
      }, async () => {
        await sftpManager.connect(profileData.name);
        await sftpManager.disconnect(profileData.name);
      });

      this.panel?.webview.postMessage({
        command: 'testResult',
        profile: profileData.name,
        success: true,
        message: 'Connection successful'
      });
    } catch (error) {
      this.panel?.webview.postMessage({
        command: 'testResult',
        profile: profileData.name,
        success: false,
        message: String(error)
      });
    }
  }

  private async setActiveProfile(name: string): Promise<void> {
    await this.profileManager.setActiveProfile(name);
    this.sendProfiles();
    vscode.window.showInformationMessage(`Active profile set to "${name}"`);
  }

  private getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Server Configuration</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px;
      margin: 0;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }

    h1 {
      margin: 0;
      font-size: 24px;
      color: var(--vscode-foreground);
    }

    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      cursor: pointer;
      font-size: 13px;
      border-radius: 2px;
    }

    .btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .btn-danger {
      background: var(--vscode-errorBackground);
      color: var(--vscode-errorForeground);
    }

    .btn-small {
      padding: 4px 8px;
      font-size: 12px;
    }

    .profile-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .profile-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 16px;
      background: var(--vscode-editor-background);
      transition: border-color 0.2s;
    }

    .profile-item.active {
      border-color: var(--vscode-textLink-foreground);
      border-width: 2px;
    }

    .profile-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .profile-name {
      font-size: 18px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .profile-badge {
      background: var(--vscode-textLink-foreground);
      color: var(--vscode-button-background);
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      text-transform: uppercase;
    }

    .profile-info {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      margin-bottom: 12px;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }

    .profile-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }

    .modal.show {
      display: flex;
    }

    .modal-content {
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 24px;
      width: 100%;
      max-width: 500px;
      max-height: 80vh;
      overflow-y: auto;
    }

    .modal-header {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 20px;
    }

    .form-group {
      margin-bottom: 16px;
    }

    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--vscode-foreground);
    }

    .form-group input,
    .form-group select {
      width: 100%;
      padding: 8px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      color: var(--vscode-input-foreground);
      border-radius: 2px;
      font-size: 13px;
      box-sizing: border-box;
    }

    .form-group input:focus,
    .form-group select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }

    .form-group input[type="checkbox"] {
      width: auto;
      margin-right: 8px;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }

    .test-result {
      margin-top: 8px;
      padding: 8px 12px;
      border-radius: 3px;
      font-size: 13px;
      display: none;
    }

    .test-result.success {
      background: var(--vscode-terminal-ansiGreen);
      color: var(--vscode-terminal-background);
      display: block;
    }

    .test-result.error {
      background: var(--vscode-terminal-ansiRed);
      color: var(--vscode-terminal-background);
      display: block;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--vscode-descriptionForeground);
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Server Configuration</h1>
      <button class="btn" onclick="showAddModal()">Add Profile</button>
    </div>

    <div id="profileList" class="profile-list"></div>

    <div id="emptyState" class="empty-state" style="display: none;">
      <div class="empty-state-icon">📡</div>
      <h2>No Server Profiles</h2>
      <p>Create a server profile to start syncing files</p>
      <button class="btn" onclick="showAddModal()">Add Your First Profile</button>
    </div>
  </div>

  <div id="profileModal" class="modal">
    <div class="modal-content">
      <div class="modal-header" id="modalTitle">Add Profile</div>
      <form id="profileForm" onsubmit="saveProfile(event)">
        <input type="hidden" id="oldName" value="">

        <div class="form-group">
          <label for="name">Profile Name *</label>
          <input type="text" id="name" required placeholder="e.g., Production">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="host">Host *</label>
            <input type="text" id="host" required placeholder="e.g., example.com">
          </div>

          <div class="form-group">
            <label for="port">Port</label>
            <input type="number" id="port" value="22" min="1" max="65535">
          </div>
        </div>

        <div class="form-group">
          <label for="username">Username *</label>
          <input type="text" id="username" required placeholder="e.g., deploy">
        </div>

        <div class="form-group">
          <label>Authentication Method</label>
          <select id="authMethod" onchange="toggleAuthFields()">
            <option value="key">Private Key (Recommended)</option>
            <option value="password">Password</option>
          </select>
        </div>

        <div id="keyAuthFields">
          <div class="form-group">
            <label for="privateKeyPath">Private Key Path</label>
            <input type="text" id="privateKeyPath" placeholder="~/.ssh/id_rsa">
          </div>

          <div class="form-group">
            <label for="passphrase">Passphrase (Optional)</label>
            <input type="password" id="passphrase" placeholder="Leave empty if no passphrase">
          </div>
        </div>

        <div id="passwordAuthFields" style="display: none;">
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" placeholder="Enter password">
          </div>
        </div>

        <div class="form-group">
          <label for="remotePath">Remote Path *</label>
          <input type="text" id="remotePath" required placeholder="e.g., /var/www/html">
        </div>

        <div class="form-group">
          <label for="exclude">Exclude Patterns (one per line)</label>
          <input type="text" id="exclude" placeholder="node_modules/**, .git/**, *.log">
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="hideModal()">Cancel</button>
          <button type="button" class="btn btn-secondary" onclick="testConnectionFromModal()">Test Connection</button>
          <button type="submit" class="btn">Save</button>
        </div>

        <div id="testResult" class="test-result"></div>
      </form>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let profiles = [];
    let activeProfile = '';

    // Listen for messages from extension
    window.addEventListener('message', event => {
      const message = event.data;

      switch (message.command) {
        case 'profiles':
          profiles = message.profiles;
          activeProfile = message.activeProfile;
          renderProfiles();
          break;
        case 'error':
          showError(message.message);
          break;
        case 'testResult':
          showTestResult(message.success, message.message);
          break;
      }
    });

    // Request profiles on load
    vscode.postMessage({ command: 'getProfiles' });

    function renderProfiles() {
      const listEl = document.getElementById('profileList');
      const emptyEl = document.getElementById('emptyState');

      if (profiles.length === 0) {
        listEl.style.display = 'none';
        emptyEl.style.display = 'block';
        return;
      }

      listEl.style.display = 'flex';
      emptyEl.style.display = 'none';

      listEl.innerHTML = profiles.map(function(profile) {
        const isActive = profile.name === activeProfile ? 'active' : '';
        const badge = profile.name === activeProfile ? '<span class="profile-badge">Active</span>' : '';
        const activeBtn = profile.name === activeProfile ? 'Active' : 'Set Active';

        return '' +
          '<div class="profile-item ' + isActive + '">' +
            '<div class="profile-header">' +
              '<div>' +
                '<span class="profile-name">' + escapeHtml(profile.name) + '</span>' +
                badge +
              '</div>' +
              '<div class="profile-actions">' +
                '<button class="btn btn-secondary btn-small" onclick="setActive(\\'' + escapeHtml(profile.name) + '\\')">' + activeBtn + '</button>' +
                '<button class="btn btn-secondary btn-small" onclick="editProfile(\\'' + escapeHtml(profile.name) + '\\')">Edit</button>' +
                '<button class="btn btn-danger btn-small" onclick="deleteProfile(\\'' + escapeHtml(profile.name) + '\\')">Delete</button>' +
              '</div>' +
            '</div>' +
            '<div class="profile-info">' +
              '<div>🖥️ ' + escapeHtml(profile.username) + '@' + escapeHtml(profile.host) + ':' + (profile.port || 22) + '</div>' +
              '<div>📁 ' + escapeHtml(profile.remotePath) + '</div>' +
            '</div>' +
          '</div>';
      }).join('');
    }

    function showAddModal() {
      document.getElementById('modalTitle').textContent = 'Add Profile';
      document.getElementById('profileForm').reset();
      document.getElementById('oldName').value = '';
      document.getElementById('port').value = '22';
      document.getElementById('authMethod').value = 'key';
      toggleAuthFields();
      document.getElementById('testResult').style.display = 'none';
      document.getElementById('profileModal').classList.add('show');
    }

    function editProfile(name) {
      const profile = profiles.find(p => p.name === name);
      if (!profile) return;

      document.getElementById('modalTitle').textContent = 'Edit Profile';
      document.getElementById('oldName').value = name;
      document.getElementById('name').value = profile.name;
      document.getElementById('host').value = profile.host;
      document.getElementById('port').value = profile.port || 22;
      document.getElementById('username').value = profile.username;
      document.getElementById('remotePath').value = profile.remotePath;
      document.getElementById('exclude').value = (profile.exclude || []).join(', ');

      if (profile.password) {
        document.getElementById('authMethod').value = 'password';
        document.getElementById('password').value = profile.password;
      } else {
        document.getElementById('authMethod').value = 'key';
        document.getElementById('privateKeyPath').value = profile.privateKeyPath || '';
        document.getElementById('passphrase').value = profile.passphrase || '';
      }

      toggleAuthFields();
      document.getElementById('testResult').style.display = 'none';
      document.getElementById('profileModal').classList.add('show');
    }

    function hideModal() {
      document.getElementById('profileModal').classList.remove('show');
    }

    function toggleAuthFields() {
      const method = document.getElementById('authMethod').value;
      document.getElementById('keyAuthFields').style.display = method === 'key' ? 'block' : 'none';
      document.getElementById('passwordAuthFields').style.display = method === 'password' ? 'block' : 'none';
    }

    function saveProfile(event) {
      event.preventDefault();

      const authMethod = document.getElementById('authMethod').value;
      const excludeStr = document.getElementById('exclude').value;
      const exclude = excludeStr ? excludeStr.split(',').map(s => s.trim()).filter(s => s) : ['node_modules/**', '.git/**', '*.log'];

      const profile = {
        name: document.getElementById('name').value.trim(),
        host: document.getElementById('host').value.trim(),
        port: parseInt(document.getElementById('port').value) || 22,
        username: document.getElementById('username').value.trim(),
        remotePath: document.getElementById('remotePath').value.trim(),
        exclude
      };

      if (authMethod === 'password') {
        profile.password = document.getElementById('password').value;
      } else {
        profile.privateKeyPath = document.getElementById('privateKeyPath').value.trim();
        profile.passphrase = document.getElementById('passphrase').value;
      }

      const oldName = document.getElementById('oldName').value;
      const command = oldName ? 'updateProfile' : 'addProfile';

      vscode.postMessage({
        command,
        oldName,
        profile
      });

      hideModal();
    }

    function deleteProfile(name) {
      if (confirm(\`Are you sure you want to delete profile "\${name}"?\`)) {
        vscode.postMessage({ command: 'deleteProfile', name });
      }
    }

    function setActive(name) {
      vscode.postMessage({ command: 'setActiveProfile', name });
    }

    function testConnectionFromModal() {
      const authMethod = document.getElementById('authMethod').value;
      const excludeStr = document.getElementById('exclude').value;
      const exclude = excludeStr ? excludeStr.split(',').map(s => s.trim()).filter(s => s) : [];

      const profile = {
        name: document.getElementById('name').value.trim() || 'Test',
        host: document.getElementById('host').value.trim(),
        port: parseInt(document.getElementById('port').value) || 22,
        username: document.getElementById('username').value.trim(),
        remotePath: document.getElementById('remotePath').value.trim() || '/tmp',
        exclude
      };

      if (authMethod === 'password') {
        profile.password = document.getElementById('password').value;
      } else {
        profile.privateKeyPath = document.getElementById('privateKeyPath').value.trim();
        profile.passphrase = document.getElementById('passphrase').value;
      }

      document.getElementById('testResult').style.display = 'none';
      vscode.postMessage({ command: 'testConnection', profile });
    }

    function showTestResult(success, message) {
      const resultEl = document.getElementById('testResult');
      resultEl.textContent = message;
      resultEl.className = 'test-result ' + (success ? 'success' : 'error');
      resultEl.style.display = 'block';
    }

    function showError(message) {
      alert(message);
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  </script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
