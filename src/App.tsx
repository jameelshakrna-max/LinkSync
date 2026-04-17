/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Zap, 
  Database, 
  Globe, 
  ArrowRight, 
  CheckCircle2, 
  Loader2, 
  AlertCircle,
  Copy,
  ShieldCheck,
  Cpu,
  RefreshCw,
  Settings2,
  Plus,
  Trash2,
  Edit3,
  ExternalLink,
  ChevronLeft,
  LayoutDashboard,
  MoreVertical,
  Layers
} from 'lucide-react';
import { cn } from './lib/utils';
import { encrypt, isSensitive } from './lib/crypto';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  query, 
  where, 
  onSnapshot,
  deleteDoc,
  OperationType, 
  handleFirestoreError,
  Timestamp,
  User 
} from './firebase';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

// Error Boundary Component
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public props: ErrorBoundaryProps;
  public state: ErrorBoundaryState;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props;
    this.state = {
      hasError: false,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-8 text-center">
          <div className="max-w-md space-y-6">
            <AlertCircle size={48} className="text-red-500 mx-auto" />
            <h1 className="text-2xl font-black text-white uppercase tracking-tighter">System Malfunction</h1>
            <p className="text-gray-500 text-sm font-mono bg-white/5 p-4 rounded-xl break-words">
              {this.state.errorInfo}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-4 bg-white text-black font-black text-xs uppercase tracking-widest rounded-full"
            >
              Reboot Terminal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type ConnectionStatus = 'idle' | 'parsing' | 'analyzing' | 'ready' | 'syncing' | 'completed' | 'error';

interface EnvVar {
  key: string;
  value: string;
  status?: 'synced' | 'failed';
  conflict?: boolean;
}

interface ProjectMeta {
  platform: 'Vercel' | 'Netlify' | 'Unknown';
  projectId?: string;
  name?: string;
  url: string;
}

interface DatabaseMeta {
  platform: 'Supabase' | 'Neon' | 'Railway' | 'PlanetScale' | 'Upstash' | 'MongoDB Atlas' | 'Unknown';
  projectRef?: string;
  url: string;
}

interface ConnectionRecord {
  id: string;
  name: string;
  host: ProjectMeta;
  database: DatabaseMeta;
  status: 'active' | 'syncing' | 'error';
  lastSynced: string;
}

export default function App() {
  return (
    <ErrorBoundary>
      <LinkSyncApp />
    </ErrorBoundary>
  );
}

function LinkSyncApp() {
  const [view, setView] = useState<'dashboard' | 'connect'>('dashboard');
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Connector State
  const [hostUrl, setHostUrl] = useState('');
  const [dbUrl, setDbUrl] = useState('');
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingVars, setPendingVars] = useState<EnvVar[]>([]);
  const [syncResults, setSyncResults] = useState<any[]>([]);
  const [showHelper, setShowHelper] = useState(false);
  const [tickerMessage, setTickerMessage] = useState("BRIDGE ENGINE IDLE");

  // System Ticker Logic
  useEffect(() => {
    const messages = [
      "ENTROPY STABLE",
      "HANDSHAKING PROTOCOLS...",
      "VIRTUAL BRIDGE SECURE",
      "MONITORING TRAFFIC...",
      "ENCRYPTION LAYERS ACTIVE",
      "READY FOR PAYLOAD",
      "NODE STATUS: OPTIMAL",
      "SIGNAL STRENGTH: 100%"
    ];
    
    const interval = setInterval(() => {
      setTickerMessage(messages[Math.floor(Math.random() * messages.length)]);
    }, 6000);
    
    return () => clearInterval(interval);
  }, []);

  // Auth Listener & User Sync
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);

      if (user) {
        // Sync user profile to Firestore
        const userRef = doc(db, 'users', user.uid);
        try {
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
              createdAt: Timestamp.now(),
              role: 'user'
            });
            
            // Migrate localStorage connections to Firestore on first login
            const saved = localStorage.getItem('linksync_connections');
            if (saved) {
              const localConnections = JSON.parse(saved) as ConnectionRecord[];
              for (const conn of localConnections) {
                const connRef = doc(collection(db, 'users', user.uid, 'connections'));
                await setDoc(connRef, { ...conn, userId: user.uid, id: connRef.id });
              }
              localStorage.removeItem('linksync_connections');
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
        }
      }
    });
    return unsub;
  }, []);

  // Real-time Database Listener
  useEffect(() => {
    if (!currentUser) {
      // Use local storage for guests
      const saved = localStorage.getItem('linksync_connections');
      if (saved) setConnections(JSON.parse(saved));
      return;
    }

    const q = query(collection(db, 'users', currentUser.uid, 'connections'));
    const unsub = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ ...doc.data() as any, id: doc.id }));
      setConnections(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${currentUser.uid}/connections`);
    });

    return unsub;
  }, [currentUser]);

  // Save to local storage only if guest
  useEffect(() => {
    if (!currentUser) {
      localStorage.setItem('linksync_connections', JSON.stringify(connections));
    }
  }, [connections, currentUser]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setConnections([]);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const isValidUrl = (url: string) => {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  // Parsing logics
  const hostMeta = useMemo((): ProjectMeta => {
    if (!isValidUrl(hostUrl)) return { platform: 'Unknown', url: hostUrl };
    if (hostUrl.includes('vercel.com') || hostUrl.includes('vercel.app')) {
      const parts = hostUrl.replace(/\/$/, '').split('/');
      const lastPart = parts[parts.length - 1];
      const name = lastPart.replace('.vercel.app', '') || 'Vercel Project';
      return { platform: 'Vercel', name, url: hostUrl };
    }
    if (hostUrl.includes('netlify.app') || hostUrl.includes('app.netlify.com')) {
      const parts = hostUrl.replace(/\/$/, '').split('/');
      const name = parts[parts.length - 1].replace('.netlify.app', '') || 'Netlify Project';
      return { platform: 'Netlify', name, url: hostUrl };
    }
    return { platform: 'Unknown', url: hostUrl };
  }, [hostUrl]);

  const dbMeta = useMemo((): DatabaseMeta => {
    if (!isValidUrl(dbUrl)) return { platform: 'Unknown', url: dbUrl };
    if (dbUrl.includes('supabase.com') || dbUrl.includes('supabase.co')) {
      const match = dbUrl.match(/project\/([a-z0-9]+)/) || dbUrl.match(/([a-z0-9]+)\.supabase\./);
      return { platform: 'Supabase', projectRef: match?.[1], url: dbUrl };
    }
    if (dbUrl.includes('neon.tech')) return { platform: 'Neon', url: dbUrl };
    if (dbUrl.includes('railway.app') || dbUrl.includes('railway.com')) return { platform: 'Railway', url: dbUrl };
    if (dbUrl.includes('planetscale.com')) return { platform: 'PlanetScale' as any, url: dbUrl };
    if (dbUrl.includes('upstash.com')) return { platform: 'Upstash' as any, url: dbUrl };
    if (dbUrl.includes('mongodb.com')) return { platform: 'MongoDB Atlas' as any, url: dbUrl };
    return { platform: 'Unknown', url: dbUrl };
  }, [dbUrl]);

  const isReadyToAnalyze = hostMeta.platform !== 'Unknown' && dbMeta.platform !== 'Unknown';

  const handleAnalyze = async () => {
    if (!isReadyToAnalyze) return;
    setStatus('analyzing');
    
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostMeta, dbMeta })
      });

      if (!response.ok) {
        throw new Error('Infrastructure analysis failed');
      }

      const { text } = await response.json();
      setAnalysis(text);
      
      // Extract keys from markdown list (e.g. "SUPABASE_URL", "NEXT_PUBLIC_...")
      const keys = Array.from(text.matchAll(/`([A-Z0-9_]+)`/g)).map((m: any) => m[1]);
      const uniqueKeys = Array.from(new Set(keys));
      
      if (uniqueKeys.length > 0) {
        setPendingVars(uniqueKeys.map(k => ({ key: k, value: '' })));
      } else {
        // Fallback if regex fails
        setPendingVars([{ key: 'DATABASE_URL', value: '' }]);
      }

      setStatus('ready');
    } catch (error) {
      console.error(error);
      setAnalysis('Failed to connect to AI.');
      setStatus('idle');
    }
  };

  const handleSync = async () => {
    if (!token) {
      setShowTokenInput(true);
      return;
    }

    if (pendingVars.some(v => !v.value)) {
      setErrorMessage("Please fill all required variable values before syncing.");
      setStatus('ready');
      return;
    }

    setStatus('syncing');
    setErrorMessage(null);
    setSyncResults([]);
    
    try {
      // Create Key-Value map
      const envVarsMap = pendingVars.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});

      // Encrypt sensitive payload before transit
      const encrypted = encrypt(JSON.stringify({
        token,
        projectName: hostMeta.name,
        envVars: envVarsMap
      }));

      const response = await fetch('/api/vercel/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encrypted })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Synchronization failed at the network layer.");
      }

      setSyncResults(data.results);
      
      const newConnectionData = {
        name: hostMeta.name || 'New Stack',
        host: hostMeta,
        database: dbMeta,
        status: data.results.some((r: any) => r.status === 'failed') ? 'error' : 'active',
        lastSynced: new Date().toISOString()
      };

      if (currentUser) {
        const connRef = editingId 
          ? doc(db, 'users', currentUser.uid, 'connections', editingId)
          : doc(collection(db, 'users', currentUser.uid, 'connections'));
        
        try {
          await setDoc(connRef, {
            ...newConnectionData,
            id: connRef.id,
            userId: currentUser.uid
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${currentUser.uid}/connections`);
        }
      } else {
        const newConnection: ConnectionRecord = {
          ...newConnectionData,
          id: editingId || Math.random().toString(36).substr(2, 9),
        } as any;

        if (editingId) {
          setConnections(prev => prev.map(c => c.id === editingId ? newConnection : c));
        } else {
          setConnections(prev => [newConnection, ...prev]);
        }
      }

      setStatus('completed');
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMessage(err.message || "An unexpected synchronization error occurred.");
      
      if (editingId) {
        setConnections(prev => prev.map(c => 
          c.id === editingId ? { ...c, status: 'error' } : c
        ));
      }
    }
  };

  const resetConnector = () => {
    setHostUrl('');
    setDbUrl('');
    setStatus('idle');
    setAnalysis(null);
    setToken('');
    setShowTokenInput(false);
    setEditingId(null);
    setErrorMessage(null);
    setPendingVars([]);
    setSyncResults([]);
  };

  const deleteConnection = async (id: string) => {
    if (currentUser) {
      try {
        await deleteDoc(doc(db, 'users', currentUser.uid, 'connections', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `users/${currentUser.uid}/connections/${id}`);
      }
    } else {
      setConnections(prev => prev.filter(c => c.id !== id));
    }
  };

  const editConnection = (c: ConnectionRecord) => {
    setEditingId(c.id);
    setHostUrl(c.host.url);
    setDbUrl(c.database.url);
    setView('connect');
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-gray-200 font-sans selection:bg-blue-500/30 overflow-x-hidden relative">
      {/* Atmospheric Pulse */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <motion.div 
          animate={{ 
            opacity: [0.03, 0.08, 0.03],
            scale: [1, 1.2, 1],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] rounded-full bg-blue-500 blur-[120px]"
        />
        <motion.div 
          animate={{ 
            opacity: [0.02, 0.05, 0.02],
            scale: [1, 1.1, 1],
          }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          className="absolute top-[40%] -right-[10%] w-[50%] h-[50%] rounded-full bg-purple-500 blur-[100px]"
        />
      </div>

      {/* Background Decor */}
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
      
      {/* Header */}
      <nav className="relative border-b border-white/5 bg-black/50 backdrop-blur-xl px-6 md:px-12 py-4 md:py-6 flex items-center justify-between z-10 font-mono">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('dashboard')}>
          <div className="w-6 h-6 bg-blue-500 rounded flex items-center justify-center">
            <div className="w-2 h-2 bg-white rounded-full" />
          </div>
          <span className="font-extrabold text-base md:text-lg tracking-tighter text-white uppercase italic">Bridge_OS</span>
        </div>
        
        <div className="flex items-center gap-4 md:gap-8">
          {isAuthReady && (
            <div className="flex items-center gap-4">
              {currentUser ? (
                <div className="flex items-center gap-3">
                  <div className="hidden md:block text-right">
                    <p className="text-[10px] font-black text-white uppercase tracking-tighter leading-none">{currentUser.displayName}</p>
                    <button onClick={handleLogout} className="text-[8px] font-bold text-red-500 uppercase tracking-widest hover:underline">Logout</button>
                  </div>
                  <img src={currentUser.photoURL || ''} alt="User" className="w-8 h-8 rounded-full border border-white/10" referrerPolicy="no-referrer" />
                </div>
              ) : (
                <button 
                  onClick={handleLogin}
                  className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-[10px] font-bold text-white uppercase tracking-widest hover:bg-white hover:text-black transition-all"
                >
                  Login
                </button>
              )}
            </div>
          )}
          <div className="hidden md:block h-4 w-[1px] bg-white/10" />
          <Settings2 size={18} className="text-[#64748B] cursor-pointer hover:text-white" />
        </div>
      </nav>

      <main className="relative max-w-[1000px] mx-auto px-4 md:px-8 pt-10 md:pt-16 pb-32 z-10">
        <AnimatePresence mode="wait">
          {view === 'dashboard' ? (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-12"
            >
              {/* Stats & Title */}
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div>
                  <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-white uppercase tracking-[-0.04em] mb-4 leading-none">Central<br />Registry.</h1>
                  <p className="text-[#64748B] text-xs md:text-sm font-medium tracking-wide max-w-[300px]">Manage your infrastructure synchronization nodes across all providers.</p>
                </div>
                <button 
                  onClick={() => { resetConnector(); setView('connect'); }}
                  className="inline-flex w-fit items-center gap-3 bg-white text-black px-6 md:px-8 py-3.5 md:py-4 rounded-full font-black text-[10px] md:text-xs uppercase tracking-widest hover:scale-105 transition-all shadow-[0_0_30px_rgba(255,255,255,0.05)] active:scale-95"
                >
                  Link New Stack <Plus size={16} strokeWidth={3} />
                </button>
              </div>

              {/* Connections List */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {connections.length === 0 ? (
                  <div className="col-span-full py-20 border border-dashed border-[#27272A] rounded-[32px] flex flex-col items-center justify-center text-center bg-white/[0.02]">
                    <Layers size={48} className="text-[#27272A] mb-4" />
                    <p className="text-[#64748B] font-mono text-xs uppercase tracking-[0.2em] mb-6">No nodes connected</p>
                    <button 
                      onClick={() => setView('connect')}
                      className="text-blue-500 font-black text-xs uppercase tracking-widest hover:underline"
                    >
                      Establish first link →
                    </button>
                  </div>
                ) : (
                  connections.map((c) => (
                    <motion.div 
                      key={c.id}
                      layoutId={c.id}
                      className="group p-6 rounded-[24px] border border-[#27272A] bg-[#111113] hover:border-blue-500/50 transition-all duration-300"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                          <div className={cn("w-1.5 h-1.5 rounded-full", c.status === 'active' ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-orange-500")} />
                          <span className="text-[10px] font-black text-white uppercase tracking-widest">{c.name}</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => editConnection(c)} className="p-1.5 hover:bg-white/5 rounded-md text-[#64748B] hover:text-white transition-colors">
                            <Edit3 size={14} />
                          </button>
                          <button onClick={() => deleteConnection(c.id)} className="p-1.5 hover:bg-white/5 rounded-md text-[#64748B] hover:text-red-400 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-4 font-mono text-[10px] mb-6">
                        <div className="flex items-center justify-between py-2 border-b border-white/5">
                          <span className="text-[#64748B] uppercase tracking-tighter">HOST</span>
                          <span className="text-white truncate max-w-[120px]">{c.host.platform}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-white/5">
                          <span className="text-[#64748B] uppercase tracking-tighter">DATA</span>
                          <span className="text-white truncate max-w-[120px]">{c.database.platform}</span>
                        </div>
                        <div className="flex items-center justify-between py-2 border-b border-white/5">
                          <span className="text-[#64748B] uppercase tracking-tighter">SYNC_REF</span>
                          <span className="text-white">v2.1.0-AES</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-4">
                        <span className="text-[9px] font-bold text-[#64748B] uppercase">Last: {new Date(c.lastSynced).toLocaleDateString()}</span>
                        <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white hover:bg-blue-500 hover:text-white cursor-pointer transition-all">
                          <ArrowRight size={14} />
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="connect"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <button 
                onClick={() => setView('dashboard')}
                className="flex items-center gap-2 text-[#64748B] hover:text-white transition-colors mb-12 text-xs font-bold uppercase tracking-widest"
              >
                <ChevronLeft size={16} /> Back to Registry
              </button>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
                {/* Left Column: Hero */}
                <div className="max-w-xl">
                  <motion.h1 className="text-5xl md:text-7xl lg:text-[84px] leading-[0.85] font-[900] text-white uppercase tracking-[-0.04em] mb-6 md:mb-8">
                    {editingId ? "Update\nLink." : "Connect\nYour\nStack."}
                  </motion.h1>
                  <motion.p className="text-[#64748B] text-base md:text-lg leading-relaxed max-w-[360px]">
                    Deploy the Bridge Engine to synchronize environment variables between your provider nodes.
                  </motion.p>
                </div>

                {/* Right Column: Connector Card */}
                <div className="space-y-6 w-full">
                  <motion.div className="p-6 md:p-10 rounded-[24px] border border-[#27272A] bg-[#111113] shadow-2xl relative">
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <label className="block text-[0.7rem] md:text-[0.75rem] font-bold text-[#64748B] uppercase tracking-[0.1em]">Website Host URL</label>
                        <input 
                          type="text" 
                          placeholder="https://vercel.com/..."
                          className={cn(
                            "w-full bg-[#18181B] border rounded-xl px-4 py-4 text-sm focus:outline-none transition-all font-mono text-white",
                            hostUrl && !isValidUrl(hostUrl) ? "border-red-500/50 focus:border-red-500" : "border-[#27272A] focus:border-blue-500"
                          )}
                          value={hostUrl}
                          onChange={(e) => setHostUrl(e.target.value)}
                        />
                        <div className="flex justify-between items-center">
                          {hostMeta.platform !== 'Unknown' && (
                            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">{hostMeta.platform} detected</span>
                          )}
                          {hostUrl && !isValidUrl(hostUrl) && (
                            <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Invalid URL format</span>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="block text-[0.7rem] md:text-[0.75rem] font-bold text-[#64748B] uppercase tracking-[0.1em]">Database Instance URL</label>
                        <input 
                          type="text" 
                          placeholder="https://supabase.com/..."
                          className={cn(
                            "w-full bg-[#18181B] border rounded-xl px-4 py-4 text-sm focus:outline-none transition-all font-mono text-white",
                            dbUrl && !isValidUrl(dbUrl) ? "border-red-500/50 focus:border-red-500" : "border-[#27272A] focus:border-blue-500"
                          )}
                          value={dbUrl}
                          onChange={(e) => setDbUrl(e.target.value)}
                        />
                        <div className="flex justify-between items-center">
                          {dbMeta.platform !== 'Unknown' && (
                            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">{dbMeta.platform} detected</span>
                          )}
                          {dbUrl && !isValidUrl(dbUrl) && (
                            <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Invalid URL format</span>
                          )}
                        </div>
                      </div>

                      {status === 'idle' && (
                        <button 
                          onClick={handleAnalyze}
                          disabled={!isReadyToAnalyze}
                          className={cn(
                            "w-full py-5 rounded-xl font-bold transition-all mt-4 flex items-center justify-center gap-3",
                            isReadyToAnalyze 
                              ? "bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20 active:scale-95" 
                              : "bg-white/5 text-white/20 cursor-not-allowed border border-white/5"
                          )}
                        >
                          {editingId ? "SAVE CONFIGURATION" : "ESTABLISH CONNECTION"}
                          <Zap size={18} fill="currentColor" />
                        </button>
                      )}

                      {status === 'analyzing' && (
                        <div className="w-full py-5 flex items-center justify-center gap-3 text-[#64748B] font-bold">
                          <Loader2 size={18} className="animate-spin" />
                          PROBING STACKS...
                        </div>
                      )}

                      {status === 'ready' && analysis && (
                        <div className="space-y-6">
                          {dbMeta.platform !== 'Unknown' && (
                            <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
                                  <AlertCircle size={14} />
                                  {dbMeta.platform} Credentials Locator
                                </span>
                                <button 
                                  onClick={() => setShowHelper(!showHelper)}
                                  className="text-[9px] font-bold text-white uppercase hover:underline"
                                >
                                  {showHelper ? 'Hide Help' : `Where is my ${dbMeta.platform} key?`}
                                </button>
                              </div>
                              
                              <AnimatePresence>
                                {showHelper && (
                                  <motion.div 
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="overflow-hidden space-y-4 pt-2"
                                  >
                                    <div className="space-y-2">
                                      {dbMeta.platform === 'Supabase' && (
                                        <>
                                          <p className="text-[11px] text-[#64748B] leading-relaxed">
                                            <b className="text-white">Database Password:</b> Supabase doesn't store this in plain text. Go to <span className="text-blue-400">Settings &gt; Database &gt; Reset Password</span>.
                                          </p>
                                          <p className="text-[11px] text-[#64748B] leading-relaxed">
                                            <b className="text-white">Anon Key / URL:</b> Find these in <span className="text-blue-400">Settings &gt; API</span>.
                                          </p>
                                        </>
                                      )}
                                      {dbMeta.platform === 'Neon' && (
                                        <p className="text-[11px] text-[#64748B] leading-relaxed">
                                          <b className="text-white">Connection String:</b> Go to your <span className="text-blue-400">Project Dashboard</span>. The connection string is in the "Connection Details" widget. Choose "Pooled connection" for serverless apps.
                                        </p>
                                      )}
                                      {dbMeta.platform === 'Railway' && (
                                        <p className="text-[11px] text-[#64748B] leading-relaxed">
                                          <b className="text-white">Vars:</b> Click your <span className="text-blue-400">Database Service</span>, go to the <span className="text-blue-400">Variables</span> tab, and look for `DATABASE_URL`.
                                        </p>
                                      )}
                                      {dbMeta.platform === 'PlanetScale' && (
                                        <p className="text-[11px] text-[#64748B] leading-relaxed">
                                          <b className="text-white">Passwords:</b> Go to your <span className="text-blue-400">Branch &gt; Connect</span>. Generate a new password and copy the `DATABASE_URL`.
                                        </p>
                                      )}
                                      {dbMeta.platform === 'MongoDB Atlas' && (
                                        <p className="text-[11px] text-[#64748B] leading-relaxed">
                                          <b className="text-white">SRV String:</b> Click <span className="text-blue-400">Connect</span> on your Cluster, select "Drivers", and copy the connection string.
                                        </p>
                                      )}
                                      {dbMeta.platform === 'Upstash' && (
                                        <p className="text-[11px] text-[#64748B] leading-relaxed">
                                          <b className="text-white">Token/URL:</b> Select your Redis/Kafka instance. The URL and Token are in the <span className="text-blue-400">REST API</span> section.
                                        </p>
                                      )}
                                    </div>
                                    <div className="h-[1px] bg-white/5" />
                                    <div className="flex items-center gap-2 text-[9px] font-mono text-blue-500/60">
                                      <ShieldCheck size={10} />
                                      Values are encrypted for one-time sync session
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}

                          {analysis && (
                            <div className="p-6 rounded-2xl bg-blue-500/[0.03] border border-blue-500/10 space-y-4">
                              <h3 className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                <Cpu size={14} />
                                AI Infrastructure Audit
                              </h3>
                              <div className="text-[11px] text-gray-400 font-mono leading-relaxed overflow-y-auto max-h-[250px] pr-2 custom-scrollbar">
                                {analysis.split('\n').map((line, i) => (
                                  <p key={i} className="mb-2 last:mb-0">
                                    {line}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="p-6 rounded-2xl bg-[#18181B] border border-[#27272A] space-y-4">
                            <label className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] block mb-2">Sync Parameters Detected</label>
                            {pendingVars.map((v, i) => (
                              <div key={v.key} className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-mono text-gray-500">{v.key}</span>
                                  {isSensitive(v.key) && (
                                    <span className="text-[9px] font-black text-orange-500/60 uppercase tracking-tighter flex items-center gap-1">
                                      <ShieldCheck size={10} />
                                      Sensitive
                                    </span>
                                  )}
                                </div>
                                <input 
                                  type={isSensitive(v.key) ? "password" : "text"}
                                  value={v.value}
                                  onChange={(e) => {
                                    const next = [...pendingVars];
                                    next[i].value = e.target.value;
                                    setPendingVars(next);
                                  }}
                                  className="w-full bg-black border border-white/5 rounded-lg px-3 py-2.5 text-xs text-white focus:border-blue-500 outline-none"
                                  placeholder={`Enter ${v.key}...`}
                                />
                              </div>
                            ))}
                          </div>

                          <div className="flex items-center justify-center gap-2 text-[#64748B]">
                            <div className="h-[1px] flex-1 bg-white/5" />
                            <span className="text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5 grayscale opacity-50">
                              <RefreshCw size={10} className="animate-spin" />
                              End-to-End Encrypted Bridge
                            </span>
                            <div className="h-[1px] flex-1 bg-white/5" />
                          </div>

                          <button 
                            onClick={handleSync}
                            className="w-full py-5 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 shadow-lg shadow-blue-500/20 active:scale-95 flex items-center justify-center gap-3 text-xs uppercase tracking-widest"
                          >
                            Push to Production
                            <RefreshCw size={18} />
                          </button>
                        </div>
                      )}

                      {status === 'syncing' && (
                        <div className="w-full py-12 flex flex-col items-center justify-center gap-4 text-blue-400">
                          <div className="relative">
                            <Loader2 size={32} className="animate-spin" />
                            <div className="absolute inset-0 blur-xl bg-blue-500/20 animate-pulse" />
                          </div>
                          <span className="font-bold text-xs uppercase tracking-[0.3em]">Deploying Secrets...</span>
                        </div>
                      )}

                      {status === 'completed' && (
                        <div className="space-y-6">
                          <div className="w-full py-5 rounded-xl bg-green-500 text-white font-bold flex items-center justify-center gap-3">
                            SYNC PROTOCOL SECURED
                            <CheckCircle2 size={18} />
                          </div>

                          {syncResults.length > 0 && (
                            <div className="p-6 rounded-2xl bg-black border border-white/5 space-y-3">
                              <h5 className="text-[10px] font-black text-[#64748B] uppercase tracking-widest">Deployment Summary</h5>
                              {syncResults.map(r => (
                                <div key={r.key} className="flex items-center justify-between text-[11px] font-mono">
                                  <span className="text-gray-400">{r.key}</span>
                                  <div className="flex items-center gap-2">
                                    {r.conflict && <span className="text-orange-500 text-[9px] uppercase font-bold">[Conflict]</span>}
                                    <span className={r.status === 'synced' ? "text-green-500" : "text-red-500"}>
                                      {r.status.toUpperCase()}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <button 
                            onClick={() => {
                              resetConnector();
                              setView('dashboard');
                            }}
                            className="w-full py-4 text-xs font-bold text-[#64748B] uppercase hover:text-white transition-colors"
                          >
                            Return to Registry →
                          </button>
                        </div>
                      )}

                      {status === 'error' && errorMessage && (
                        <div className="space-y-4">
                          <div className="w-full p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 font-mono text-[10px] leading-relaxed flex items-start gap-3">
                            <AlertCircle size={14} className="shrink-0 mt-0.5" />
                            <span>{errorMessage}</span>
                          </div>
                          <button 
                            onClick={handleSync}
                            className="w-full py-4 rounded-xl bg-white text-black font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-3 text-xs uppercase tracking-widest"
                          >
                            Retrying sync...
                            <RefreshCw size={16} />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="mt-8 pt-6 border-t border-dashed border-[#27272A] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={cn("w-2 h-2 rounded-full", hostMeta.platform !== 'Unknown' ? "bg-blue-500 shadow-[0_0_10px_#3B82F6]" : "bg-[#64748B]")} />
                        <span className="text-[0.8rem] font-bold text-white uppercase tracking-tighter">Host</span>
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        <span className="text-[0.8rem] font-bold text-white uppercase tracking-tighter">Data</span>
                        <div className={cn("w-2 h-2 rounded-full", dbMeta.platform !== 'Unknown' ? "bg-blue-500 shadow-[0_0_10px_#3B82F6]" : "bg-[#64748B]")} />
                      </div>
                    </div>
                  </motion.div>

                  {showTokenInput && !token && status !== 'syncing' && status !== 'completed' && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-6 rounded-2xl border border-orange-500/20 bg-orange-500/5"
                    >
                      <label className="block text-[10px] uppercase font-black text-orange-500 mb-2">AUTH_KEY_REQUIRED</label>
                      <div className="flex gap-2">
                        <input 
                          type="password" 
                          placeholder="API Token..."
                          className="flex-1 bg-black border border-white/10 rounded-lg px-3 py-2 text-xs focus:border-orange-500 outline-none font-mono"
                          value={token}
                          onChange={(e) => setToken(e.target.value)}
                        />
                        <button 
                          onClick={handleSync}
                          className="px-4 py-2 bg-orange-500 text-white text-xs font-bold rounded-lg uppercase tracking-tight"
                        >
                          Sync
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {analysis && (
                    <motion.div className="p-6 md:p-8 rounded-[24px] border border-[#27272A] bg-[#111113]/50 backdrop-blur-sm">
                      <h4 className="text-[10px] md:text-xs font-black uppercase tracking-[0.2em] text-[#64748B] mb-4 flex items-center gap-2">
                        <ShieldCheck size={14} className="text-blue-500" />
                        Infrastructure Audit
                      </h4>
                      <div className="font-mono text-[11px] text-gray-500 whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-white/10 break-words">
                        {analysis}
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Floating Status Bar */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 md:p-8 pt-0 pointer-events-none z-50">
        <div className="max-w-[1000px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4 pointer-events-auto bg-black/40 md:bg-transparent backdrop-blur-md md:backdrop-blur-none p-4 md:p-0 rounded-t-2xl md:rounded-none border-t border-white/5 md:border-none">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_#3B82F6]" />
            <AnimatePresence mode="wait">
              <motion.span 
                key={tickerMessage}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-[#64748B]"
              >
                Node_State: {tickerMessage}
              </motion.span>
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-4 md:gap-6">
            <div className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-[#64748B]">
              Active_Links: {connections.length}
            </div>
            <div className="hidden md:block h-4 w-[1px] bg-white/5" />
            <div className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] text-white">
              Bridge_v5.4.0
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
