import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ParsedSession,
  ParsedPrompt,
  FileChange,
  TrackedFileBackups,
  TranscriptEntry,
  TranscriptUserEntry,
  TranscriptFileHistoryEntry,
  TranscriptAssistantEntry,
} from './types';

/**
 * Parses Claude Code transcript files to extract prompts and file changes
 */
export class TranscriptParser {
  private claudeDir: string;

  constructor() {
    this.claudeDir = path.join(os.homedir(), '.claude');
  }

  /**
   * Find all transcript files for a given workspace path
   */
  findTranscriptsForWorkspace(workspacePath: string): string[] {
    const projectsDir = path.join(this.claudeDir, 'projects');
    if (!fs.existsSync(projectsDir)) {
      return [];
    }

    // Claude encodes paths by replacing / with -
    // e.g., /Users/UserName/Documents/tools becomes -Users-UserName-Documents-tools
    const encodedPath = workspacePath.replace(/\//g, '-');
    const projectDir = path.join(projectsDir, encodedPath);

    if (!fs.existsSync(projectDir)) {
      return [];
    }

    const files = fs.readdirSync(projectDir);
    return files
      .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
      .map(f => path.join(projectDir, f))
      .sort((a, b) => {
        // Sort by modification time, newest first
        const statA = fs.statSync(a);
        const statB = fs.statSync(b);
        return statB.mtime.getTime() - statA.mtime.getTime();
      });
  }

  /**
   * Parse a single transcript file
   */
  parseTranscript(transcriptPath: string): ParsedSession | null {
    if (!fs.existsSync(transcriptPath)) {
      return null;
    }

    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());

    const entries: TranscriptEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    if (entries.length === 0) {
      return null;
    }

    // Extract session metadata from first user entry
    let sessionId = '';
    let projectPath = '';
    const firstUser = entries.find(e => e.type === 'user' && 'sessionId' in e) as TranscriptUserEntry | undefined;
    if (firstUser) {
      sessionId = firstUser.sessionId;
      projectPath = firstUser.cwd;
    }

    // Build a set of UUIDs that are on the "active" conversation path.
    // When /rewind is used, the transcript becomes a tree with multiple branches.
    // We need to find the active path by tracing back from the last entry.
    const activeUuids = this.findActiveConversationPath(entries);

    // Build a map of messageId -> file-history-snapshot
    // Also track the latest snapshot (last one in the transcript)
    const snapshotMap = new Map<string, TrackedFileBackups>();
    let latestSnapshot: TrackedFileBackups = {};

    for (const entry of entries) {
      if (entry.type === 'file-history-snapshot') {
        const fhEntry = entry as TranscriptFileHistoryEntry;
        snapshotMap.set(fhEntry.messageId, fhEntry.snapshot.trackedFileBackups);
        // Keep updating - the last one will be the latest
        latestSnapshot = fhEntry.snapshot.trackedFileBackups;
      }
    }

    // Extract user prompts and correlate with snapshots
    const prompts: ParsedPrompt[] = [];
    let promptNumber = 0;

    // Track tools used per prompt and files edited per prompt
    const toolsPerPrompt = new Map<string, Set<string>>();
    const editedFilesPerPrompt = new Map<string, Set<string>>();

    // Track original file contents per prompt (extracted from toolUseResult.originalFile)
    const originalContentsPerPrompt = new Map<string, Map<string, string>>();

    // First pass: collect tool uses, edited files, and original file contents for each prompt
    for (const entry of entries) {
      if (entry.type === 'assistant') {
        const assistantEntry = entry as TranscriptAssistantEntry;
        const parentId = assistantEntry.parentUuid;

        if (assistantEntry.message?.content) {
          for (const content of assistantEntry.message.content) {
            if (content.type === 'tool_use' && content.name) {
              // Find the root user message for this assistant response
              let rootId = parentId;
              let current = entries.find(e => 'uuid' in e && e.uuid === parentId);
              while (current && current.type !== 'user') {
                rootId = (current as { parentUuid?: string }).parentUuid || rootId;
                current = entries.find(e => 'uuid' in e && e.uuid === rootId);
              }

              if (rootId) {
                if (!toolsPerPrompt.has(rootId)) {
                  toolsPerPrompt.set(rootId, new Set());
                }
                toolsPerPrompt.get(rootId)!.add(content.name);
              }
            }
          }
        }
      }

      // Track files edited via toolUseResult (Edit/Write tool results)
      // Also extract originalFile content for accurate diffs
      if (entry.type === 'user' && 'toolUseResult' in entry) {
        const toolResult = entry as {
          toolUseResult?: { filePath?: string; originalFile?: string };
          parentUuid?: string;
        };
        if (toolResult.toolUseResult?.filePath) {
          // Find the root prompt for this tool result
          let rootId = toolResult.parentUuid;
          let current = entries.find(e => 'uuid' in e && e.uuid === rootId);
          while (current && (current.type !== 'user' || typeof (current as TranscriptUserEntry).message?.content !== 'string')) {
            rootId = (current as { parentUuid?: string }).parentUuid || undefined;
            if (!rootId) break;
            current = entries.find(e => 'uuid' in e && e.uuid === rootId);
          }

          if (rootId) {
            if (!editedFilesPerPrompt.has(rootId)) {
              editedFilesPerPrompt.set(rootId, new Set());
            }
            editedFilesPerPrompt.get(rootId)!.add(toolResult.toolUseResult.filePath);

            // Extract original file content if available
            // This is crucial for showing accurate diffs on first edits
            if (toolResult.toolUseResult.originalFile !== undefined) {
              if (!originalContentsPerPrompt.has(rootId)) {
                originalContentsPerPrompt.set(rootId, new Map());
              }
              // Only store the first originalFile for each file path per prompt
              // (subsequent edits to the same file in the same prompt would have different original)
              const promptOriginals = originalContentsPerPrompt.get(rootId)!;
              if (!promptOriginals.has(toolResult.toolUseResult.filePath)) {
                promptOriginals.set(
                  toolResult.toolUseResult.filePath,
                  toolResult.toolUseResult.originalFile
                );
              }
            }
          }
        }
      }
    }

    // Second pass: build prompts list
    // The snapshot at each prompt represents the state WHEN that prompt was submitted
    // (BEFORE Claude acts on it). So:
    //   - beforeSnapshot for prompt N = snapshot at prompt N
    //   - afterSnapshot for prompt N = snapshot at prompt N+1
    for (const entry of entries) {
      if (entry.type === 'user') {
        const userEntry = entry as TranscriptUserEntry;

        // Skip tool results and meta messages
        if (typeof userEntry.message?.content !== 'string') {
          continue;
        }

        // Skip system/meta messages
        if ('isMeta' in userEntry && userEntry.isMeta) {
          continue;
        }

        // Skip prompts that are not on the active conversation path (rewound prompts)
        if (!activeUuids.has(userEntry.uuid)) {
          continue;
        }

        promptNumber++;
        const messageId = userEntry.uuid;

        // Get the snapshot taken at the start of this prompt (BEFORE Claude acts)
        const snapshotAtPrompt = snapshotMap.get(messageId) || {};

        const prompt: ParsedPrompt = {
          promptNumber,
          messageId,
          parentMessageId: userEntry.parentUuid,
          text: userEntry.message.content,
          timestamp: new Date(userEntry.timestamp),
          beforeSnapshot: { ...snapshotAtPrompt },
          afterSnapshot: {}, // Will be filled in by third pass
          toolsUsed: Array.from(toolsPerPrompt.get(messageId) || []),
          editedFiles: editedFilesPerPrompt.get(messageId) || new Set(),
          originalFileContents: originalContentsPerPrompt.get(messageId) || new Map(),
        };

        prompts.push(prompt);
      }
    }

    // Third pass: link afterSnapshot to the next prompt's beforeSnapshot
    // This shows what changed DURING each prompt's execution
    for (let i = 0; i < prompts.length; i++) {
      if (i < prompts.length - 1) {
        // After state = the before state of the NEXT prompt
        prompts[i].afterSnapshot = { ...prompts[i + 1].beforeSnapshot };
      } else {
        // For the last prompt, check file-history directory for latest versions
        // The transcript may not have the update yet, but file-history will
        const latestFromDisk = this.getLatestSnapshotFromDisk(sessionId, latestSnapshot);
        prompts[i].afterSnapshot = { ...latestFromDisk };
      }
    }

    // Get last modified time
    const stats = fs.statSync(transcriptPath);

    return {
      sessionId,
      projectPath,
      transcriptPath,
      prompts,
      lastUpdated: stats.mtime,
    };
  }

