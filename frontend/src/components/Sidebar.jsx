import { PieChart, FileText, MessageSquare, LogOut, Briefcase } from 'lucide-react';
import { authAPI } from '../services/api';

export default function Sidebar({ activeTab, setActiveTab, onLogout }) {
  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } catch (e) {
      console.error(e);
    } finally {
      onLogout();
    }
  };

  return (
    <aside className="w-64 bg-slate-900 text-white p-6 flex flex-col">
      <h1 className="text-2xl font-bold mb-2">Indicio</h1>
      <p className="text-xs text-slate-400 mb-8">Enterprise Edition</p>
      <nav className="flex-1 space-y-2">
        <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center p-3 rounded ${activeTab === 'dashboard' ? 'bg-blue-600' : 'hover:bg-slate-800'}`}>
          <PieChart className="w-5 h-5 mr-3"/> Dashboard
        </button>
        <button onClick={() => setActiveTab('repository')} className={`w-full flex items-center p-3 rounded ${activeTab === 'repository' ? 'bg-blue-600' : 'hover:bg-slate-800'}`}>
          <FileText className="w-5 h-5 mr-3"/> Repositorio
        </button>
        <button onClick={() => setActiveTab('vacancies')} className={`w-full flex items-center p-3 rounded ${activeTab === 'vacancies' ? 'bg-blue-600' : 'hover:bg-slate-800'}`}>
          <Briefcase className="w-5 h-5 mr-3"/> Vacantes / HR
        </button>
        <button onClick={() => setActiveTab('chat')} className={`w-full flex items-center p-3 rounded ${activeTab === 'chat' ? 'bg-blue-600' : 'hover:bg-slate-800'}`}>
          <MessageSquare className="w-5 h-5 mr-3"/> Asistente IA
        </button>
      </nav>
      <div className="pt-4 border-t border-slate-700 mt-auto">
        <button onClick={handleLogout} className="w-full flex items-center p-3 rounded text-slate-400 hover:bg-red-600 hover:text-white transition-colors">
          <LogOut className="w-5 h-5 mr-3" /> Cerrar Sesión
        </button>
      </div>
    </aside>
  );
}
