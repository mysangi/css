export default {
  async fetch(request, env, ctx) {
    // Allow your website to talk to this Worker
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const body = await request.json();
      const { rowIndex, timestamp } = body;

      // ⚠️ CHANGE THESE TO MATCH YOUR REPO
      const REPO_OWNER = 'mysangi'; 
      const REPO_NAME = 'css';
      const BRANCH = 'main';
      const CSV_FILE = 'css mpt results - all.csv'; // Your exact CSV filename
      
      const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(CSV_FILE)}?ref=${BRANCH}`;

      // Fetch current CSV
      const getRes = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'Cloudflare-Worker'
        }
      });

      if (!getRes.ok) throw new Error(`GitHub GET failed: ${getRes.status}`);
      
      const fileData = await getRes.json();
      
      // Decode CSV
      const bin = atob(fileData.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      let csvText = new TextDecoder('utf-8').decode(bytes);

      // Update CSV
      const newCsv = updateCsvCell(csvText, rowIndex, 7, timestamp);

      // Encode CSV
      const newBytes = new TextEncoder().encode(newCsv);
      let newBin = '';
      for (let i = 0; i < newBytes.length; i++) newBin += String.fromCharCode(newBytes[i]);
      const encodedContent = btoa(newBin);

      // Push to GitHub
      const putRes = await fetch(apiUrl.split('?')[0], {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'Cloudflare-Worker'
        },
        body: JSON.stringify({
          message: `Verify row ${rowIndex}`,
          content: encodedContent,
          sha: fileData.sha,
          branch: BRANCH
        })
      });

      if (!putRes.ok) {
        const err = await putRes.json();
        throw new Error(`GitHub PUT failed: ${putRes.status} - ${err.message}`);
      }

      return new Response(JSON.stringify({ success: true, timestamp }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  }
};

// Helper function to parse and update the CSV
function updateCsvCell(csvText, rowIndex, colIndex, newValue) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else { field += ch; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const target = rows[rowIndex];
  if (target) {
    while (target.length <= colIndex) target.push('');
    target[colIndex] = newValue;
  }

  return rows.map(r => r.map(cell => {
    const s = String(cell);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(',')).join('\n');
}
