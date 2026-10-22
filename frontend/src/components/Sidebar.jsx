import { PieChart, FileText, MessageSquare, LogOut, Briefcase } from 'lucide-react';
import { authAPI } from '../services/api';
import brandLogo from '../assets/brand_logo.png';

export default function Sidebar({ activeTab, setActiveTab, onLogout }) {
  const role = sessionStorage.getItem('role') || 'usuario';

  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } catch (e) {
      console.error(e);
    } finally {
      sessionStorage.removeItem('role');
      onLogout();
    }
  };

  return (
    <aside className="w-64 bg-slate-900 text-white p-6 flex flex-col">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <div className="bg-slate-800/90 p-1.5 rounded-xl border border-slate-700/60 shadow-sm flex items-center justify-center">
            <img src={brandLogo} alt="Logo" className="w-10 h-7 object-contain drop-shadow" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight leading-tight">Indicio</h1>
            <p className="text-[11px] text-slate-400 font-medium">Enterprise Edition</p>
          </div>
        </div>
        <div className="mt-3">
          <span className={`inline-block px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider rounded border ${
            role === 'admin' ? 'bg-indigo-950/80 text-indigo-300 border-indigo-700' :
            role === 'auditor' ? 'bg-amber-950/80 text-amber-300 border-amber-700' :
            'bg-slate-800 text-slate-300 border-slate-700'
          }`}>
            Rol: {role}
          </span>
        </div>
      </div>
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