  /**
   * Get file changes for a specific prompt
   * @param prompt The prompt to get changes for
   * @param projectPath The project root path (used to resolve relative paths)
   */
  getFileChangesForPrompt(prompt: ParsedPrompt, projectPath?: string): FileChange[] {
    const changes: FileChange[] = [];
    const detectedFiles = new Set<string>();

    // Normalize file paths to prevent duplicates from path variations
    // Claude stores relative paths in snapshots but absolute paths in editedFiles
    const normalizeFilePath = (p: string): string => path.normalize(p);
    const getBasename = (p: string): string => path.basename(p);

    // Convert relative paths to absolute paths for VS Code compatibility
    const toAbsolutePath = (p: string): string => {
      if (path.isAbsolute(p)) {
        return path.normalize(p);
      }
      // If we have a project path, resolve relative to it
      if (projectPath) {
        return path.join(projectPath, p);
      }
      return p;
    };

    const allFiles = new Set([
      ...Object.keys(prompt.beforeSnapshot).map(normalizeFilePath),
      ...Object.keys(prompt.afterSnapshot).map(normalizeFilePath),
    ]);

    for (const filePath of allFiles) {
      // Find the backup entries (might have slight path variations)
      const before = prompt.beforeSnapshot[filePath] ||
        Object.entries(prompt.beforeSnapshot).find(([k]) => normalizeFilePath(k) === filePath)?.[1];
      const after = prompt.afterSnapshot[filePath] ||
        Object.entries(prompt.afterSnapshot).find(([k]) => normalizeFilePath(k) === filePath)?.[1];

      if (!before && after) {
        // File appears in afterSnapshot but not beforeSnapshot
        // This means it's the FIRST time Claude touched this file in this session.
        //
        // CORRECTION: The @v1 backup contains the state AFTER the first edit,
        // NOT the original content before the edit. The original content is
        // stored in toolUseResult.originalFile in the transcript.
        //
        // For accurate diffs, we use originalFileContents from the prompt.
        const absoluteFilePath = toAbsolutePath(filePath);

        // Try to find original content from toolUseResult
        // Check both the relative and absolute paths
        const originalContent = prompt.originalFileContents.get(filePath) ||
          prompt.originalFileContents.get(absoluteFilePath) ||
          Array.from(prompt.originalFileContents.entries()).find(
            ([k]) => normalizeFilePath(k) === filePath || getBasename(k) === getBasename(filePath)
          )?.[1];

        if (originalContent !== undefined) {
          // We have the original content - this is a modification of an existing file
          changes.push({
            filePath: absoluteFilePath,
            changeType: 'modified',
            beforeBackup: null,  // No backup file for original
            afterBackup: null,   // Compare with current file on disk
            promptNumber: prompt.promptNumber,
            promptText: prompt.text,
            originalContent,     // Use the extracted original content
          });
        } else {
          // No original content found - likely a new file creation
          changes.push({
            filePath: absoluteFilePath,
            changeType: 'added',
            beforeBackup: null,
            afterBackup: null,   // Compare with current file on disk
            promptNumber: prompt.promptNumber,
            promptText: prompt.text,
          });
        }
        detectedFiles.add(filePath);
        detectedFiles.add(absoluteFilePath);
        // Also add basename for matching with absolute paths from editedFiles
        detectedFiles.add(getBasename(filePath));
      } else if (before && !after) {
        // File was deleted
        const absoluteFilePath = toAbsolutePath(filePath);
        changes.push({
          filePath: absoluteFilePath,
          changeType: 'deleted',
          beforeBackup: before,
          afterBackup: null,
          promptNumber: prompt.promptNumber,
          promptText: prompt.text,
        });
        detectedFiles.add(filePath);
        detectedFiles.add(absoluteFilePath);
        detectedFiles.add(getBasename(filePath));
      } else if (before && after && before.version !== after.version) {
        // File was modified (version changed between snapshots)
        const absoluteFilePath = toAbsolutePath(filePath);
        changes.push({
          filePath: absoluteFilePath,
          changeType: 'modified',
          beforeBackup: before,
          afterBackup: after,
          promptNumber: prompt.promptNumber,
          promptText: prompt.text,
        });
        detectedFiles.add(filePath);
        detectedFiles.add(absoluteFilePath);
        detectedFiles.add(getBasename(filePath));
      }
    }

    // For files that were edited (from toolUseResult) but not detected via snapshots,
    // add them as modified. This handles the case where file-history hasn't been updated yet.
    for (const editedFile of prompt.editedFiles) {
      const normalizedEditedFile = normalizeFilePath(editedFile);
      const editedBasename = getBasename(editedFile);

      // Check both full path and basename to handle relative vs absolute path differences
      if (!detectedFiles.has(normalizedEditedFile) && !detectedFiles.has(editedBasename)) {
        const backup = prompt.beforeSnapshot[editedFile] ||
          prompt.beforeSnapshot[editedBasename] ||
          Object.entries(prompt.beforeSnapshot).find(([k]) =>
            normalizeFilePath(k) === normalizedEditedFile || getBasename(k) === editedBasename
          )?.[1];

        // Try to get original content from the transcript
        const originalContent = prompt.originalFileContents.get(editedFile) ||
          prompt.originalFileContents.get(normalizedEditedFile) ||
          Array.from(prompt.originalFileContents.entries()).find(
            ([k]) => normalizeFilePath(k) === normalizedEditedFile || getBasename(k) === editedBasename
          )?.[1];

        changes.push({
          filePath: normalizedEditedFile,
          changeType: (backup || originalContent !== undefined) ? 'modified' : 'added',
          beforeBackup: backup || null,
          afterBackup: null, // Compare with current file on disk
          promptNumber: prompt.promptNumber,
          promptText: prompt.text,
          originalContent: !backup ? originalContent : undefined,
        });
        detectedFiles.add(normalizedEditedFile);
        detectedFiles.add(editedBasename);
      }
    }

    return changes;
  }

