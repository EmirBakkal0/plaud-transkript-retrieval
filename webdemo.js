import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as fuzzball from 'fuzzball';
import express from 'express';

const app = express();
const PORT = 3000;

const OUTPUT_DIR = path.join(process.cwd(), 'plaud_summaries');
const DB_FILE_PATH = path.join(process.cwd(), 'addresses.txt');

app.use(express.json());

// 1. Initial Address Database List
const INITIAL_ADDRESSES = [
  '93 Cawood Drive, Skirlaugh, Hull, East Riding of Yorkshire, HU11 5ES',
  '4 Westfield Road, Barton-Upon-Humber, Lincolnshire, DN18 5AB',
  'Langdale Cottage, King Street, Sancton, York, East Riding Of Yorkshire, YO43 4QP',
  '136 Dunvegan Road, Hull, East Riding of Yorkshire, HU8 9LF',
  '7 Elloughton Road, Brough, East Riding of Yorkshire, HU15 1AD',
  '112 Parsonage Lane, Enfield, Greater London, EN2 0A',
  '53, Barrington Avenue, Hull, HU5 4AZ',
  '5 Mersey Villas, Rosmead Street, Hull, East Riding of Yorkshire, HU9 2TU',
  '139 Dunvegan Road, Hull, East Riding of Yorkshire, HU8 9LE',
  '261 Boothferry Road, Hessle, East Riding Of Yorkshire, HU13 0NG',
  '5 Coldbeck, Waltham Abbey, EN9 1UR'
];

const UK_POSTCODE_REGEX = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi;

// In-memory cache variables for instant page loads
let cachedRecords = [];
let isRefreshing = false;

// Helper to execute CLI commands safely (with Windows libuv crash protection)
function runCommand(command) {
  try {
    return execSync(command, { encoding: 'utf-8' });
  } catch (error) {
    if (error.stdout && error.stdout.trim()) {
      return error.stdout;
    }
    return null;
  }
}

// 2. Load address database from file (populates file automatically if empty)
function loadAddressDatabase(filePath) {
  let addresses = [];

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    addresses = content
      .split('\n')
      .map(line => line.replace(/^[\*\-\s]+/, '').trim())
      .filter(Boolean);
  }

  if (addresses.length < INITIAL_ADDRESSES.length) {
    fs.writeFileSync(filePath, INITIAL_ADDRESSES.join('\n'), 'utf-8');
    addresses = INITIAL_ADDRESSES;
  }

  return addresses;
}

// 3. Address Fuzzy Matching Engine
function findBestAddressMatch(summaryText, addressDb) {
  const matches = [];

  const foundPostcodes = (summaryText.match(UK_POSTCODE_REGEX) || []).map(p =>
    p.replace(/\s+/g, '').toUpperCase()
  );

  const candidateLines = summaryText
    .split(/\r?\n|\./)
    .map(l => l.trim())
    .filter(l => l.length > 10);

  for (const line of candidateLines) {
    for (const dbAddress of addressDb) {
      const dbPostcode = (dbAddress.match(UK_POSTCODE_REGEX) || [])[0]?.replace(/\s+/g, '').toUpperCase();

      let score = fuzzball.partial_ratio(line.toLowerCase(), dbAddress.toLowerCase());

      if (dbPostcode && foundPostcodes.includes(dbPostcode)) {
        score = Math.min(100, score + 25);
      }

      if (score >= 50) {
        matches.push({
          extractedSnippet: line,
          matchedDbAddress: dbAddress,
          confidenceScore: score
        });
      }
    }
  }

  return matches
    .sort((a, b) => b.confidenceScore - a.confidenceScore)
    .filter((v, i, a) => a.findIndex(t => t.matchedDbAddress === v.matchedDbAddress) === i);
}

