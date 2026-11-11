import { useState, useEffect } from 'react';
import {
  Building2, UserPlus, ShieldCheck, FolderLock, Users, FileText,
  Trash2, LogOut, RefreshCw, CheckCircle2, AlertCircle, KeyRound, Crown, Plus, Mail
} from 'lucide-react';
import { superadminAPI, authAPI } from '../services/api';
import brandLogo from '../assets/brand_logo.png';

export default function SuperAdminConsole({ onLogout }) {
  const [tenants, setTenants] = useState([]);
  const [superEmail, setSuperEmail] = useState(sessionStorage.getItem('user_email') || 'AdminEstebanM@gmail.com');
  const [loading, setLoading] = useState(true);

  // Formulario de nueva empresa + admin
  const [tenantName, setTenantName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [gmailUser, setGmailUser] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [createDefaultVacancy, setCreateDefaultVacancy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Modal / formulario rápido para agregar otro admin a una empresa existente
  const [addingToTenantId, setAddingToTenantId] = useState(null);
  const [extraEmail, setExtraEmail] = useState('');
  const [extraPassword, setExtraPassword] = useState('');
  const [extraRole, setExtraRole] = useState('admin');

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const res = await superadminAPI.getTenants();
      setTenants(res.data.tenants || []);
      if (res.data.superadmin_email) {
        setSuperEmail(res.data.superadmin_email);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudo cargar la lista de empresas.'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  const handleCreateTenant = async (e) => {
    e.preventDefault();
    setFeedback(null);
    setSubmitting(true);
    try {
      const res = await superadminAPI.createTenant({
        tenant_name: tenantName.trim(),
        admin_email: adminEmail.trim(),
        admin_password: adminPassword.trim(),
        gmail_user: gmailUser.trim() || null,
        gmail_app_password: gmailAppPassword.trim() || null,
        create_default_vacancy: createDefaultVacancy
      });
      setFeedback({
        type: 'success',
        message: res.data.message,
        createdCredentials: {
          company: tenantName.trim(),
          email: adminEmail.trim(),
          password: adminPassword.trim(),
          storage: res.data.tenant?.storage_path
        }
      });
      setTenantName('');
      setAdminEmail('');
      setAdminPassword('');
      setGmailUser('');
      setGmailAppPassword('');
      fetchTenants();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'Error al registrar la nueva empresa.'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddUserToExistingTenant = async (e, tenantId) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await superadminAPI.addUserToTenant(tenantId, {
        email: extraEmail.trim(),
        password: extraPassword.trim(),
        role: extraRole
      });
      setFeedback({ type: 'success', message: res.data.message });
      setAddingToTenantId(null);
      setExtraEmail('');
      setExtraPassword('');
      fetchTenants();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'Error al agregar el usuario a la empresa.'
      });
    }
  };

  const handleDeleteTenant = async (tenant) => {
    if (tenant.id === 1) return;
    if (!window.confirm(`¿Estás seguro de eliminar la empresa "${tenant.name}" (Tenant #${tenant.id}) y todos sus usuarios y archivos aislados?`)) {
      return;
    }
    try {
      const res = await superadminAPI.deleteTenant(tenant.id);
      setFeedback({ type: 'success', message: res.data.message });
      fetchTenants();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudo eliminar la empresa.'
      });
    }
  };

  const handleLogoutClick = async () => {
    try {
      await authAPI.logout();
    } catch (e) {
      // ignore
    } finally {
      sessionStorage.removeItem('role');
      sessionStorage.removeItem('user_email');
      sessionStorage.removeItem('tenant_name');
      sessionStorage.removeItem('tenant_id');
      onLogout();
    }
  };

  const totalUsers = tenants.reduce((acc, t) => acc + (t.users_count || 0), 0);
  const totalDocs = tenants.reduce((acc, t) => acc + (t.documents_count || 0), 0);
  const totalAdmins = tenants.reduce((acc, t) => acc + (t.admins?.length || 0), 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Navbar exclusiva del Superusuario */}
      <header className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border-b border-indigo-800/50 px-8 py-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-4">
          <div className="bg-slate-800/90 p-2 rounded-xl border border-indigo-500/40 shadow">
            <img src={brandLogo} alt="Indicio" className="w-10 h-7 object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-black tracking-tight text-white">Indicio SaaS · Consola Global Multi-Tenant</h1>
              <span className="px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40 flex items-center gap-1">
                <Crown className="w-3.5 h-3.5" /> Superusuario
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Sesión maestra: <strong className="text-indigo-300">{superEmail}</strong> · Aislamiento físico y lógico de empresas (Ley 1581 de 2012)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchTenants}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </button>
          <button
            onClick={handleLogoutClick}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/90 hover:bg-red-600 text-white text-xs font-bold shadow transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" /> Cerrar Sesión
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-8 space-y-8">
        {/* Tarjetas KPI Globales */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-slate-400">Empresas (Tenants)</p>
              <p className="text-3xl font-black text-white mt-1">{tenants.length}</p>
              <p className="text-[11px] text-indigo-400 mt-1">Entornos aislados activos</p>
            </div>
            <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              <Building2 className="w-7 h-7" />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-slate-400">Admins de Empresa</p>
              <p className="text-3xl font-black text-white mt-1">{totalAdmins}</p>
              <p className="text-[11px] text-emerald-400 mt-1">Cuentas líderes por organización</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <ShieldCheck className="w-7 h-7" />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-slate-400">Usuarios Totales</p>
              <p className="text-3xl font-black text-white mt-1">{totalUsers}</p>
              <p className="text-[11px] text-blue-400 mt-1">Admins, Auditores y Operadores</p>
            </div>
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <Users className="w-7 h-7" />
            </div>
          </div>

          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase font-bold tracking-wider text-slate-400">Documentos en Bóvedas</p>
              <p className="text-3xl font-black text-white mt-1">{totalDocs}</p>
              <p className="text-[11px] text-amber-400 mt-1">Cifrados con AES-128 + RSA-2048</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <FolderLock className="w-7 h-7" />
            </div>
          </div>
        </div>

        {/* Alertas de Feedback */}
        {feedback && (
          <div className={`p-4 rounded-xl border flex flex-col gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-200'
              : 'bg-red-950/60 border-red-600/50 text-red-200'
          }`}>
            <div className="flex items-center gap-2 font-bold text-sm">
              {feedback.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5 text-red-400" />}
              <span>{feedback.message}</span>
            </div>
            {feedback.createdCredentials && (
              <div className="mt-1 bg-slate-900/90 border border-emerald-700/50 rounded-lg p-3 text-xs text-slate-200 space-y-1">
                <p className="font-bold text-emerald-300">Credenciales listas para entregar al Administrador de la nueva empresa:</p>
                <p>• <strong>Empresa (Tenant):</strong> {feedback.createdCredentials.company}</p>
                <p>• <strong>Usuario Admin:</strong> <code className="text-amber-300">{feedback.createdCredentials.email}</code></p>
                <p>• <strong>Contraseña:</strong> <code className="text-amber-300">{feedback.createdCredentials.password}</code></p>
                <p>• <strong>Bóveda física aislada:</strong> <code>{feedback.createdCredentials.storage}</code></p>
                <p className="text-[11px] text-slate-400 pt-1">
                  Al iniciar sesión con este Administrador, verá su empresa limpia y tendrá habilitada la pestaña exclusiva <strong>"Usuarios y Roles"</strong> para crear sus propios Operadores (<code>user</code>) y Auditores (<code>auditor</code>).
                </p>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Columna Izquierda: Formulario de Alta de Nueva Empresa + Admin */}
          <div className="lg:col-span-1">
            <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-6 shadow-xl sticky top-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 rounded-xl bg-indigo-600 text-white">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Dar de Alta Nueva Empresa</h2>
                  <p className="text-xs text-slate-400">Crea el Tenant aislado y su Administrador</p>
                </div>
              </div>

              <form onSubmit={handleCreateTenant} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                    Nombre de la Empresa / Organización
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Constructora Bolívar S.A.S."
                    value={tenantName}
                    onChange={(e) => setTenantName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                    Correo del Administrador de la Empresa
                  </label>
                  <input
                    type="email"
                    placeholder="Ej: admin@constructorabolivar.com"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                    Contraseña Inicial del Admin
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Mínimo 4 caracteres"
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      required
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800 space-y-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5" /> Enlace Gmail al Repositorio (Opcional)
                  </p>
                  <input
                    type="email"
                    placeholder="Correo Gmail de la empresa (o lo configura su Admin)"
                    value={gmailUser}
                    onChange={(e) => setGmailUser(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                  <input
                    type="password"
                    placeholder="Contraseña de Aplicación Google (16 letras)"
                    value={gmailAppPassword}
                    onChange={(e) => setGmailAppPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <label className="flex items-start gap-2.5 bg-slate-950/70 border border-slate-800 rounded-lg p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createDefaultVacancy}
                    onChange={(e) => setCreateDefaultVacancy(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600"
                  />
                  <span className="text-xs text-slate-300 leading-relaxed">
                    Crear vacante corporativa inicial abierta (para pruebas inmediatas de Hojas de Vida).
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl shadow-lg transition flex items-center justify-center gap-2 text-sm cursor-pointer"
                >
                  <Building2 className="w-4 h-4" />
                  {submitting ? 'Creando Empresa y Bóveda...' : 'Crear Empresa y Administrador'}
                </button>
              </form>
            </div>
          </div>

          {/* Columna Derecha: Listado de Empresas Registradas */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Empresas Registradas en la Plataforma ({tenants.length})</h2>
                <p className="text-xs text-slate-400">
                  Cada empresa posee su propio <code>tenant_id</code> en PostgreSQL y su carpeta física aislada.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center text-slate-400 text-sm">
                Cargando empresas registradas...
              </div>
            ) : (
              <div className="space-y-4">
                {tenants.map((t) => (
                  <div
                    key={t.id}
                    className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-6 transition space-y-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <span className="px-2.5 py-0.5 text-xs font-black rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            Tenant #{t.id}
                          </span>
                          <h3 className="text-lg font-bold text-white">{t.name}</h3>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-3">
                          <span className="flex items-center gap-1.5">
                            <FolderLock className="w-3.5 h-3.5 text-indigo-400" />
                            Bóveda aislada: <code className="text-slate-300">{t.storage_path}</code>
                          </span>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${
                            t.gmail_linked
                              ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}>
                            <Mail className="w-3 h-3" />
                            {t.gmail_user ? `Gmail: ${t.gmail_user}` : 'Sin Gmail enlazado'}
                          </span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setAddingToTenantId(addingToTenantId === t.id ? null : t.id)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" /> Agregar Admin/Usuario
                        </button>
                        {t.id !== 1 && (
                          <button
                            onClick={() => handleDeleteTenant(t)}
                            className="p-2 rounded-lg bg-red-950/50 hover:bg-red-900/70 text-red-300 border border-red-800/50 transition cursor-pointer"
                            title="Eliminar Empresa"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Métricas de la Empresa */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                      <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3">
                        <span className="text-[11px] text-slate-400 block">Usuarios</span>
                        <span className="text-lg font-bold text-white">{t.users_count}</span>
                      </div>
                      <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3">
                        <span className="text-[11px] text-slate-400 block">Documentos</span>
                        <span className="text-lg font-bold text-white">{t.documents_count}</span>
                      </div>
                      <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3">
                        <span className="text-[11px] text-slate-400 block">Carpetas</span>
                        <span className="text-lg font-bold text-white">{t.folders_count}</span>
                      </div>
                      <div className="bg-slate-950/80 border border-slate-800/80 rounded-lg p-3">
                        <span className="text-[11px] text-slate-400 block">Vacantes HR</span>
                        <span className="text-lg font-bold text-white">{t.vacancies_count}</span>
                      </div>
                    </div>

                    {/* Formulario rápido para añadir usuario a este tenant */}
                    {addingToTenantId === t.id && (
                      <form
                        onSubmit={(e) => handleAddUserToExistingTenant(e, t.id)}
                        className="bg-slate-950 border border-indigo-500/40 rounded-xl p-4 space-y-3"
                      >
                        <p className="text-xs font-bold text-indigo-300">
                          Crear nueva cuenta dentro de "{t.name}" (Tenant #{t.id})
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <input
                            type="email"
                            placeholder="Correo electrónico"
                            value={extraEmail}
                            onChange={(e) => setExtraEmail(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                            required
                          />
                          <input
                            type="text"
                            placeholder="Contraseña"
                            value={extraPassword}
                            onChange={(e) => setExtraPassword(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                            required
                          />
                          <select
                            value={extraRole}
                            onChange={(e) => setExtraRole(e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                          >
                            <option value="admin">Rol: Administrador (admin)</option>
                            <option value="auditor">Rol: Auditor Ley 1581 (auditor)</option>
                            <option value="user">Rol: Operador (user)</option>
                          </select>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setAddingToTenantId(null)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
                          >
                            Cancelar
                          </button>
                          <button
                            type="submit"
                            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                          >
                            Guardar Cuenta
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Lista de Usuarios de esta empresa */}
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                        Cuentas registradas en esta empresa ({t.users?.length || 0})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(t.users || []).map((u) => (
                          <div
                            key={u.id}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                          >
                            <span className="font-medium text-slate-200">{u.email}</span>
                            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${
                              u.role === 'admin'
                                ? 'bg-indigo-950 text-indigo-300 border border-indigo-700'
                                : u.role === 'auditor'
                                ? 'bg-amber-950 text-amber-300 border border-amber-700'
                                : 'bg-slate-800 text-slate-300'
                            }`}>
                              {u.role}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

