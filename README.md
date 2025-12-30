# CC Snapshot Viewer

A VS Code extension that displays file changes made by Claude Code at each prompt in the Source Control tab.

## Features

- **View changes per prompt**: See exactly what files Claude modified at each step of your conversation
- **Diff view**: Click on any file to see a side-by-side diff of changes
- **Compare with current**: Compare any snapshot with the current state of the file
- **Auto-refresh**: Automatically updates when Claude makes new changes
- **Multi-workspace support**: Works with multiple workspace folders

## Installation

### From VSIX (Local)

1. Download the `.vsix` file from [Releases](../../releases)
2. In VS Code, open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run "Extensions: Install from VSIX..."
4. Select the downloaded file

### From Source

```bash
git clone https://github.com/subhashkhileri/cc-snapshot-viewer.git
cd cc-snapshot-viewer
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

## Usage

1. Open a project that has been used with [Claude Code](https://claude.ai/claude-code)
2. The extension activates automatically when it detects a `.claude` directory
3. Open the Source Control view (`Cmd+Shift+G` / `Ctrl+Shift+G`)
4. Look for "Snapshots" in the SCM providers
5. Expand any prompt to see the files that were changed
6. Click a file to view the diff

## How It Works

Claude Code stores backup snapshots of files before modifying them in `~/.claude/projects/`. This extension reads those snapshots and the conversation transcript to reconstruct what changed at each prompt.

## Requirements

- VS Code 1.74.0 or higher
- A project that has been used with Claude Code (has a `.claude` directory)

## Known Limitations

- Only shows changes from the most recent Claude Code session
- Snapshots are read-only (you cannot restore from them directly)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT - see [LICENSE](LICENSE) for details.
