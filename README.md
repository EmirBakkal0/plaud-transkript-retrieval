# Plaud Transcript & Summary Address Matcher

This project is a Node.js automation script that integrates with the **Plaud CLI** to fetch your audio recording summaries, match them against a database of target physical addresses (using fuzzy string matching and UK postcode matching), and output a structured audit report.

## Features

- **Automated Plaud CLI Integration**: Retrieves a list of all your recordings, details, and summaries directly using the Plaud CLI commands (`plaud files`, `plaud file`, `plaud summary`).
- **Truncated File Name Resolution**: Automatically detects truncated file names (ending with `...` or `…`) and queries individual file details to resolve their full name.
- **Fuzzy Address Matching**: Evaluates recording summaries against a target address list (`addresses.txt`) using the `fuzzball` library.
- **Postcode Boosting**: Extracts UK postcodes from the summaries and the database, boosting confidence scores by 25% for exact postcode matches to increase matching accuracy.
- **Robust Windows Cleanup Handling**: Gracefully handles and catches the known Windows libuv event loop cleanup bug (`Assertion failed: !(handle...`), ensuring that data is parsed successfully even if the CLI crashes on exit.
- **Structured Audit Logs**: 
  - Downloads and saves raw Markdown summaries under `plaud_summaries/`.
  - Outputs a detailed audit log in JSON format (`address_match_results.json`) indicating which files matched which database addresses and with what confidence.

---

## Prerequisites

1. **Node.js**: Version 16 or newer.
2. **Plaud CLI**: Installed and logged in on your system.
   - To verify installation: `plaud version`
   - To authenticate: `plaud login`

---

## Installation

1. Clone or download this directory.
2. Install the package dependencies (specifically `fuzzball` for fuzzy string matching):
   ```bash
   npm install
   ```

---

## File Structure

- `script.js` — The main orchestration script containing command wrapper, parsing, and fuzzy matching engine.
- `addresses.txt` — Your database of target addresses (one per line, bullets/hyphens are automatically stripped).
- `plaud_summaries/` — Directory created automatically where downloaded `.md` summaries are saved.
- `address_match_results.json` — The generated matching audit report listing found matches, snippets, and confidence levels.

---

## How to Use

1. **Populate the Address Database**: Edit `addresses.txt` and add target addresses you want to scan for, for example:
   ```text
   * 93 Cawood Drive, Skirlaugh, Hull, HU11 5ES.
   * 112 Parsonage Lane, Enfield, EN2 0A.
   ```
2. **Ensure you are logged into Plaud CLI**:
   ```bash
   plaud me
   ```
3. **Run the script**:
   ```bash
   node script.js
   ```

---

## Windows Known Issue

On Windows platforms, you may see the following assertion printed in the console during execution:
```
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
```
This is a harmless exit/cleanup crash originating from the Plaud CLI's packaging and Node's event loop wrapper. The script automatically catches this error, extracts the successful console output, and continues processing without issues. You can safely ignore it.
