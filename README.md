# text-pad

`text-pad` is a lightweight, Notepad-style text editor for Windows, built with Tauri 2 and SvelteKit. Files are always saved as plain source text, while Render Mode provides a more readable view without changing the underlying content.

## Features

- Open, edit, save, and create copies of local text files with Save As.
- Work with multiple files in a tabbed interface.
- Switch between Source Mode and Render Mode.
- Edit JSON, YAML, CSV, and TSV documents with format-aware rendering.
- Use natural editing helpers for paired characters, lists, indentation, and code blocks.
- Customize font size, tab width, render colors, and render fonts.
- Save separate render color preferences for light, dark, and system themes.
- Check for signed app updates at startup or from the Help menu, and view version and license details in About.
- Handle horizontal wheel input correctly on Windows WebView2.

## Installation

Download the latest Windows installer from [GitHub Releases](https://github.com/olivecrow/text-pad/releases/latest):

- `text-pad_<version>_x64-setup.exe`: standard Windows installer (recommended).
- `text-pad_<version>_x64_en-US.msi`: MSI package for managed installations.

Version `0.2.0` is the first release with the built-in updater. If you are upgrading from `0.1.0`, install `0.2.0` manually once; later releases can be installed from inside the app.

## Development

Install dependencies and start the Tauri development app:

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri:build:signed
```

This is the repository's final Windows build command. It uses the local DPAPI-protected updater key and produces the executable, MSI/NSIS installers, and updater signatures under `src-tauri/target/release/`. Direct `npm run tauri build` and `--no-bundle` builds are diagnostic-only.

## Documentation

- `AGENTS.md`: repository contribution and implementation rules.
- `docs/project-guide.md`: project structure and current feature scope.
- `docs/backend-guide.md`: Rust and Tauri backend contracts.
- `docs/frontend-guide.md`: SvelteKit frontend contracts.
- Natural text editing guidelines: [English](docs/features/natural-text-editing.en.md) · [Korean](docs/features/natural-text-editing.md).
- `docs/features/`: detailed feature contracts.
- `docs/implementation-checklist.md`: remaining work and completion criteria.

The internal development documentation is maintained primarily in Korean. The reusable natural text editing contract is available in both English and Korean.
