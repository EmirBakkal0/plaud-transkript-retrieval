import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as fuzzball from 'fuzzball';

const OUTPUT_DIR = path.join(process.cwd(), 'plaud_summaries');
const DB_FILE_PATH = path.join(process.cwd(), 'addresses.txt');

// Helper to execute CLI commands safely
function runCommand(command) {
  try {
    return execSync(command, { encoding: 'utf-8' });
  } catch (error) {
    // On Windows, the Plaud CLI may crash with a libuv assertion error during cleanup/exit.
    // If it successfully printed the output to stdout before crashing, we return that output.
    if (error.stdout && error.stdout.trim()) {
      return error.stdout;
    }
    return null;
  }
}

// 1. Load sample database from text file
function loadAddressDatabase(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Address database file not found at ${filePath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .map(line => line.replace(/^[\*\-\s]+/, '').trim()) // Strip list bullets (* or -)
    .filter(Boolean);
}

// Regex to extract standard UK postcodes (e.g., HU11 5ES, DN18 5AB)
const UK_POSTCODE_REGEX = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;

// 2. Address Matching Logic
function findBestAddressMatch(summaryText, addressDb) {
  const matches = [];

  // Extract postcodes present in the summary text to narrow search space
  const foundPostcodes = (summaryText.match(UK_POSTCODE_REGEX) || []).map(p =>
    p.replace(/\s+/g, '').toUpperCase()
  );

  // Split summary into lines/sentences to evaluate address candidates
  const candidateLines = summaryText
    .split(/\r?\n|\./)
    .map(l => l.trim())
    .filter(l => l.length > 10);

  for (const line of candidateLines) {
    for (const dbAddress of addressDb) {
      const dbPostcode = (dbAddress.match(UK_POSTCODE_REGEX) || [])[0]?.replace(/\s+/g, '').toUpperCase();

      // Calculate fuzzy similarity score (0 to 100)
      let score = fuzzball.partial_ratio(line.toLowerCase(), dbAddress.toLowerCase());

      // Boost score heavily if the UK postcode matches exactly
      if (dbPostcode && foundPostcodes.includes(dbPostcode)) {
        score = Math.min(100, score + 25);
      }

      // Threshold: Scores > 70 are solid candidates
      if (score >= 70) {
        matches.push({
          extractedSnippet: line,
          matchedDbAddress: dbAddress,
          confidenceScore: score
        });
      }
    }
  }

  // Sort by highest confidence score and deduplicate
  return matches
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .filter((v, i, a) => a.findIndex(t => t.matchedDbAddress === v.matchedDbAddress) === i);
}

// 3. Main Download & Match Loop
async function run() {
  const addressDb = loadAddressDatabase(DB_FILE_PATH);
  console.log(`Loaded ${addressDb.length} addresses from database file.\n`);

  if (process.platform === 'win32') {
    console.log("Notice: On Windows, Plaud CLI may output a harmless 'Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)' error during cleanup. This is a known, non-important issue and can be safely ignored.\n");
  }

  const filesOutput = runCommand('plaud files');
  if (!filesOutput) {
    console.error('Failed to get files list. Ensure you are logged into Plaud CLI.');
    return;
  }

  // Strip ANSI escape codes
  const cleanOutput = filesOutput.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  const lines = cleanOutput.split(/\r?\n/);
  const files = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match 32-character hex ID at the start
    const match = trimmed.match(/^([a-f0-9]{32})\s+(.+)$/);
    if (match) {
      const id = match[1];
      const rest = match[2].trim();
      const tokens = rest.split(/\s+/);
      if (tokens.length >= 2) {
        const duration = tokens[tokens.length - 1];
        const date = tokens[tokens.length - 2];
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          const dateIndex = rest.lastIndexOf(date);
          let name = rest.substring(0, dateIndex).trim();

          // If name is truncated (ends with '…' or '...'), fetch the full name using 'plaud file <id>'
          if (name.endsWith('…') || name.endsWith('...')) {
            const lastChar = name.endsWith('…') ? 1 : 3;
            const strippedName = name.slice(0, -lastChar).trim();
            console.log(`Fetching full details for truncated file: "${strippedName}..." (${id})`);
            const fileDetails = runCommand(`plaud file ${id}`);
            if (fileDetails) {
              const cleanDetails = fileDetails.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
              const nameMatch = cleanDetails.match(/^\s*name:\s+(.+)$/m);
              if (nameMatch) {
                name = nameMatch[1].trim();
              }
            }
          }

          files.push({ id, name, date, duration });
        }
      }
    }
  }

  if (files.length === 0) {
    console.error('No files found or failed to parse files list.');
    return;
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const summaryReport = [];

  for (const [index, file] of files.entries()) {
    const rawName = file.name || `recording_${file.id}`;
    const safeName = rawName.replace(/[^a-zA-Z0-9_\-\s]/g, '_').trim();

    console.log(`[${index + 1}/${files.length}] Processing summary for: "${rawName}"...`);

    let summaryText = runCommand(`plaud summary "${file.id}"`);

    if (summaryText) {
      // Strip ANSI escape codes and fetching spinner
      summaryText = summaryText
        .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
        .replace(/^[-\s]*Fetching summary\.{3,}\s*/i, '');

      // Save summary file locally
      const filePath = path.join(OUTPUT_DIR, `${safeName}_summary.md`);
      fs.writeFileSync(filePath, summaryText, 'utf-8');

      // Run address matching engine on the summary content
      const addressMatches = findBestAddressMatch(summaryText, addressDb);

      if (addressMatches.length > 0) {
        console.log(`   Found ${addressMatches.length} address match(es)!`);
        addressMatches.forEach(m => {
          console.log(`   ➔ Matched DB: "${m.matchedDbAddress}" (${m.confidenceScore}% confidence)`);
        });
      } else {
        console.log(`   No matching addresses detected.`);
      }

      summaryReport.push({
        fileId: file.id,
        title: rawName,
        matches: addressMatches
      });
    }
  }

  // Save full matching results report as JSON
  const reportPath = path.join(process.cwd(), 'address_match_results.json');
  fs.writeFileSync(reportPath, JSON.stringify(summaryReport, null, 2));
  console.log(`\nMatching completed! Full audit log saved to: ${reportPath}`);
}

run();