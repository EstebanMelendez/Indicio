import { useState } from 'react';
import { authAPI } from '../services/api';
import brandLogo from '../assets/brand_logo.png';

export default function Login({ onLoginSuccess }) {
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await authAPI.login({
        email: loginUser,
        password: loginPass
      });
      if (res.data.role) {
        sessionStorage.setItem('role', res.data.role);
      }
      onLoginSuccess(res.data.access_token);
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
          <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition-colors shadow-md mt-2">Entrar</button>
        </form>
      </div>
    </div>
  );
}
