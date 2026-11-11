import { useState, useEffect } from 'react';
import {
  Users, UserPlus, Shield, Eye, Trash2, KeyRound, Building2,
  CheckCircle2, AlertCircle, Search, RefreshCw, Mail, Link2, FolderLock
} from 'lucide-react';
import { adminUsersAPI, emailAPI } from '../services/api';

export default function CompanyUsers() {
  const [users, setUsers] = useState([]);
  const [tenantName, setTenantName] = useState(sessionStorage.getItem('tenant_name') || 'Mi Empresa');
  const [tenantId, setTenantId] = useState(sessionStorage.getItem('tenant_id') || 1);
  const [loading, setLoading] = useState(true);

  // Estado del enlace de Gmail con el Repositorio de la Empresa
  const [gmailUser, setGmailUser] = useState('');
  const [gmailAppPassword, setGmailAppPassword] = useState('');
  const [hasImapCredentials, setHasImapCredentials] = useState(false);
  const [appPasswordMasked, setAppPasswordMasked] = useState(null);
  const [storagePath, setStoragePath] = useState(`storage/tenant_${tenantId}/`);
  const [verifyImapConnection, setVerifyImapConnection] = useState(false);
  const [savingEmailConfig, setSavingEmailConfig] = useState(false);
  const [syncingGmailNow, setSyncingGmailNow] = useState(false);

  // Formulario para crear usuario o auditor
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Filtros y cambio de contraseña
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [resetUserId, setResetUserId] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const fetchCompanyData = async () => {
    setLoading(true);
    try {
      const [usersRes, emailCfgRes] = await Promise.all([
        adminUsersAPI.getUsers(),
        adminUsersAPI.getEmailConfig().catch(() => null)
      ]);
      setUsers(usersRes.data.users || []);
      if (usersRes.data.tenant_name) {
        setTenantName(usersRes.data.tenant_name);
        sessionStorage.setItem('tenant_name', usersRes.data.tenant_name);
      }
      if (usersRes.data.tenant_id) {
        setTenantId(usersRes.data.tenant_id);
      }
      if (emailCfgRes?.data) {
        setGmailUser(emailCfgRes.data.gmail_user || '');
        setHasImapCredentials(Boolean(emailCfgRes.data.has_imap_credentials));
        setAppPasswordMasked(emailCfgRes.data.app_password_masked || null);
        if (emailCfgRes.data.storage_path) {
          setStoragePath(emailCfgRes.data.storage_path);
        }
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'Error al cargar los datos de la empresa.'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanyData();
  }, []);

  const handleSaveEmailConfig = async (e) => {
    e.preventDefault();
    setFeedback(null);
    setSavingEmailConfig(true);
    try {
      const res = await adminUsersAPI.updateEmailConfig({
        gmail_user: gmailUser.trim(),
        gmail_app_password: gmailAppPassword.trim() || null,
        verify_connection: verifyImapConnection
      });
      setFeedback({ type: 'success', message: res.data.message });
      setGmailAppPassword('');
      if (res.data.config) {
        setGmailUser(res.data.config.gmail_user || '');
        setHasImapCredentials(Boolean(res.data.config.has_imap_credentials));
        setAppPasswordMasked(res.data.config.app_password_masked || null);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudo enlazar el correo Gmail con el repositorio.'
      });
    } finally {
      setSavingEmailConfig(false);
    }
  };

  const handleTestSyncGmail = async () => {
    setFeedback(null);
    setSyncingGmailNow(true);
    try {
      const res = await emailAPI.syncInbox();
      const d = res.data || {};
      if (!d.checked) {
        setFeedback({ type: 'error', message: d.reason || 'No se pudo sincronizar el correo Gmail.' });
      } else if (d.downloaded > 0) {
        setFeedback({
          type: 'success',
          message: `¡Sincronización exitosa! ${d.downloaded} archivo(s) descargado(s) desde ${d.gmail_user || gmailUser} hacia ${storagePath} (${d.files.join(', ')}).`
        });
      } else {
        setFeedback({
          type: 'success',
          message: `Conexión activa con ${d.gmail_user || gmailUser} → ${storagePath}. Bandeja al día (0 adjuntos nuevos pendientes).`
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'Error al sincronizar la bandeja de Gmail.'
      });
    } finally {
      setSyncingGmailNow(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setFeedback(null);
    setSubmitting(true);
    try {
      const res = await adminUsersAPI.createUser({
        email: newEmail.trim(),
        password: newPassword.trim(),
        role: newRole
      });
      setFeedback({
        type: 'success',
        message: res.data.message
      });
      setNewEmail('');
      setNewPassword('');
      setNewRole('user');
      fetchCompanyData();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudo crear el usuario.'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeRole = async (userId, updatedRole) => {
    setFeedback(null);
    try {
      const res = await adminUsersAPI.updateRole(userId, updatedRole);
      setFeedback({ type: 'success', message: res.data.message });
      fetchCompanyData();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudo actualizar el rol.'
      });
    }
  };

  const handleResetPassword = async (e, userId) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const res = await adminUsersAPI.updatePassword(userId, resetPasswordValue.trim());
      setFeedback({ type: 'success', message: res.data.message });
      setResetUserId(null);
      setResetPasswordValue('');
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudo actualizar la contraseña.'
      });
    }
  };

  const handleDeleteUser = async (u) => {
    if (u.is_current_user) return;
    if (!window.confirm(`¿Desea revocar el acceso y eliminar al usuario "${u.email}" (${u.role}) de su empresa?`)) {
      return;
    }
    setFeedback(null);
    try {
      const res = await adminUsersAPI.deleteUser(u.id);
      setFeedback({ type: 'success', message: res.data.message });
      fetchCompanyData();
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.response?.data?.detail || 'No se pudo eliminar el usuario.'
      });
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch = u.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const countByRole = (r) => users.filter((u) => u.role === r).length;

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> {tenantName} (Tenant #{tenantId})
            </span>
            <span className="px-2.5 py-1 text-xs font-bold uppercase rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
              RBAC · Ley 1581 de 2012
            </span>
          </div>
          <h2 className="text-2xl font-black text-slate-800 mt-2">Administración de Empresa: Usuarios, Roles y Correo Gmail</h2>
          <p className="text-sm text-slate-500">
            Enlaza el correo Gmail de tu empresa con su repositorio aislado (<code>{storagePath}</code>) y gestiona las cuentas de <strong>Operadores (user)</strong> y <strong>Auditores (auditor)</strong>.
          </p>
        </div>

        <button
          onClick={fetchCompanyData}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar Panel
        </button>
      </div>

      {/* Alerta de resultado */}
      {feedback && (
        <div className={`p-4 rounded-xl border flex items-center gap-2.5 text-sm font-medium ${
          feedback.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* SECCIÓN NUEVA: ENLACE DE CORREO GMAIL CON EL REPOSITORIO DE LA EMPRESA */}
      <div className="bg-white border border-indigo-200/80 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-600 text-white">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                Enlace de Correo Gmail con el Repositorio de {tenantName}
              </h3>
              <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                <FolderLock className="w-3.5 h-3.5 text-indigo-600" />
                Los adjuntos recibidos en este Gmail se descargan automáticamente en <code>{storagePath}</code> (Carpeta <strong>"Bandeja Correo"</strong>).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasImapCredentials ? (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Gmail Enlazado ({gmailUser})
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                Pendiente enlazar Contraseña de Aplicación
              </span>
            )}
          </div>
        </div>

        <form onSubmit={handleSaveEmailConfig} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end pt-1">
          <div className="md:col-span-5">
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Correo Gmail de la Empresa (Ingesta IMAP y Aprobaciones SMTP)
            </label>
            <input
              type="email"
              placeholder="Ej: facturacion.empresa@gmail.com"
              value={gmailUser}
              onChange={(e) => setGmailUser(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
              Contraseña de Aplicación Google (16 letras)
              {appPasswordMasked && (
                <span className="ml-2 text-[11px] font-normal text-emerald-600">
                  Actual: <code>{appPasswordMasked}</code>
                </span>
              )}
            </label>
            <input
              type="password"
              placeholder={hasImapCredentials ? 'Dejar vacío para conservar la actual o pegar nueva' : 'Ej: xxxx xxxx xxxx xxxx'}
              value={gmailAppPassword}
              onChange={(e) => setGmailAppPassword(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="md:col-span-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={verifyImapConnection}
                onChange={(e) => setVerifyImapConnection(e.target.checked)}
                className="rounded text-indigo-600"
              />
              <span>Probar login IMAP al guardar</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={savingEmailConfig}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold py-2.5 px-3 rounded-xl shadow transition flex items-center justify-center gap-1.5 text-xs cursor-pointer"
              >
                <Link2 className="w-4 h-4" />
                {savingEmailConfig ? 'Enlazando...' : 'Enlazar Gmail'}
              </button>
              <button
                type="button"
                onClick={handleTestSyncGmail}
                disabled={syncingGmailNow}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2.5 px-3 rounded-xl shadow transition flex items-center justify-center gap-1 text-xs cursor-pointer"
                title="Sincronizar bandeja de Gmail con el repositorio ahora"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingGmailNow ? 'animate-spin' : ''}`} />
                Sincronizar
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Resumen de Roles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-xs font-bold uppercase text-indigo-600">Administradores (admin)</span>
            <p className="text-2xl font-black text-slate-800 mt-0.5">{countByRole('admin')}</p>
            <p className="text-xs text-slate-500 mt-0.5">Control total, aprobación y gestión de usuarios</p>
          </div>
          <div className="p-3 rounded-xl bg-indigo-50 text-indigo-600">
            <Shield className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-xs font-bold uppercase text-amber-600">Auditores Ley 1581 (auditor)</span>
            <p className="text-2xl font-black text-slate-800 mt-0.5">{countByRole('auditor')}</p>
            <p className="text-xs text-slate-500 mt-0.5">Auditoría de flujos IA y trazabilidad en solo lectura</p>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 text-amber-600">
            <Eye className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-xs font-bold uppercase text-blue-600">Operadores (user)</span>
            <p className="text-2xl font-black text-slate-800 mt-0.5">{countByRole('user')}</p>
            <p className="text-xs text-slate-500 mt-0.5">Carga de documentos/facturas y consulta IA</p>
          </div>
          <div className="p-3 rounded-xl bg-blue-50 text-blue-600">
            <Users className="w-6 h-6" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Columna Izquierda: Crear nuevo miembro */}
        <div className="lg:col-span-1">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-blue-600 text-white">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Registrar Nuevo Usuario</h3>
                <p className="text-xs text-slate-500">Asignado a {tenantName}</p>
              </div>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Correo Corporativo
                </label>
                <input
                  type="email"
                  placeholder="ejemplo@empresa.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Contraseña de Acceso
                </label>
                <input
                  type="text"
                  placeholder="Mínimo 4 caracteres"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-slate-600 mb-1">
                  Rol dentro de la Empresa
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="user">Operador (user) — Subida y Asistente IA</option>
                  <option value="auditor">Auditor (auditor) — Auditoría Ley 1581</option>
                  <option value="admin">Administrador (admin) — Control Total</option>
                </select>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-1">
                {newRole === 'user' && (
                  <p><strong>Permisos de Operador:</strong> Puede subir documentos/facturas y usar el Asistente IA. No tiene acceso al historial de auditoría ni puede borrar archivos ni ver esta pestaña.</p>
                )}
                {newRole === 'auditor' && (
                  <p><strong>Permisos de Auditor:</strong> Puede inspeccionar el Historial de Auditoría (<code>WorkflowAuditLog</code>) y revisar documentos en modo lectura. No puede borrar documentos ni ver esta pestaña.</p>
                )}
                {newRole === 'admin' && (
                  <p><strong>Permisos de Administrador:</strong> Puede gestionar carpetas, aprobar facturas, eliminar documentos (Supresión Ley 1581) y administrar usuarios y el correo Gmail de esta empresa.</p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl shadow transition flex items-center justify-center gap-2 text-sm cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                {submitting ? 'Registrando...' : 'Crear Cuenta en mi Empresa'}
              </button>
            </form>
          </div>
        </div>

        {/* Columna Derecha: Lista de Usuarios de la Empresa */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-bold text-slate-800">
                Directorio de Usuarios de {tenantName} ({filteredUsers.length})
              </h3>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Buscar por correo..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700"
                >
                  <option value="ALL">Todos los roles</option>
                  <option value="admin">Solo Admins</option>
                  <option value="auditor">Solo Auditores</option>
                  <option value="user">Solo Operadores</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-400">
                    <th className="py-3 px-3">Correo Electrónico</th>
                    <th className="py-3 px-3">Rol Asignado</th>
                    <th className="py-3 px-3">Cambiar Rol</th>
                    <th className="py-3 px-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-800 flex items-center gap-2">
                          <span>{u.email}</span>
                          {u.is_current_user && (
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                              Tú
                            </span>
                          )}
                        </div>
                        {resetUserId === u.id && (
                          <form
                            onSubmit={(e) => handleResetPassword(e, u.id)}
                            className="mt-2 flex items-center gap-2"
                          >
                            <input
                              type="text"
                              placeholder="Nueva contraseña"
                              value={resetPasswordValue}
                              onChange={(e) => setResetPasswordValue(e.target.value)}
                              className="border border-slate-300 rounded px-2 py-1 text-xs"
                              required
                            />
                            <button
                              type="submit"
                              className="px-2.5 py-1 rounded bg-blue-600 text-white text-xs font-bold cursor-pointer"
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setResetUserId(null);
                                setResetPasswordValue('');
                              }}
                              className="px-2 py-1 rounded bg-slate-200 text-slate-700 text-xs"
                            >
                              Cancelar
                            </button>
                          </form>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <span className={`inline-block px-2.5 py-0.5 text-xs font-bold uppercase rounded border ${
                          u.role === 'admin'
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            : u.role === 'auditor'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}>
                          {u.role}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <select
                          value={u.role}
                          disabled={u.is_current_user}
                          onChange={(e) => handleChangeRole(u.id, e.target.value)}
                          className="border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
                        >
                          <option value="user">user (Operador)</option>
                          <option value="auditor">auditor (Auditor)</option>
                          <option value="admin">admin (Administrador)</option>
                        </select>
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              setResetUserId(resetUserId === u.id ? null : u.id);
                              setResetPasswordValue('');
                            }}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition cursor-pointer"
                            title="Cambiar contraseña"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>

                          {!u.is_current_user && (
                            <button
                              onClick={() => handleDeleteUser(u)}
                              className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition cursor-pointer"
                              title="Eliminar usuario"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-xs text-slate-400">
                        No se encontraron usuarios con ese criterio.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
