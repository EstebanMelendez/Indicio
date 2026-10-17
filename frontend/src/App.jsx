import { useState, useEffect } from 'react';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Repository from './components/Repository';
import Assistant from './components/Assistant';
import Vacancies from './components/Vacancies';
import { documentAPI, folderAPI, dashboardAPI, vacancyAPI } from './services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [token, setToken] = useState(sessionStorage.getItem('token') || null);
  
  // Data States
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [stats, setStats] = useState({ total: 0, processed: 0, errors: 0, categories: {} });

  useEffect(() => {
    const handleAuthError = () => {
      setToken(null);
    };
    window.addEventListener('auth-error', handleAuthError);
    return () => window.removeEventListener('auth-error', handleAuthError);
  }, []);

  useEffect(() => {
    if (token) {
      sessionStorage.setItem('token', token);
      fetchData();
    } else {
      sessionStorage.removeItem('token');
    }
  }, [token]);

  const fetchData = async () => {
    try {
      const [docsRes, foldersRes, statsRes] = await Promise.all([
        documentAPI.getAll(),
        folderAPI.getAll(),
        dashboardAPI.getStats()
      ]);
      setDocuments(docsRes.data);
      setFolders(foldersRes.data);
      setStats(statsRes.data);
    } catch (error) {
      console.error("Error fetching data", error);
    }
  };

  const handleLoginSuccess = (newToken) => {
    setToken(newToken);
  };

  const handleLogout = () => {
    setToken(null);
  };

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />
      <main className="flex-1 p-8 overflow-y-auto">
        {activeTab === 'dashboard' && <Dashboard stats={stats} />}
        {activeTab === 'repository' && <Repository folders={folders} documents={documents} fetchData={fetchData} />}
        {activeTab === 'vacancies' && <Vacancies documents={documents} fetchData={fetchData} />}
        {activeTab === 'chat' && <Assistant documents={documents} />}
      </main>
    </div>
  );
}
