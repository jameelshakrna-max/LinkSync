import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import CryptoJS from 'crypto-js';
import { GoogleGenerativeAI } from "@google/generative-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_KEY = 'bridgesync-local-dev-key-7722';
const SECRET_KEY = process.env.VITE_BRIDGE_ENCRYPTION_KEY || DEFAULT_KEY;

// Lazy AI initialization to prevent crash on startup if key is missing
let aiInstance: GoogleGenerativeAI | null = null;
function getAI() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not defined');
  if (!aiInstance) {
    aiInstance = new GoogleGenerativeAI(key);
  }
  return aiInstance;
}

function decrypt(cipherText: string) {
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
    const originalText = bytes.toString(CryptoJS.enc.Utf8);
    if (!originalText) throw new Error('Decryption resulted in empty string');
    return originalText;
  } catch (err) {
    console.error('Decryption failed:', err);
    throw new Error('Bridge Decryption Failed: Invalid session key or corrupted payload.');
  }
}

const app = express();
const PORT = 3000;

app.use(express.json());

// API Route: Infrastructure Analysis
app.post('/api/analyze', async (req, res) => {
  const { hostMeta, dbMeta } = req.body;
  
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ 
      error: 'The AI Audit Engine is currently offline (Missing GEMINI_API_KEY). Please add it to your Vercel Project Settings.' 
    });
  }

  if (!hostMeta || !dbMeta) {
    return res.status(400).json({ error: 'Missing metadata for analysis' });
  }

  try {
    const prompt = `
      Analyze this connection request for LinkSync.
      Host Platform: ${hostMeta.platform} (${hostMeta.url})
      Database Platform: ${dbMeta.platform} (${dbMeta.url})
      
      Explain:
      1. Common env vars needed.
      2. Connection walkthrough.
      3. Security note.
      
      Keep it concise, technical, markdown list.
    `;

    const ai = getAI();
    const model = ai.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    res.json({ text });
  } catch (error: any) {
    console.error('AI Analysis Error:', error);
    res.status(500).json({ error: 'Failed to generate infrastructure audit.' });
  }
});

// API Route: Sync to Vercel
app.post('/api/vercel/sync', async (req, res) => {
  let { token, projectName, envVars } = req.body;
  const { encrypted } = req.body;

  // Handle encrypted payload if present
  if (encrypted) {
    try {
      const decryptedData = JSON.parse(decrypt(encrypted));
      token = decryptedData.token;
      projectName = decryptedData.projectName;
      envVars = decryptedData.envVars;
    } catch (err: any) {
      return res.status(401).json({ error: err.message });
    }
  }

  if (!token || !projectName || !envVars) {
    return res.status(400).json({ error: 'Missing required sync parameters' });
  }

  try {
    // 1. Find Project ID
    const projectRes = await fetch(`https://api.vercel.com/v9/projects/${projectName}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!projectRes.ok) {
      throw new Error(`Failed to find Vercel project: ${projectRes.statusText}`);
    }
    
    const projectData = await projectRes.json();
    const projectId = projectData.id;

    // 2. Fetch existing env vars to detect conflicts
    const existingRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const existingData = await existingRes.json();
    const existingKeys = new Set(existingData.envs?.map((e: any) => e.key) || []);

    const results = [];
    
    // 3. Update / Create each variable
    for (const [key, value] of Object.entries(envVars)) {
      const isConflict = existingKeys.has(key);
      
      const syncRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          key,
          value,
          type: 'plain',
          target: ['production', 'preview', 'development']
        })
      });

      results.push({
        key,
        status: syncRes.ok ? 'synced' : 'failed',
        conflict: isConflict,
        message: syncRes.ok ? 'Successfully pushed' : `Failed: ${syncRes.statusText}`
      });
    }

    res.json({ success: true, results });
  } catch (error: any) {
    console.error('Vercel Sync Error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function setupApp() {
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Only listen if running directly
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Bridge_Dev Server online at http://localhost:${PORT}`);
    });
  }
}

setupApp();

export default app;
