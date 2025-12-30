import * as vscode from 'vscode';
import * as path from 'path';
import { TranscriptParser } from './transcriptParser';
import { ParsedSession, ParsedPrompt, FileChange } from './types';
import { OriginalContentProvider } from './snapshotFileSystemProvider';

/**
 * VS Code Source Control provider for Claude Code snapshots
 * Makes Claude prompts appear like "commits" in the Source Control tab
 */
export class ClaudeScmProvider implements vscode.Disposable {
  private scm: vscode.SourceControl;
  private parser: TranscriptParser;
  private session: ParsedSession | null = null;
  private resourceGroupsMap: Map<string, vscode.SourceControlResourceGroup> = new Map();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private workspaceFolder: vscode.WorkspaceFolder,
    private fileSystemProvider: vscode.FileSystemProvider
  ) {
    this.parser = new TranscriptParser();

    // Create the Source Control instance
    // Format: "Snapshots - [workspace name]"
    const label = `Snapshots - ${workspaceFolder.name}`;
    this.scm = vscode.scm.createSourceControl(
      'claude-snapshots',
      label
    );
    this.scm.inputBox.placeholder = 'CC Snapshot Viewer (read-only)';
    this.scm.inputBox.visible = false;

    // Set up quick diff (optional, for gutter indicators)
    this.scm.quickDiffProvider = undefined;

    // Register commands
    this.disposables.push(
      vscode.commands.registerCommand('claude-snapshots.refresh', () => this.refresh()),
      vscode.commands.registerCommand('claude-snapshots.openDiff', (resource: ClaudeResourceState) =>
        this.openDiff(resource)
      ),
      vscode.commands.registerCommand('claude-snapshots.compareWithCurrent', (resource: ClaudeResourceState) =>
        this.compareWithCurrent(resource)
      )
    );

    // Initial load
    this.refresh();
  }

  /**
   * Refresh the snapshot data from transcripts
   */
  async refresh(): Promise<void> {
    // Find and parse transcripts
    const transcripts = this.parser.findTranscriptsForWorkspace(
      this.workspaceFolder.uri.fsPath
    );

    if (transcripts.length === 0) {
      this.disposeAllGroups();
      return;
    }

    // Use the most recent transcript
    const session = this.parser.parseTranscript(transcripts[0]);
    if (!session || session.prompts.length === 0) {
      this.disposeAllGroups();
      return;
    }

    this.session = session;

    // Track which group IDs we need for this refresh
    const neededGroupIds = new Set<string>();

    // Create resource groups for each prompt (in reverse order - newest first)
    const promptsToShow = [...session.prompts].reverse();

    for (const prompt of promptsToShow) {
      const changes = this.parser.getFileChangesForPrompt(prompt, session.projectPath);

      // Skip prompts with no file changes
      if (changes.length === 0) {
        continue;
      }

      const groupId = `prompt-${prompt.promptNumber}`;
      neededGroupIds.add(groupId);

      // Build new resource states
      const newResourceStates = changes.map(change =>
        this.createResourceState(change, session.sessionId)
      );

      // Check if group already exists
      const existingGroup = this.resourceGroupsMap.get(groupId);
      if (existingGroup) {
        // Update existing group's resource states only (no flicker)
        existingGroup.resourceStates = newResourceStates;
      } else {
        // Create new group only for new prompts
        const displayText = this.truncateText(prompt.text, 40);
        const groupLabel = `#${prompt.promptNumber}: "${displayText}" (${changes.length} file${changes.length !== 1 ? 's' : ''})`;

        const group = this.scm.createResourceGroup(groupId, groupLabel);
        group.hideWhenEmpty = true;
        group.resourceStates = newResourceStates;
        this.resourceGroupsMap.set(groupId, group);
      }
    }

    // Dispose groups that are no longer needed
    for (const [groupId, group] of this.resourceGroupsMap) {
      if (!neededGroupIds.has(groupId)) {
        group.dispose();
        this.resourceGroupsMap.delete(groupId);
      }
    }
  }

  /**
   * Dispose all resource groups
   */
  private disposeAllGroups(): void {
    for (const group of this.resourceGroupsMap.values()) {
      group.dispose();
    }
    this.resourceGroupsMap.clear();
  }

  /**
   * Create a resource state for a file change
   */
  private createResourceState(change: FileChange, sessionId: string): ClaudeResourceState {
    const uri = vscode.Uri.file(change.filePath);

    // Build tooltip with change type indicator
    let prefix: string;
    let tooltip: string;

    switch (change.changeType) {
      case 'added':
        prefix = '[A]';
        tooltip = 'Added';
        break;
      case 'deleted':
        prefix = '[D]';
        tooltip = 'Deleted';
        break;
      case 'modified':
      default:
        prefix = '[M]';
        tooltip = 'Modified';
        break;
    }

    return {
      resourceUri: uri,
      contextValue: 'claudeSnapshotResource',
      decorations: {
        strikeThrough: change.changeType === 'deleted',
        tooltip: `${prefix} ${tooltip} in prompt #${change.promptNumber}`,
        faded: false,
      },
      // Custom data for diff commands
      change,
      sessionId,
      command: {
        command: 'claude-snapshots.openDiff',
        title: 'View Changes',
        arguments: [{ resourceUri: uri, change, sessionId }],
      },
    };
  }

  /**
   * Open a diff view for a file change
   */
  private async openDiff(resource: ClaudeResourceState): Promise<void> {
    const { change, sessionId } = resource;

    if (change.changeType === 'added') {
      // For added files, show the new content vs empty
      const emptyUri = vscode.Uri.parse(`claude-empty:/${path.basename(change.filePath)}`);

      if (change.afterBackup) {
        // We have a backup - show empty vs backup
        const afterUri = vscode.Uri.parse(
          `claude-snapshot:/${sessionId}/${change.afterBackup.backupFileName}?path=${encodeURIComponent(change.filePath)}`
        );
        await vscode.commands.executeCommand(
          'vscode.diff',
          emptyUri,
          afterUri,
          `${path.basename(change.filePath)} (Added in #${change.promptNumber})`
        );
      } else {
        // No backup yet - show empty vs current file on disk
        const currentUri = vscode.Uri.file(change.filePath);
        await vscode.commands.executeCommand(
          'vscode.diff',
          emptyUri,
          currentUri,
          `${path.basename(change.filePath)} (Added in #${change.promptNumber} - vs current)`
        );
      }
    } else if (change.changeType === 'deleted') {
      // For deleted files, show what was removed vs empty
      if (change.beforeBackup) {
        const beforeUri = vscode.Uri.parse(
          `claude-snapshot:/${sessionId}/${change.beforeBackup.backupFileName}?path=${encodeURIComponent(change.filePath)}`
        );
        // Use our empty content provider
        const emptyUri = vscode.Uri.parse(`claude-empty:/${path.basename(change.filePath)}`);
        await vscode.commands.executeCommand(
          'vscode.diff',
          beforeUri,
          emptyUri,
          `${path.basename(change.filePath)} (Deleted in #${change.promptNumber})`
        );
      }
    } else {
      // For modified files, show before vs after
      // Check if we have originalContent (for first edits where we don't have a backup)
      // Use truthy check since originalContent could be null from transcript data
      if (change.originalContent != null && change.originalContent !== '') {
        // Use the original content extracted from the transcript
        const beforeUri = OriginalContentProvider.createUri(
          change.originalContent,
          change.filePath
        );
        const currentUri = vscode.Uri.file(change.filePath);
        await vscode.commands.executeCommand(
          'vscode.diff',
          beforeUri,
          currentUri,
          `${path.basename(change.filePath)} (Prompt #${change.promptNumber})`
        );
      } else if (change.beforeBackup && change.afterBackup) {
        const beforeUri = vscode.Uri.parse(
          `claude-snapshot:/${sessionId}/${change.beforeBackup.backupFileName}?path=${encodeURIComponent(change.filePath)}`
        );

        // If before and after are the same backup (file-history not updated yet),
        // compare the backup with the current file on disk
        if (change.beforeBackup.backupFileName === change.afterBackup.backupFileName) {
          const currentUri = vscode.Uri.file(change.filePath);
          await vscode.commands.executeCommand(
            'vscode.diff',
            beforeUri,
            currentUri,
            `${path.basename(change.filePath)} (Prompt #${change.promptNumber} - vs current)`
          );
        } else {
          const afterUri = vscode.Uri.parse(
            `claude-snapshot:/${sessionId}/${change.afterBackup.backupFileName}?path=${encodeURIComponent(change.filePath)}`
          );
          await vscode.commands.executeCommand(
            'vscode.diff',
            beforeUri,
            afterUri,
            `${path.basename(change.filePath)} (Prompt #${change.promptNumber})`
          );
        }
      } else if (change.beforeBackup) {
        // We have a before backup but no after - compare with current file
        const beforeUri = vscode.Uri.parse(
          `claude-snapshot:/${sessionId}/${change.beforeBackup.backupFileName}?path=${encodeURIComponent(change.filePath)}`
        );
        const currentUri = vscode.Uri.file(change.filePath);
        await vscode.commands.executeCommand(
          'vscode.diff',
          beforeUri,
          currentUri,
          `${path.basename(change.filePath)} (Prompt #${change.promptNumber} - vs current)`
        );
      } else {
        // No backups at all - just open the current file
        const currentUri = vscode.Uri.file(change.filePath);
        await vscode.commands.executeCommand('vscode.open', currentUri);
      }
    }
  }

  /**
   * Compare a snapshot version with the current file
   */
  private async compareWithCurrent(resource: ClaudeResourceState): Promise<void> {
    const { change, sessionId } = resource;
    const backup = change.afterBackup || change.beforeBackup;

    if (!backup) {
      return;
    }

    const snapshotUri = vscode.Uri.parse(
      `claude-snapshot:/${sessionId}/${backup.backupFileName}?path=${encodeURIComponent(change.filePath)}`
    );
    const currentUri = vscode.Uri.file(change.filePath);

    await vscode.commands.executeCommand(
      'vscode.diff',
      snapshotUri,
      currentUri,
      `${path.basename(change.filePath)} (Snapshot vs Current)`
    );
  }

  /**
   * Truncate text for display
   */
  private truncateText(text: string, maxLength: number): string {
    // Remove newlines and normalize whitespace
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.substring(0, maxLength - 3) + '...';
  }

  dispose(): void {
    this.disposeAllGroups();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.scm.dispose();
  }
}

/**
 * Extended resource state with Claude-specific data
 */
interface ClaudeResourceState extends vscode.SourceControlResourceState {
  change: FileChange;
  sessionId: string;
}