// 4. Background Data Fetcher & Cache Manager (Official Plaud CLI Parser)
async function refreshPlaudCache() {
  if (isRefreshing) return;
  isRefreshing = true;
  console.log('🔄 Refreshing Plaud transcripts cache in background using Official Plaud CLI...');

  try {
    const addressDb = loadAddressDatabase(DB_FILE_PATH);
    const filesOutput = runCommand('plaud files');

    if (!filesOutput) {
      console.log('⚠️ Plaud CLI unavailable or offline. Using fallback simulation data.');
      if (cachedRecords.length === 0) {
        cachedRecords = [
          {
            id: '1',
            title: 'Valuation Call - Parsonage Lane Property',
            date: '2026-07-28',
            duration: '14m',
            match: {
              matchedDbAddress: '112 Parsonage Lane, Enfield, Greater London, EN2 0A',
              confidenceScore: 95,
              extractedSnippet: '...discussed the market pricing valuation for the detached property at 112 Parsonage Lane...'
            }
          },
          {
            id: '2',
            title: 'Client Discussion - Dunvegan Road Property',
            date: '2026-07-27',
            duration: '32m',
            match: {
              matchedDbAddress: '136 Dunvegan Road, Hull, East Riding of Yorkshire, HU8 9LF',
              confidenceScore: 78,
              extractedSnippet: '...talking about potential offers for 136 Dunvegan Road near Hull...'
            }
          }
        ];
      }
      isRefreshing = false;
      return;
    }

    const cleanOutput = filesOutput.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    const lines = cleanOutput.split(/\r?\n/);
    const files = [];

    for (const line of lines) {
      const trimmed = line.trim();
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

            // Fetch full name if truncated (ends in '…' or '...')
            if (name.endsWith('…') || name.endsWith('...')) {
              const fileDetails = runCommand(`plaud file ${id}`);
              if (fileDetails) {
                const cleanDetails = fileDetails.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
                const nameMatch = cleanDetails.match(/^\s*name:\s+(.+)$/m);
                if (nameMatch) {
                  name = nameMatch[1].trim();
                }
              }
            }

            files.push({ id, title: name, date, duration });
          }
        }
      }
    }

    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const updatedRecords = [];
    for (const file of files) {
      const safeName = (file.title || `recording_${file.id}`).replace(/[^a-zA-Z0-9_\-\s]/g, '_').trim();
      const localFilePath = path.join(OUTPUT_DIR, `${safeName}_summary.md`);

      let summaryText = '';
      if (fs.existsSync(localFilePath)) {
        summaryText = fs.readFileSync(localFilePath, 'utf-8');
      } else {
        summaryText = runCommand(`plaud summary "${file.id}"`) || '';
        if (summaryText) {
          summaryText = summaryText
            .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
            .replace(/^[-\s]*Fetching summary\.{3,}\s*/i, '');
          fs.writeFileSync(localFilePath, summaryText, 'utf-8');
        }
      }

      const matches = findBestAddressMatch(summaryText, addressDb);
      updatedRecords.push({
        ...file,
        match: matches.length > 0 ? matches[0] : null
      });
    }

    cachedRecords = updatedRecords;
    console.log('✅ Plaud cache updated successfully!');
  } catch (err) {
    console.error('Error refreshing Plaud cache:', err);
  } finally {
    isRefreshing = false;
  }
}

// 5. HTML Shell / Page Template Generator
function renderPageShell(activeTab, contentHtml) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lifesycle - CRM Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=League+Spartan:wght@300;400;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['"League Spartan"', 'sans-serif'] },
          colors: {
            brand: { magenta: '#E6007E', black: '#000000', white: '#FFFFFF', cardBorder: '#E5E7EB' }
          }
        }
      }
    }
  </script>
