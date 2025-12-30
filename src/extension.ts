import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeScmProvider } from './claudeScmProvider';
import {
  SnapshotFileSystemProvider,
  SnapshotContentProvider,
  EmptyContentProvider,
  OriginalContentProvider,
} from './snapshotFileSystemProvider';

let scmProviders: ClaudeScmProvider[] = [];
let fileWatchers: fs.FSWatcher[] = [];

/**
 * Extension activation
 *
 * This extension activates when a workspace contains a .claude directory,
 * indicating it's been used with Claude Code.
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Claude Snapshots extension activating...');

  // Register file system provider for reading backup files (for vscode.diff)
  const snapshotFsProvider = new SnapshotFileSystemProvider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('claude-snapshot', snapshotFsProvider, {
      isReadonly: true,
    })
  );

  // Also register text document content providers as fallback
  const snapshotContentProvider = new SnapshotContentProvider();
  const emptyContentProvider = new EmptyContentProvider();
  const originalContentProvider = new OriginalContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('claude-snapshot-text', snapshotContentProvider),
    vscode.workspace.registerTextDocumentContentProvider('claude-empty', emptyContentProvider),
    vscode.workspace.registerTextDocumentContentProvider('claude-original', originalContentProvider)
  );

  // Create SCM providers for each workspace folder
  const workspaceFolders = vscode.workspace.workspaceFolders || [];

  for (const folder of workspaceFolders) {
    const provider = new ClaudeScmProvider(folder, snapshotFsProvider);
    scmProviders.push(provider);
    context.subscriptions.push(provider);

    // Set up file watcher for this workspace's transcript directory
    setupTranscriptWatcher(folder.uri.fsPath);
  }

  // Watch for workspace folder changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(event => {
      // Add providers for new folders
      for (const folder of event.added) {
        const provider = new ClaudeScmProvider(folder, snapshotFsProvider);
        scmProviders.push(provider);
        context.subscriptions.push(provider);
        setupTranscriptWatcher(folder.uri.fsPath);
      }

      // Remove providers for removed folders
      for (const folder of event.removed) {
        const index = scmProviders.findIndex(
          p => p['workspaceFolder'].uri.toString() === folder.uri.toString()
        );
        if (index !== -1) {
          scmProviders[index].dispose();
          scmProviders.splice(index, 1);
        }
      }
    })
  );

  console.log('Claude Snapshots extension activated');
}

/**
 * Set up a file watcher for the transcript directory
 * Uses Node.js fs.watch for reliable watching outside workspace
 */
function setupTranscriptWatcher(workspacePath: string): void {
  const claudeDir = path.join(os.homedir(), '.claude');
  const encodedPath = workspacePath.replace(/\//g, '-');
  const projectDir = path.join(claudeDir, 'projects', encodedPath);

  if (!fs.existsSync(projectDir)) {
    console.log(`Claude Snapshots: No transcript directory found at ${projectDir}`);
    return;
  }

  try {
    // Debounce the refresh to avoid too many updates
    let refreshTimeout: NodeJS.Timeout | null = null;
    const debouncedRefresh = () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      refreshTimeout = setTimeout(() => {
        console.log('Claude Snapshots: Transcript changed, refreshing...');
        refreshAllProviders();
      }, 500); // 500ms debounce
    };

    const watcher = fs.watch(projectDir, { persistent: false }, (eventType, filename) => {
      if (filename && filename.endsWith('.jsonl')) {
        debouncedRefresh();
      }
    });

    fileWatchers.push(watcher);
    console.log(`Claude Snapshots: Watching ${projectDir} for changes`);
  } catch (error) {
    console.error(`Claude Snapshots: Failed to watch ${projectDir}:`, error);
  }
}

/**
 * Refresh all SCM providers
 */
function refreshAllProviders(): void {
  for (const provider of scmProviders) {
    provider.refresh();
  }
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  // Close file watchers
  for (const watcher of fileWatchers) {
    watcher.close();
  }
  fileWatchers = [];

  for (const provider of scmProviders) {
    provider.dispose();
  }
  scmProviders = [];
}
