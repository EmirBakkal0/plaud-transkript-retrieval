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

// 3. Address Fuzzy Matching Engine (IMPROVED)
function findBestAddressMatch(summaryText, addressDb) {
  const matches = [];

  // Extract all valid UK postcodes from the transcript[cite: 3]
  const foundPostcodes = (summaryText.match(UK_POSTCODE_REGEX) || []).map(p =>
    p.replace(/\s+/g, '').toUpperCase()
  );

  // Split text into candidate phrases, ensuring they aren't too short[cite: 3]
  const candidateLines = summaryText
    .split(/\r?\n|\./)
    .map(l => l.trim())
    .filter(l => l.length > 10); //[cite: 3]

  // Common UK address keywords to filter out conversational noise
  const addressKeywords = /\b(road|rd|street|st|avenue|ave|lane|ln|drive|dr|close|court|ct|way|villa|cottage)\b/i;

  for (const line of candidateLines) {
    // PRE-FILTER: Does the line contain a number? (Most UK addresses do)
    const hasNumber = /\d/.test(line);
    // PRE-FILTER: Does the line contain an address keyword?
    const hasKeyword = addressKeywords.test(line);

    // If it doesn't look like an address at all, skip the heavy fuzzy matching
    if (!hasNumber && !hasKeyword && foundPostcodes.length === 0) {
      continue;
    }

    for (const dbAddress of addressDb) { //[cite: 3]
      const dbPostcode = (dbAddress.match(UK_POSTCODE_REGEX) || [])[0]?.replace(/\s+/g, '').toUpperCase(); //[cite: 3]

      // Upgrade: token_set_ratio is much stricter and handles out-of-order words better than partial_ratio
      let baseScore = fuzzball.token_set_ratio(line.toLowerCase(), dbAddress.toLowerCase());

      let finalScore = baseScore;

      // Smart Boosting: Only apply the postcode bonus if the base string score is already decent (> 45)
      // This prevents garbage sentences from being rescued by a random postcode match.
      if (dbPostcode && foundPostcodes.includes(dbPostcode)) { //[cite: 3]
        if (baseScore > 45) {
          finalScore = Math.min(100, finalScore + 25);
        } else {
          // Minor boost if the string doesn't match well but the postcode is present
          finalScore += 10;
        }
      }

      // Upgrade: Increased the minimum threshold from 50 to 65 to eliminate false positives
      if (finalScore >= 65) {
        matches.push({
          extractedSnippet: line, //[cite: 3]
          matchedDbAddress: dbAddress, //[cite: 3]
          confidenceScore: finalScore //[cite: 3]
        });
      }
    }
  }

  // Sort by highest confidence and remove duplicate address matches[cite: 3]
  return matches
    .sort((a, b) => b.confidenceScore - a.confidenceScore) //[cite: 3]
    .filter((v, i, a) => a.findIndex(t => t.matchedDbAddress === v.matchedDbAddress) === i); //[cite: 3]
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
            id: 'd81aec733c6d442c495c8088d55db35c',
            title: '07-13 Client Appointment: Homeowner Downsizing – Valuation, Marketing Plan, and Launch Timeline',
            date: '2026-07-13',
            duration: '2m16s',
            match: {
              matchedDbAddress: '112 Parsonage Lane, Enfield, Greater London, EN2 0A',
              confidenceScore: 95,
              extractedSnippet: 'Good afternoon. This is a market appraisal summary for 112 Parsonage Lane, Enfield, Greater London EN2 0A.'
            },
            summary: `Valuation appointment summary for 112 Parsonage Lane, Enfield. Homeowner looking to downsize. Recommended price range £675,000 to £700,000.`,
            transcript: `[00:00 - 00:57] Speaker 1: Good afternoon. This is a market appraisal summary for one twelve, Parsonage Lane, Enfield, Greater London E N two O A A. Overall the appointment was very positive. The homeowner was welcoming and happy to show me around the property. We spent some time discussing both the condition of the house and the current local market before talking about their plans. The property is in good overall condition and has clearly been well maintained. The kitchen was modernised a few years ago. The windows have been replaced with double glazing throughout, and the rear garden is a real selling point. There are a few cosmetic areas that could be refreshed, particularly some decorating in the hallway and one of the bedrooms, but nothing that would prevent the property from going to market. The homeowner explained that they're looking to downsize now that their children have moved out. Ideally, They'd like to have the property on the market within the next couple of months.

[00:57 - 01:55] Speaker 1: Although they aren't under any immediate pressure to move, We discussed recent comparable sales in the area and the current level of buyer demand. Based on the evidence, I suggested an asking price in the region of six hundred and seventy five thousand pounds to seven hundred thousand pounds. The homeowner felt that was broadly in line with their expectations and appreciated the explanation behind the pricing. I also talked through our marketing package including professional photography, floor plans Premium online advertising, social media promotion and contacting buyers already registered with us. They were particularly interested in how quickly we could launch the property once everything was ready. Towards the end of the meeting, They mentioned that they have another valuation booked later this week with a different estate agent before making a final decision. They asked a few questions about our fees, contract terms and the average time properties are taking to sell locally, all of which I answered.

[01:55 - 02:14] Speaker 1: Overall, I think this is a strong opportunity. The homeowner appears motivated, realistic about the market, and engaged throughout the appointment. I'll send over the valuation report, along with our marketing proposal this afternoon and follow up by phone later. This week after they've completed their remaining valuation appointments.`
          },
          {
            id: 'ab0eb58282254ceadd4a4838642888a0',
            title: '07-13 Valuation: Darren Parker - Homeowner',
            date: '2026-07-13',
            duration: '2m38s',
            match: {
              matchedDbAddress: '5 Coldbeck, Waltham Abbey, EN9 1UR',
              confidenceScore: 92,
              extractedSnippet: 'Good afternoon. This is a market appraisal summary for 5 Coldbeck, Waltham Abbey, EN9 1UR.'
            },
            summary: `Market appraisal summary for 5 Coldbeck, Waltham Abbey, EN9 1UR following appointment with Darren Parker. Suggested asking price £500,000 - £525,000.`,
            transcript: `[00:01 - 00:58] Speaker 1: Good afternoon. This is a market appraisal summary for five Coldbeck, Waltham Abbey, E N nine one U R. Following my appointment with Mister Darren Parker. Overall the appointment went really well. Darren was friendly, Easy to talk to and seemed genuinely interested in understanding the current market before deciding what to do next. We walked around the property together and discussed the improvements that have been made over the years. The kitchen was refurbished around four years ago, the family bathroom has also been updated and the boiler was replaced recently. The property is generally well presented and has been looked after, Although I suggested that a fresh coat of paint in a couple of the bedrooms and some minor tidying in the garden would help maximise its appeal to buyers. Darren explained that he's thinking about moving to be closer to family.

[00:58 - 01:49] Speaker 1: There is no immediate pressure to sell, But ideally, he'd like to be on the market within the next month or so if the numbers make sense. He hasn't spoken to any other estate agents yet, Although he mentioned, he plans to get at least one more valuation before making a decision. I discussed the current local market, recent comparable sales and the level of buyer demand in the area. Based on the comparable evidence, I suggested an asking price in the region of five hundred thousand pounds to five hundred and twenty - five thousand pounds, with a likely achievable sale price depending on buyer interest and the marketing strategy. We also talked through our marketing approach, including professional photography, floor plans, premium property portal exposure, social media promotion and our buyer matching database.

[01:50 - 02:36] Speaker 1: Darren seemed particularly interested in the fact that we already have registered buyers actively looking for similar properties in the area. There were a few questions about fees, the length of the agency agreement, and how quickly we could arrange photography if he decided to proceed. I answered those questions, and he appeared comfortable with the process. My overall impression is that Darren is a genuine potential client. I think there is a good chance of winning the instruction, although following up promptly will be important. I'll prepare a detailed valuation report and proposal, send it over this afternoon, And give him a call in a couple of days to answer any further questions and see how he is feeling after comparing valuations.`
          },
          {
            id: '2f24ef173e6ffc4bb593fc4488503ed1',
            title: 'How to use Plaud',
            date: '2026-07-13',
            duration: '3m46s',
            match: null,
            summary: `Instructions on using Plaud device and features.`,
            transcript: `[00:00 - 01:00] Speaker 1: Welcome to Plaud tutorial. Learn how to record calls, create voice memos, and generate AI summaries.`
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
      const summaryPath = path.join(OUTPUT_DIR, `${safeName}_summary.md`);
      const transcriptPath = path.join(OUTPUT_DIR, `${safeName}_transcript.md`);

      let summaryText = '';
      if (fs.existsSync(summaryPath)) {
        summaryText = fs.readFileSync(summaryPath, 'utf-8');
      } else {
        summaryText = runCommand(`plaud summary "${file.id}"`) || '';
        if (summaryText) {
          summaryText = summaryText
            .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
            .replace(/^[-\s]*Fetching summary\.{3,}\s*/i, '');
          fs.writeFileSync(summaryPath, summaryText, 'utf-8');
        }
      }

      let transcriptText = '';
      if (fs.existsSync(transcriptPath)) {
        transcriptText = fs.readFileSync(transcriptPath, 'utf-8');
      } else {
        transcriptText = runCommand(`plaud transcript "${file.id}"`) || '';
        if (transcriptText) {
          transcriptText = transcriptText
            .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
            .replace(/^[-\s]*Fetching transcript\.{3,}\s*/i, '');
          fs.writeFileSync(transcriptPath, transcriptText, 'utf-8');
        }
      }

      const searchContent = (transcriptText || '') + '\n' + (summaryText || '');
      const matches = findBestAddressMatch(searchContent, addressDb);
      updatedRecords.push({
        ...file,
        summary: summaryText,
        transcript: transcriptText || summaryText,
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

// Helper to format transcript into dialogue blocks & highlight postcodes
function renderFormattedTranscript(transcriptText, matchedAddress, postcode) {
  if (!transcriptText) {
    return '<p class="text-gray-500 italic p-6">No transcript text available for this recording.</p>';
  }

  let text = transcriptText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Split into speaker blocks if formatted as [HH:MM - HH:MM] Speaker N:
  const rawBlocks = text.split(/(?=\[\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\])/g);

  return rawBlocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';

    const match = trimmed.match(/^\[(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})\]\s*([^:]+):\s*([\s\S]+)$/);
    if (match) {
      const time = match[1];
      const speaker = match[2].trim();
      let content = match[3].trim();

      // Highlight matched postcode
      if (postcode && postcode !== 'N/A') {
        const pRegex = new RegExp(`(${postcode.replace(/\s+/g, '\\s*')})`, 'gi');
        content = content.replace(pRegex, '<mark class="bg-pink-200 text-brand-magenta font-bold px-1.5 py-0.5 rounded border border-pink-300">$1</mark>');
      }

      return `
        <div class="p-5 rounded-xl bg-white border border-brand-cardBorder shadow-sm space-y-2 hover:border-pink-200 transition">
          <div class="flex items-center justify-between border-b border-gray-100 pb-2">
            <span class="font-bold text-brand-magenta text-sm flex items-center gap-1.5">
              👤 ${speaker}
            </span>
            <span class="font-mono text-xs text-gray-600 bg-zinc-100 px-2.5 py-1 rounded-full font-semibold">
              ⏱️ ${time}
            </span>
          </div>
          <p class="text-gray-800 leading-relaxed text-sm whitespace-pre-line">${content}</p>
        </div>
      `;
    } else {
      return `
        <div class="p-5 rounded-xl bg-white border border-brand-cardBorder shadow-sm">
          <p class="text-gray-800 leading-relaxed text-sm whitespace-pre-line">${trimmed}</p>
        </div>
      `;
    }
  }).join('');
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
  <aside class="w-64 bg-brand-black text-brand-white flex flex-col justify-between p-6 shrink-0">
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
        <a href="/transcripts" class="flex items-center gap-3 px-3 py-2 rounded-lg transition ${activeTab === 'transcripts' ? 'bg-brand-magenta text-brand-white' : 'hover:bg-zinc-800 text-gray-300'}">
          📜 Full Transcripts
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
    <header class="bg-brand-white border-b border-brand-cardBorder px-8 py-5 flex justify-between items-center shrink-0">
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
              <div class="pt-1">
                <a href="/transcript/${r.id}" class="inline-flex items-center gap-1.5 bg-brand-black hover:bg-zinc-800 text-white font-bold text-xs px-3 py-1.5 rounded transition">
                  📜 View Full Transcript
                </a>
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
              <div class="mt-4 space-y-2">
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
                  <a href="/transcript/${item.linkedCall.id}" class="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-pink-100 text-brand-magenta hover:bg-pink-200 transition">
                    🎙️ ${item.linkedCall.title} (${item.linkedCall.match.confidenceScore}%)
                  </a>
                ` : `
                  <span class="text-xs text-gray-400 italic">No audio recording linked</span>
                `}
              </td>
              <td class="p-4 text-right">
                ${item.linkedCall ? `
                  <a href="/transcript/${item.linkedCall.id}" class="inline-flex items-center gap-1 bg-brand-magenta text-white hover:bg-pink-700 font-bold text-xs px-3 py-1.5 rounded transition">
                    📜 View Full Transcript
                  </a>
                ` : `
                  <button disabled class="bg-gray-200 text-gray-400 font-bold text-xs px-3 py-1.5 rounded cursor-not-allowed">
                    No Transcript
                  </button>
                `}
              </td>
            </tr>`;
  }).join('')}
        </tbody>
      </table>
    </div>
  `;

  res.send(renderPageShell('properties', content));
});

// 8. ROUTE 3: Transcripts List View
app.get('/transcripts', (req, res) => {
  const records = cachedRecords;

  const content = `
    <div class="flex justify-between items-center mb-6">
      <div>
        <h2 class="text-2xl font-bold">Audio Transcripts Directory</h2>
        <p class="text-gray-500 text-sm">Browse full verbatim transcripts matched to property appraisals</p>
      </div>
      <div class="bg-black text-white px-4 py-2 rounded-lg font-bold text-sm">
        ${records.length} Transcripts
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4">
      ${records.map(r => {
    const m = r.match;
    const postcodeMatch = m ? m.matchedDbAddress.match(UK_POSTCODE_REGEX) : null;
    const postcode = postcodeMatch ? postcodeMatch[0] : null;

    return `
        <div class="bg-white p-6 rounded-xl border border-brand-cardBorder shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-pink-300 transition">
          <div class="space-y-2 flex-1">
            <div class="flex items-center gap-3">
              <span class="bg-black text-white font-bold text-xs px-2.5 py-1 rounded">${r.date}</span>
              <h3 class="font-bold text-lg">${r.title}</h3>
              <span class="text-xs bg-zinc-200 text-zinc-800 px-2 py-0.5 rounded font-semibold">${r.duration}</span>
            </div>

            ${m ? `
              <div class="flex items-center gap-2 text-sm">
                <span class="text-gray-500 font-medium">Matched Property:</span>
                <span class="font-bold text-gray-900">${m.matchedDbAddress}</span>
                ${postcode ? `<span class="bg-pink-100 text-brand-magenta font-mono font-bold text-xs px-2 py-0.5 rounded">${postcode}</span>` : ''}
                <span class="bg-emerald-100 text-emerald-800 text-xs font-bold px-2 py-0.5 rounded-full">${m.confidenceScore}% Match</span>
              </div>
            ` : `
              <div class="text-xs text-gray-400 italic">No property address matched for this recording</div>
            `}
          </div>

          <div class="shrink-0">
            <a href="/transcript/${r.id}" class="inline-flex items-center gap-2 bg-brand-magenta hover:bg-pink-700 text-white font-bold text-sm px-4 py-2 rounded-lg transition shadow-sm">
              📜 Read Full Transcript &rarr;
            </a>
          </div>
        </div>
        `;
  }).join('')}
    </div>
  `;

  res.send(renderPageShell('transcripts', content));
});

// 9. ROUTE 4: Detailed Property & Transcript View
app.get('/transcript/:id', (req, res) => {
  const recordId = req.params.id;
  const records = cachedRecords;

  // Search by ID or by matching title/address
  const record = records.find(r => r.id === recordId || (r.match && r.match.matchedDbAddress.toLowerCase().includes(recordId.toLowerCase())));

  if (!record) {
    const errorHtml = `
      <div class="bg-white p-8 rounded-xl border border-red-200 shadow-sm text-center space-y-4 max-w-lg mx-auto">
        <div class="text-4xl">⚠️</div>
        <h2 class="text-2xl font-bold text-gray-900">Transcript Not Found</h2>
        <p class="text-gray-600 text-sm">No audio transcript matching ID "<code>${recordId}</code>" was found in the cache.</p>
        <a href="/transcripts" class="inline-block bg-brand-black text-white font-bold text-xs px-4 py-2 rounded-lg hover:bg-zinc-800">
          Return to Transcripts List
        </a>
      </div>
    `;
    return res.status(404).send(renderPageShell('transcripts', errorHtml));
  }

  const m = record.match;
  const matchedAddress = m ? m.matchedDbAddress : 'No Property Linked';
  const postcodeMatch = matchedAddress.match(UK_POSTCODE_REGEX);
  const postcode = postcodeMatch ? postcodeMatch[0] : null;
  const isAuto = m && m.confidenceScore >= 85;

  const content = `
    <!-- Top Breadcrumb & Actions -->
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
      <div class="flex items-center gap-3">
        <a href="/transcripts" class="text-xs font-bold bg-white border border-brand-cardBorder px-3 py-1.5 rounded-lg hover:bg-gray-100 transition flex items-center gap-1">
          &larr; Back to Directory
        </a>
        <span class="text-gray-300">/</span>
        <span class="text-xs font-bold text-gray-500 uppercase tracking-wide">Transcript Reader</span>
      </div>
      <div class="flex gap-2">
        <a href="/properties" class="bg-white border border-brand-cardBorder hover:bg-gray-50 text-gray-800 font-bold text-xs px-3 py-2 rounded-lg transition">
          🏠 View Property Database
        </a>
        <button onclick="window.print()" class="bg-brand-black text-white font-bold text-xs px-3 py-2 rounded-lg hover:bg-zinc-800 transition">
          🖨️ Print Transcript
        </button>
      </div>
    </div>

    <!-- Property & Recording Banner -->
    <div class="bg-gradient-to-r from-zinc-900 to-black text-white p-6 rounded-2xl shadow-md space-y-4">
      <div class="flex flex-wrap justify-between items-start gap-4 border-b border-zinc-800 pb-4">
        <div class="space-y-1">
          <div class="flex items-center gap-2">
            <span class="bg-brand-magenta text-white font-bold text-xs px-2.5 py-0.5 rounded-full uppercase tracking-wider">Property Transcript</span>
            <span class="bg-zinc-800 text-zinc-300 font-mono text-xs px-2 py-0.5 rounded">${record.date}</span>
            <span class="bg-zinc-800 text-zinc-300 font-mono text-xs px-2 py-0.5 rounded">${record.duration}</span>
          </div>
          <h2 class="text-2xl font-bold text-white mt-2">${record.title}</h2>
        </div>

        ${m ? `
          <div class="bg-zinc-800/90 border border-zinc-700 p-4 rounded-xl flex items-center gap-4">
            <div>
              <div class="text-xs text-gray-400 uppercase font-bold">Matched Database Property</div>
              <div class="text-base font-bold text-white mt-0.5">${m.matchedDbAddress}</div>
            </div>
            <div class="${isAuto ? 'bg-emerald-500' : 'bg-amber-500'} text-white font-extrabold text-sm px-3 py-1.5 rounded-xl shadow-sm text-center shrink-0">
              ${m.confidenceScore}%<br><span class="text-[10px] uppercase tracking-tighter">Match</span>
            </div>
          </div>
        ` : ''}
      </div>

      ${m ? `
        <!-- Snippet Highlight -->
        <div class="bg-zinc-800/50 p-3 rounded-lg border-l-4 border-brand-magenta text-xs text-zinc-300 italic flex items-center justify-between gap-4">
          <div>
            <span class="font-bold text-brand-magenta not-italic uppercase mr-2">Address Match Key Phrase:</span>
            "${m.extractedSnippet}"
          </div>
          ${postcode ? `<span class="bg-brand-magenta text-white font-mono text-xs px-2 py-0.5 rounded font-bold shrink-0">${postcode}</span>` : ''}
        </div>
      ` : ''}
    </div>

    <!-- Main Content Grid: Verbatim Transcript vs Summary -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      <!-- Verbatim Transcript Panel (Left / Main) -->
      <div class="lg:col-span-2 space-y-4">
        <div class="flex justify-between items-center">
          <h3 class="text-lg font-bold text-gray-900 flex items-center gap-2">
            📜 Full Verbatim Audio Transcript
          </h3>
          <span class="text-xs text-gray-500 font-medium">Speaker timestamps enabled</span>
        </div>

        <div class="space-y-4">
          ${renderFormattedTranscript(record.transcript, matchedAddress, postcode)}
        </div>
      </div>

      <!-- AI Summary & Metadata Panel (Right Sidebar) -->
      <div class="space-y-6">
        
        <!-- AI Summary Card -->
        <div class="bg-white p-6 rounded-xl border border-brand-cardBorder shadow-sm space-y-3">
          <h3 class="text-base font-bold text-gray-900 border-b border-brand-cardBorder pb-3 flex items-center gap-2">
            ✨ AI Summary & Highlights
          </h3>
          <div class="text-sm text-gray-700 leading-relaxed whitespace-pre-line bg-gray-50 p-4 rounded-lg border border-gray-100">
            ${record.summary || 'No summary available.'}
          </div>
        </div>

        <!-- CRM Property Sync Status -->
        <div class="bg-white p-6 rounded-xl border border-brand-cardBorder shadow-sm space-y-4">
          <h3 class="text-base font-bold text-gray-900 border-b border-brand-cardBorder pb-3">
            🔗 CRM Property Link Status
          </h3>
          ${m ? `
            <div class="space-y-3">
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Address Match:</span>
                <span class="font-bold text-gray-900 text-right">${m.matchedDbAddress}</span>
              </div>
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Confidence Score:</span>
                <span class="font-bold ${isAuto ? 'text-emerald-600' : 'text-amber-600'}">${m.confidenceScore}%</span>
              </div>
              <div class="flex justify-between text-xs">
                <span class="text-gray-500">Status:</span>
                <span class="font-bold ${isAuto ? 'text-emerald-700 bg-emerald-100' : 'text-amber-800 bg-amber-100'} px-2 py-0.5 rounded">
                  ${isAuto ? 'Auto-Linked' : 'Pending Confirmation'}
                </span>
              </div>

              <div class="pt-3 border-t border-gray-100 flex gap-2">
                <button onclick="alert('Property link confirmed in CRM!')" class="flex-1 bg-brand-magenta text-white font-bold text-xs py-2 rounded-lg hover:bg-pink-700 transition">
                  ✓ Confirm Link
                </button>
                <a href="/properties" class="px-3 py-2 bg-zinc-100 text-gray-700 font-bold text-xs rounded-lg hover:bg-zinc-200 transition">
                  Properties
                </a>
              </div>
            </div>
          ` : `
            <div class="text-xs text-gray-500">
              No matching address from <code>addresses.txt</code> was detected in this recording.
            </div>
          `}
        </div>

      </div>
    </div>
  `;

  res.send(renderPageShell('transcripts', content));
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