</head>
<body class="flex h-screen overflow-hidden bg-[#F8F9FA] text-black font-sans">

  <!-- Sidebar -->
  <aside class="w-64 bg-brand-black text-brand-white flex flex-col justify-between p-6">
    <div>
      <div class="flex items-center gap-3 mb-10">
        <svg class="w-9 h-9" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="42" stroke="#FFFFFF" stroke-width="12"/>
          <path d="M42 32L68 50L42 68V32Z" fill="#E6007E"/>
        </svg>
        <span class="text-2xl font-bold tracking-tight">Lifesycle</span>
      </div>
      <nav class="space-y-3 font-semibold text-lg">
        <a href="/" class="flex items-center gap-3 px-3 py-2 rounded-lg transition ${activeTab === 'matches' ? 'bg-brand-magenta text-brand-white' : 'hover:bg-zinc-800 text-gray-300'}">
          🎙️ Plaud Matches
        </a>
        <a href="/properties" class="flex items-center gap-3 px-3 py-2 rounded-lg transition ${activeTab === 'properties' ? 'bg-brand-magenta text-brand-white' : 'hover:bg-zinc-800 text-gray-300'}">
          🏠 Properties Database
        </a>
      </nav>
    </div>
    <div class="border-t border-zinc-800 pt-4">
      <div class="text-xs text-gray-400">LOGGED IN AS</div>
      <div class="font-bold text-sm">Team Alpha - Emir</div>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="flex-1 flex flex-col overflow-y-auto">
    <header class="bg-brand-white border-b border-brand-cardBorder px-8 py-5 flex justify-between items-center">
      <div class="flex items-center gap-4">
        <svg class="w-8 h-8" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="42" stroke="#000000" stroke-width="12"/>
          <path d="M42 32L68 50L42 68V32Z" fill="#E6007E"/>
        </svg>
        <div>
          <h1 class="text-3xl font-bold uppercase tracking-wide leading-none">Lifesycle CRM Dashboard</h1>
          <p class="text-gray-500 font-medium text-sm mt-1">Property Valuation & Transcript Intelligence</p>
        </div>
      </div>
    </header>

    <section class="p-8 space-y-6">
      ${contentHtml}
    </section>
  </main>

</body>
</html>`;
}

// 6. ROUTE 1: Plaud Matches Page
app.get('/', (req, res) => {
  const records = cachedRecords;
  const autoMatchCount = records.filter(r => r.match && r.match.confidenceScore >= 85).length;
  const reviewCount = records.filter(r => r.match && r.match.confidenceScore < 85).length;

  const content = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="bg-brand-white p-5 rounded-xl border border-brand-cardBorder shadow-sm">
        <div class="text-gray-500 font-bold uppercase text-xs">Total Transcripts Scanned</div>
        <div class="text-3xl font-bold mt-1">${records.length}</div>
      </div>
      <div class="bg-brand-white p-5 rounded-xl border border-brand-cardBorder shadow-sm">
        <div class="text-gray-500 font-bold uppercase text-xs">Auto-Matched (&ge; 85%)</div>
        <div class="text-3xl font-bold text-green-600 mt-1">${autoMatchCount}</div>
      </div>
      <div class="bg-brand-white p-5 rounded-xl border border-brand-cardBorder shadow-sm">
        <div class="text-gray-500 font-bold uppercase text-xs">Pending Review (&lt; 85%)</div>
        <div class="text-3xl font-bold text-amber-600 mt-1">${reviewCount}</div>
      </div>
    </div>

    <div class="bg-brand-white rounded-xl border border-brand-cardBorder shadow-sm overflow-hidden">
      <div class="p-6 border-b border-brand-cardBorder flex justify-between items-center">
        <h2 class="text-xl font-bold">Recent Audio Recordings</h2>
        <button onclick="fetch('/api/refresh').then(() => location.reload())" class="bg-brand-black text-brand-white font-bold text-xs px-3 py-2 rounded hover:bg-gray-800 transition">
          🔄 Sync Plaud
        </button>
      </div>
      <div class="divide-y divide-brand-cardBorder">
        ${records.map(r => {
          const m = r.match;
          if (!m) return '';
          const isAuto = m.confidenceScore >= 85;

          return `
          <div class="p-6 flex flex-col lg:flex-row gap-6 justify-between">
            <div class="space-y-3 flex-1">
              <div class="flex items-center gap-3">
                <span class="bg-black text-white font-bold text-xs px-2.5 py-1 rounded">${r.date}</span>
                <h3 class="font-bold text-lg">${r.title}</h3>
                <span class="text-xs bg-zinc-200 text-zinc-800 px-2 py-0.5 rounded font-semibold">${r.duration}</span>
              </div>
              <div class="bg-zinc-100 p-3 rounded-lg border-l-4 border-brand-magenta text-sm italic text-gray-800">
                "${m.extractedSnippet}"
              </div>
            </div>

            <!-- Decision Box based on 85% threshold -->
            <div class="w-full lg:w-80 ${isAuto ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-300'} p-4 rounded-xl border flex flex-col justify-between">
              <div>
                <div class="flex justify-between items-center mb-2">
                  <span class="text-xs font-bold uppercase ${isAuto ? 'text-emerald-700' : 'text-amber-800'}">
                    ${isAuto ? '✓ Matched Automatically' : '⚠️ Review Required'}
                  </span>
                  <span class="${isAuto ? 'bg-emerald-600' : 'bg-amber-500'} text-white font-bold text-xs px-2 py-0.5 rounded-full">
                    ${m.confidenceScore}% Match
                  </span>
                </div>
                <div class="font-bold text-base text-gray-900">${m.matchedDbAddress}</div>
                ${!isAuto ? `<p class="text-xs text-amber-800 mt-2 font-medium">Confidence is below 85%. Is this address match correct?</p>` : ''}
              </div>
              <div class="mt-4">
                ${isAuto ? `
                  <div class="pt-2 border-t border-emerald-200 flex justify-between items-center">
                    <span class="text-xs font-semibold text-emerald-800">Linked to Lifesycle CRM</span>
                    <a href="/properties" class="px-3 py-1 bg-white border border-emerald-300 font-bold text-xs text-emerald-900 rounded inline-block">View Database</a>
                  </div>
                ` : `
                  <div class="flex gap-2">
                    <button onclick="alert('Match confirmed!')" class="flex-1 bg-brand-magenta text-white font-bold text-xs py-2 rounded">Yes, Confirm Match</button>
                    <button onclick="alert('Match rejected!')" class="px-3 bg-white border border-amber-300 text-gray-700 font-bold text-xs rounded">No, Unlink</button>
                  </div>
                `}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;

  res.send(renderPageShell('matches', content));
});

