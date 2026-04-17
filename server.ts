import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import CryptoJS from 'crypto-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_KEY = 'bridgesync-local-dev-key-7722';
const SECRET_KEY = process.env.VITE_BRIDGE_ENCRYPTION_KEY || DEFAULT_KEY;

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

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
      const existingKeys = new Set(existingData.envs.map((e: any) => e.key));

      const results = [];
      
      // 3. Update / Create each variable
      for (const [key, value] of Object.entries(envVars)) {
        const isConflict = existingKeys.has(key);
        
        // In real Vercel API, you'd handle overwrite or skipping
        // Here we attempt to create new one (Vercel API normally requires DELETE/CREATE for update if it exists)
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

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bridge_Dev Server online at http://localhost:${PORT}`);
  });
}

startServer();
