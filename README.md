<div align="center">

# CC Snapshot Viewer

<img src="images/icon.png" alt="CC Snapshot Viewer Icon" width="128" />

### View file changes made by Claude Code at each prompt

[![VS Code Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/subhashkhileri.cc-snapshot-viewer?label=VS%20Code%20Marketplace&logo=visual-studio-code&color=blue)](https://marketplace.visualstudio.com/items?itemName=subhashkhileri.cc-snapshot-viewer)
[![VS Code Installs](https://img.shields.io/visual-studio-marketplace/i/subhashkhileri.cc-snapshot-viewer?label=Installs&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=subhashkhileri.cc-snapshot-viewer)
[![VS Code Rating](https://img.shields.io/visual-studio-marketplace/r/subhashkhileri.cc-snapshot-viewer?label=Rating&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=subhashkhileri.cc-snapshot-viewer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/subhashkhileri/cc-snapshot-viewer?style=social)](https://github.com/subhashkhileri/cc-snapshot-viewer)

**A VS Code & Cursor extension for tracking AI-generated code changes from [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by [Anthropic](https://www.anthropic.com/)**

[Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=subhashkhileri.cc-snapshot-viewer) · [Report Bug](https://github.com/subhashkhileri/cc-snapshot-viewer/issues) · [Request Feature](https://github.com/subhashkhileri/cc-snapshot-viewer/issues)

</div>

---

## Why CC Snapshot Viewer?

When using **Claude Code** (Anthropic's AI coding assistant), it modifies files in your project. But what exactly changed at each step? **CC Snapshot Viewer** integrates directly into VS Code's Source Control panel to show you:

- Every file Claude modified at each prompt
- Side-by-side diffs of before/after changes
- A complete history of AI-generated code changes

Perfect for **code review**, **debugging**, and **understanding AI modifications** to your codebase.

## Features

| Feature | Description |
|---------|-------------|
| **View Changes Per Prompt** | See exactly what files Claude modified at each step of your conversation |
| **Diff View** | Click on any file to see a side-by-side diff of changes |
| **Compare with Current** | Compare any snapshot with the current state of the file |
| **Auto-Refresh** | Automatically updates when Claude makes new changes |
| **Multi-Workspace Support** | Works with multiple workspace folders |

## Quick Install

```bash
# VS Code
code --install-extension subhashkhileri.cc-snapshot-viewer

# Cursor
cursor --install-extension subhashkhileri.cc-snapshot-viewer
```

## Installation

### From VS Code Marketplace (Recommended)

1. Open **VS Code** or **Cursor**
2. Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for **"CC Snapshot Viewer"**
4. Click **Install**

Or install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=subhashkhileri.cc-snapshot-viewer).

### From VSIX (Local)

1. Download the `.vsix` file from [Releases](https://github.com/subhashkhileri/cc-snapshot-viewer/releases)
2. In VS Code, open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run **"Extensions: Install from VSIX..."**
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

1. Open a project that has been used with [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
2. The extension activates automatically when it detects a `.claude` directory
3. Open the **Source Control** view (`Cmd+Shift+G` / `Ctrl+Shift+G`)
4. Look for **"Snapshots"** in the SCM providers
5. Expand any prompt to see the files that were changed
6. Click a file to view the diff

## How It Works

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) stores backup snapshots of files before modifying them in `~/.claude/projects/`. This extension reads those snapshots and the conversation transcript to reconstruct what changed at each prompt.

## Requirements

- **VS Code** 1.74.0 or higher (also works with **Cursor**)
- A project that has been used with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (has a `.claude` directory)

## Known Limitations

- Only shows changes from the most recent Claude Code session
- Snapshots are read-only (you cannot restore from them directly)

## Related

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) - Anthropic's AI coding assistant
- [Anthropic](https://www.anthropic.com/) - AI safety company behind Claude

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT - see [LICENSE](LICENSE) for details.

---

<div align="center">

**If you find this extension useful, please consider giving it a ⭐ on [GitHub](https://github.com/subhashkhileri/cc-snapshot-viewer)!**

</div>
