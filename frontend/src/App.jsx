import { useState, useEffect } from 'react';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Repository from './components/Repository';
import Assistant from './components/Assistant';
import Vacancies from './components/Vacancies';
import CompanyUsers from './components/CompanyUsers';
import SuperAdminConsole from './components/SuperAdminConsole';
import { documentAPI, folderAPI, dashboardAPI, authAPI } from './services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [token, setToken] = useState(sessionStorage.getItem('token') || null);
  const [role, setRole] = useState(sessionStorage.getItem('role') || null);
  
  // Data States
  const [documents, setDocuments] = useState([]);
  const [folders, setFolders] = useState([]);
  const [stats, setStats] = useState({ total: 0, processed: 0, errors: 0, categories: {} });

  useEffect(() => {
    const handleAuthError = () => {
      setToken(null);
      setRole(null);
    };
    window.addEventListener('auth-error', handleAuthError);
    return () => window.removeEventListener('auth-error', handleAuthError);
  }, []);

  useEffect(() => {
    if (token) {
      sessionStorage.setItem('token', token);
      const currentRole = sessionStorage.getItem('role');
      setRole(currentRole);
      if (currentRole !== 'superadmin') {
        fetchData();
      }
    } else {
      sessionStorage.removeItem('token');
    }
  }, [token]);

  const fetchData = async () => {
    try {
      const [docsRes, foldersRes, statsRes, meRes] = await Promise.all([
        documentAPI.getAll(),
        folderAPI.getAll(),
        dashboardAPI.getStats(),
        authAPI.me().catch(() => null)
      ]);
      setDocuments(docsRes.data);
      setFolders(foldersRes.data);
      setStats(statsRes.data);
      if (meRes?.data) {
        if (meRes.data.tenant_name) sessionStorage.setItem('tenant_name', meRes.data.tenant_name);
        if (meRes.data.role) {
          sessionStorage.setItem('role', meRes.data.role);
          setRole(meRes.data.role);
        }
      }
    } catch (error) {
      console.error("Error fetching data", error);
    }
  };

  const handleLoginSuccess = (newToken, loginData) => {
    if (loginData?.role) {
      setRole(loginData.role);
    } else {
      setRole(sessionStorage.getItem('role'));
    }
    setActiveTab('dashboard');
    setToken(newToken);
  };

  const handleLogout = () => {
    setToken(null);
    setRole(null);
    setActiveTab('dashboard');
  };

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // Interfaz exclusiva de Superusuario Global SaaS (AdminEstebanM@gmail.com)
  if (role === 'superadmin') {
    return <SuperAdminConsole onLogout={handleLogout} />;
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />
      <main className="flex-1 p-8 overflow-y-auto">
        {activeTab === 'dashboard' && <Dashboard stats={stats} />}
        {activeTab === 'repository' && <Repository folders={folders} documents={documents} fetchData={fetchData} />}
        {activeTab === 'vacancies' && <Vacancies documents={documents} fetchData={fetchData} />}
        {activeTab === 'chat' && <Assistant documents={documents} />}
        {activeTab === 'users' && role === 'admin' && <CompanyUsers />}
      </main>
    </div>
  );
}