  /**
   * Get the path to a backup file in file-history
   */
  getBackupFilePath(sessionId: string, backupFileName: string): string {
    return path.join(this.claudeDir, 'file-history', sessionId, backupFileName);
  }

  /**
   * Read content from a backup file
   */
  readBackupFile(sessionId: string, backupFileName: string): string | null {
    const backupPath = this.getBackupFilePath(sessionId, backupFileName);
    if (!fs.existsSync(backupPath)) {
      return null;
    }
    return fs.readFileSync(backupPath, 'utf-8');
  }

  /**
   * Get the latest snapshot by checking the file-history directory on disk.
   * This is needed because the transcript may not have the latest isSnapshotUpdate entry
   * for the most recent prompt.
   */
  private getLatestSnapshotFromDisk(
    sessionId: string,
    baseSnapshot: TrackedFileBackups
  ): TrackedFileBackups {
    const result: TrackedFileBackups = { ...baseSnapshot };
    const historyDir = path.join(this.claudeDir, 'file-history', sessionId);

    if (!fs.existsSync(historyDir)) {
      return result;
    }

    try {
      const files = fs.readdirSync(historyDir);

      // Group files by their hash (before @vN)
      const filesByHash = new Map<string, { version: number; fileName: string }[]>();

      for (const file of files) {
        const match = file.match(/^(.+)@v(\d+)$/);
        if (match) {
          const hash = match[1];
          const version = parseInt(match[2], 10);

          if (!filesByHash.has(hash)) {
            filesByHash.set(hash, []);
          }
          filesByHash.get(hash)!.push({ version, fileName: file });
        }
      }

      // For each file in the base snapshot, check if there's a newer version on disk
      for (const [filePath, backup] of Object.entries(result)) {
        // Skip entries with missing backup file name
        if (!backup || !backup.backupFileName) continue;

        // Extract hash from backup file name
        const hashMatch = backup.backupFileName.match(/^(.+)@v\d+$/);
        if (!hashMatch) continue;

        const hash = hashMatch[0].split('@')[0];
        const versions = filesByHash.get(hash);

        if (versions && versions.length > 0) {
          // Find the highest version
          const latest = versions.reduce((max, curr) =>
            curr.version > max.version ? curr : max
          );

          // If there's a newer version than what's in the snapshot, use it
          if (latest.version > backup.version) {
            result[filePath] = {
              ...backup,
              backupFileName: latest.fileName,
              version: latest.version,
            };
          }
        }
      }
    } catch (error) {
      // If we can't read the directory, just return the base snapshot
      console.error('Error reading file-history directory:', error);
    }

    return result;
  }

