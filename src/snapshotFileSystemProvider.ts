import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Text document content provider for reading Claude Code backup files
 *
 * Handles URIs in the format:
 *   claude-snapshot:/{sessionId}/{backupFileName}?path={originalFilePath}
 *
 * This is simpler than FileSystemProvider for read-only content.
 */
export class SnapshotContentProvider implements vscode.TextDocumentContentProvider {
  private claudeDir: string;

  constructor() {
    this.claudeDir = path.join(os.homedir(), '.claude');
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const { sessionId, backupFileName } = this.parseUri(uri);

    if (!sessionId || !backupFileName) {
      return '';
    }

    const filePath = this.getBackupPath(sessionId, backupFileName);

    if (!fs.existsSync(filePath)) {
      return `[File not found: ${backupFileName}]`;
    }

    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * Parse a claude-snapshot URI to extract sessionId and backupFileName
   *
   * URI format: claude-snapshot:/{sessionId}/{backupFileName}?path={originalPath}
   */
  private parseUri(uri: vscode.Uri): { sessionId: string; backupFileName: string } {
    const pathParts = uri.path.split('/').filter(p => p);

    if (pathParts.length < 2) {
      return { sessionId: '', backupFileName: '' };
    }

    return {
      sessionId: pathParts[0],
      backupFileName: pathParts[1],
    };
  }

  /**
   * Get the full path to a backup file
   */
  private getBackupPath(sessionId: string, backupFileName: string): string {
    return path.join(this.claudeDir, 'file-history', sessionId, backupFileName);
  }
}

/**
 * Content provider for empty documents (used in add/delete diffs)
 */
export class EmptyContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(): string {
    return '';
  }
}

/**
 * Content provider for original file content extracted from transcripts.
 *
 * Handles URIs in the format:
 *   claude-original:/{encodedContent}?path={originalFilePath}
 *
 * The content is base64-encoded in the URI path to avoid issues with special characters.
 */
export class OriginalContentProvider implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
    // The content is stored as base64 in the URI path
    const pathPart = uri.path.slice(1); // Remove leading /

    if (!pathPart) {
      return '';
    }

    try {
      // Decode from base64
      return Buffer.from(pathPart, 'base64').toString('utf-8');
    } catch {
      return `[Error decoding original content]`;
    }
  }

  /**
   * Create a URI for original content
   */
  static createUri(content: string, filePath: string): vscode.Uri {
    // Encode content as base64 to safely store in URI
    const encoded = Buffer.from(content, 'utf-8').toString('base64');
    return vscode.Uri.parse(
      `claude-original:/${encoded}?path=${encodeURIComponent(filePath)}`
    );
  }
}

/**
 * File system provider for reading Claude Code backup files
 * (Alternative implementation using FileSystemProvider API)
 */
export class SnapshotFileSystemProvider implements vscode.FileSystemProvider {
  private claudeDir: string;

  // Event emitters (required by FileSystemProvider but not used for read-only)
  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor() {
    this.claudeDir = path.join(os.homedir(), '.claude');
  }

  watch(): vscode.Disposable {
    // Not watching for changes - read-only provider
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    // Parse the URI to get backup file info
    const { sessionId, backupFileName } = this.parseUri(uri);

    if (!sessionId || !backupFileName) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const filePath = this.getBackupPath(sessionId, backupFileName);

    if (!fs.existsSync(filePath)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const stats = fs.statSync(filePath);
    return {
      type: vscode.FileType.File,
      ctime: stats.ctimeMs,
      mtime: stats.mtimeMs,
      size: stats.size,
    };
  }

  readDirectory(): [string, vscode.FileType][] {
    // Not used - we only read individual files
    return [];
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Claude Snapshots is read-only');
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const { sessionId, backupFileName } = this.parseUri(uri);

    if (!sessionId || !backupFileName) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const filePath = this.getBackupPath(sessionId, backupFileName);

    if (!fs.existsSync(filePath)) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    const content = fs.readFileSync(filePath);
    return content;
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions('Claude Snapshots is read-only');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Claude Snapshots is read-only');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Claude Snapshots is read-only');
  }

  /**
   * Parse a claude-snapshot URI to extract sessionId and backupFileName
   */
  private parseUri(uri: vscode.Uri): { sessionId: string; backupFileName: string } {
    const pathParts = uri.path.split('/').filter(p => p);

    if (pathParts.length < 2) {
      return { sessionId: '', backupFileName: '' };
    }

    return {
      sessionId: pathParts[0],
      backupFileName: pathParts[1],
    };
  }

  /**
   * Get the full path to a backup file
   */
  private getBackupPath(sessionId: string, backupFileName: string): string {
    return path.join(this.claudeDir, 'file-history', sessionId, backupFileName);
  }
}