// 7. ROUTE 2: Properties Database View Page
app.get('/properties', (req, res) => {
  const addresses = loadAddressDatabase(DB_FILE_PATH);
  const records = cachedRecords;

  const addressStats = addresses.map(addr => {
    const matchedRecord = records.find(r => r.match && r.match.matchedDbAddress === addr);
    return {
      address: addr,
      linkedCall: matchedRecord || null
    };
  });

  const content = `
    <div class="flex justify-between items-center mb-4">
      <div>
        <h2 class="text-2xl font-bold">Properties Database</h2>
        <p class="text-gray-500 text-sm">Loaded addresses from database file (<code>addresses.txt</code>)</p>
      </div>
      <div class="bg-black text-white px-4 py-2 rounded-lg font-bold text-sm">
        ${addresses.length} Total Properties
      </div>
    </div>

    <div class="bg-brand-white rounded-xl border border-brand-cardBorder shadow-sm overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-zinc-100 border-b border-brand-cardBorder text-xs uppercase text-gray-600 font-bold">
            <th class="p-4">#</th>
            <th class="p-4">Property Address</th>
            <th class="p-4">Postcode</th>
            <th class="p-4">Linked Transcript</th>
            <th class="p-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-brand-cardBorder text-sm">
          ${addressStats.map((item, index) => {
            const postcodeMatch = item.address.match(UK_POSTCODE_REGEX);
            const postcode = postcodeMatch ? postcodeMatch[0] : 'N/A';

            return `
            <tr class="hover:bg-gray-50 transition">
              <td class="p-4 font-bold text-gray-400">${index + 1}</td>
              <td class="p-4 font-bold text-gray-900">${item.address}</td>
              <td class="p-4 font-mono text-xs">
                <span class="bg-zinc-200 text-zinc-800 px-2 py-1 rounded font-bold">${postcode}</span>
              </td>
              <td class="p-4">
                ${item.linkedCall ? `
                  <span class="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-pink-100 text-brand-magenta">
                    🎙️ ${item.linkedCall.title} (${item.linkedCall.match.confidenceScore}%)
                  </span>
                ` : `
                  <span class="text-xs text-gray-400 italic">No audio recording linked</span>
                `}
              </td>
              <td class="p-4 text-right">
                <button class="bg-brand-black text-brand-white hover:bg-gray-800 font-bold text-xs px-3 py-1.5 rounded transition">
                  View Property
                </button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  res.send(renderPageShell('properties', content));
});

// Manual Sync API Route
app.get('/api/refresh', async (req, res) => {
  await refreshPlaudCache();
  res.json({ status: 'ok', recordsCount: cachedRecords.length });
});

// Start server & initialize cache on launch
app.listen(PORT, async () => {
  console.log(`Lifesycle CRM prototype running at http://localhost:${PORT}`);
  await refreshPlaudCache();
  setInterval(refreshPlaudCache, 5 * 60 * 1000); // Periodic refresh every 5 mins
});