  /**
   * Find the UUIDs of all entries on the active conversation path.
   * When /rewind is used, the transcript becomes a tree structure with multiple branches.
   * This method finds the "active" path by:
   * 1. Starting from the last entry in the transcript
   * 2. Walking backwards through parentUuid links to the root
   * 3. Returning all UUIDs on this path
   */
  private findActiveConversationPath(entries: TranscriptEntry[]): Set<string> {
    const activeUuids = new Set<string>();

    // Helper to safely get uuid as string
    const getUuid = (entry: TranscriptEntry): string | null => {
      if ('uuid' in entry && typeof entry.uuid === 'string' && entry.uuid) {
        return entry.uuid;
      }
      return null;
    };

    // Helper to safely get parentUuid as string
    const getParentUuid = (entry: TranscriptEntry): string | null => {
      if ('parentUuid' in entry && typeof entry.parentUuid === 'string' && entry.parentUuid) {
        return entry.parentUuid;
      }
      return null;
    };

    // Build a map of uuid -> entry for quick lookup
    const entryByUuid = new Map<string, TranscriptEntry>();
    for (const entry of entries) {
      const uuid = getUuid(entry);
      if (uuid) {
        entryByUuid.set(uuid, entry);
      }
    }

    // Find the last entry with a uuid (this is the current HEAD of the conversation)
    let lastEntry: TranscriptEntry | undefined;
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (getUuid(entry)) {
        lastEntry = entry;
        break;
      }
    }

    if (!lastEntry) {
      // No entries with UUIDs, return empty set (all prompts will be shown)
      return activeUuids;
    }

    // Walk backwards from the last entry, collecting all UUIDs on the active path
    let current: TranscriptEntry | undefined = lastEntry;
    while (current) {
      const uuid = getUuid(current);
      if (uuid) {
        activeUuids.add(uuid);
      }

      // Move to parent
      const parentUuid = getParentUuid(current);
      if (parentUuid) {
        current = entryByUuid.get(parentUuid);
      } else {
        break;
      }
    }

    return activeUuids;
  }
}
