import { useState } from 'react';
import { ShieldCheck, Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { authAPI } from '../services/api';
import brandLogo from '../assets/brand_logo.png';

export default function Login({ onLoginSuccess }) {
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [acceptedLey1581, setAcceptedLey1581] = useState(true);
  const [showPrivacyDetail, setShowPrivacyDetail] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    if (!acceptedLey1581) {
      setLoginError('Debe autorizar el tratamiento de datos personales (Ley 1581 de 2012) para continuar.');
      return;
    }
    try {
      const res = await authAPI.login({
        email: loginUser.trim().toLowerCase(),
        password: loginPass.trim()
      });
      if (res.data.role) {
        sessionStorage.setItem('role', res.data.role);
      }
      if (res.data.email) {
        sessionStorage.setItem('user_email', res.data.email);
      }
      if (res.data.tenant_id) {
        sessionStorage.setItem('tenant_id', String(res.data.tenant_id));
      }
      if (res.data.tenant_name) {
        sessionStorage.setItem('tenant_name', res.data.tenant_name);
      }
      onLoginSuccess(res.data.access_token, res.data);
    } catch (err) {
      setLoginError('Usuario o contraseña incorrectos');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-blue-800 to-slate-900 flex flex-col justify-center items-center p-4 font-sans">
      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-slate-100">
        <div className="flex flex-col items-center justify-center mb-6">
          <img src={brandLogo} alt="Logo" className="w-20 h-20 object-contain mb-3 drop-shadow-md" />
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">Indicio</h1>
          <p className="text-xs text-slate-400 font-semibold tracking-wide uppercase mt-0.5">Enterprise Edition</p>
        </div>
        <h2 className="text-xl font-bold text-center text-slate-700 mb-6">Iniciar Sesión</h2>
        {loginError && <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm font-medium border border-red-100 text-center">{loginError}</div>}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">Usuario</label>
            <input type="text" value={loginUser} onChange={e => setLoginUser(e.target.value)} className="w-full border border-slate-200 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" required />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-600 mb-1">Contraseña</label>
            <input type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} className="w-full border border-slate-200 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" required />
          </div>

          {/* Aviso de Privacidad y Protección de Datos - Ley 1581 de 2012 */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptedLey1581}
                onChange={e => setAcceptedLey1581(e.target.checked)}
                className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
              />
              <span className="leading-snug">
                Autorizo el tratamiento de datos personales conforme a la <strong>Ley 1581 de 2012</strong> y Decreto 1377 de 2013 (Habeas Data).
              </span>
            </label>
            <button
              type="button"
              onClick={() => setShowPrivacyDetail(!showPrivacyDetail)}
              className="flex items-center gap-1 text-[11px] font-semibold text-blue-700 hover:underline cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              {showPrivacyDetail ? 'Ocultar controles de seguridad' : '¿Qué datos procesamos y cómo los protegemos?'}
              {showPrivacyDetail ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {showPrivacyDetail && (
              <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-600 space-y-1.5 leading-relaxed">
                <p><strong>• Datos tratados:</strong> Información tributaria en facturas (NIT, emisor, montos), perfiles en Hojas de Vida (nombre, contacto, experiencia) y correo corporativo de auditoría.</p>
                <p><strong>• Protección en reposo:</strong> Cifrado simétrico autenticado <code>AES-128-CBC + HMAC-SHA256</code> y llaves <code>RSA-2048</code> en PostgreSQL (<code>ENC::</code>), con aislamiento físico por organización (<code>storage/tenant_id/</code>).</p>
                <p><strong>• Usuarios y tránsito:</strong> Contraseñas con hash <code>bcrypt</code>, tokens <code>JWT</code> con revocación, control de roles (<code>admin</code>, <code>auditor</code>, <code>user</code>), firmas <code>HMAC</code> en correos y transporte <code>TLS/HTTPS</code>.</p>
              </div>
            )}
          </div>

          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition-colors shadow-md mt-1 flex items-center justify-center gap-2 cursor-pointer">
            <Lock className="w-4 h-4" /> Entrar de Forma Segura
          </button>
        </form>
      </div>
    </div>
  );
}
