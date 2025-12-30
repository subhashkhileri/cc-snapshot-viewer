/**
 * Types for Claude Code transcript parsing and snapshot management
 */

/** A single file backup reference from Claude's file-history */
export interface FileBackup {
  backupFileName: string;
  version: number;
  backupTime?: string;
}

/** Map of file paths to their backup info */
export interface TrackedFileBackups {
  [filePath: string]: FileBackup;
}

/** A file-history-snapshot entry from the transcript */
export interface FileHistorySnapshot {
  messageId: string;
  trackedFileBackups: TrackedFileBackups;
  timestamp: string;
}

/** A parsed prompt from the transcript */
export interface ParsedPrompt {
  promptNumber: number;
  messageId: string;
  parentMessageId: string | null;
  text: string;
  timestamp: Date;
  /** File snapshots BEFORE this prompt executed */
  beforeSnapshot: TrackedFileBackups;
  /** File snapshots AFTER this prompt executed */
  afterSnapshot: TrackedFileBackups;
  /** Tools used during this prompt */
  toolsUsed: string[];
  /** Files that were edited during this prompt (from toolUseResult) */
  editedFiles: Set<string>;
  /**
   * Original file contents before edits, extracted from toolUseResult.originalFile.
   * Key is the file path, value is the original content.
   */
  originalFileContents: Map<string, string>;
}

/** A file change detected between before/after snapshots */
export interface FileChange {
  filePath: string;
  changeType: 'modified' | 'added' | 'deleted';
  beforeBackup: FileBackup | null;
  afterBackup: FileBackup | null;
  promptNumber: number;
  promptText: string;
  /**
   * Original file content before any edits in this prompt.
   * This is extracted from toolUseResult.originalFile in the transcript.
   * Used when beforeBackup is null (first edit to a file in the session).
   */
  originalContent?: string;
}

/** A parsed session from a transcript file */
export interface ParsedSession {
  sessionId: string;
  projectPath: string;
  transcriptPath: string;
  prompts: ParsedPrompt[];
  lastUpdated: Date;
}

/** Raw transcript entry types we care about */
export interface TranscriptUserEntry {
  type: 'user';
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  sessionId: string;
  cwd: string;
  message: {
    role: 'user';
    content: string | Array<{ type: string; content?: string; tool_use_id?: string }>;
  };
}

export interface TranscriptFileHistoryEntry {
  type: 'file-history-snapshot';
  messageId: string;
  snapshot: FileHistorySnapshot;
  isSnapshotUpdate: boolean;
}

/** Tool use result entry (for Edit/Write tool results) */
export interface TranscriptToolResultEntry {
  type: 'user';
  uuid: string;
  parentUuid: string;
  toolUseResult?: {
    filePath: string;
    oldString?: string;
    newString?: string;
    originalFile?: string;
    structuredPatch?: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: string[];
    }>;
  };
}

export interface TranscriptAssistantEntry {
  type: 'assistant';
  uuid: string;
  parentUuid: string;
  message: {
    role: 'assistant';
    content: Array<{
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
}

export type TranscriptEntry =
  | TranscriptUserEntry
  | TranscriptFileHistoryEntry
  | TranscriptAssistantEntry
  | { type: string; [key: string]: unknown };
