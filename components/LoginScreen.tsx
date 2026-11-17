import React, { useState, useMemo, useEffect } from 'react';
import { User, UserRole } from '../types';
import { DEFAULT_QUICK_OPERATORS, QuickPinOperator } from '../constants';

interface LoginScreenProps {
  cantinaName: string;
  users: User[];
  inactivityNotice?: boolean;
  onLoginSuccess: (user: User, methodLabel: string) => void;
  onSuperAdminLogin: (email: string, password: string) => Promise<void>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  cantinaName,
  users,
  inactivityNotice = false,
  onLoginSuccess,
  onSuperAdminLogin
}) => {
  const [loginMode, setLoginMode] = useState<'credentials' | 'pin'>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quick PIN mode state
  const quickOperators = useMemo<QuickPinOperator[]>(() => {
    const map = new Map<string, QuickPinOperator>();
    DEFAULT_QUICK_OPERATORS.forEach((op) => map.set(op.usuario.toLowerCase(), op));

    users
      .filter((u) => u.ativo !== false)
      .forEach((u) => {
        const key = (u.usuario || '').trim().toLowerCase();
        if (!key) return;
        const pinCandidate = u.pin || (/^\d{4}$/.test((u.senha || '').trim()) ? (u.senha || '').trim() : '');
        if (pinCandidate && !map.has(key)) {
          map.set(key, {
            id: u.id,
            label: u.nome || u.usuario,
            roleLabel:
              u.perfil === UserRole.ADMIN
                ? 'Gestão & Estoque'
                : u.perfil === UserRole.KDS
                ? 'Cozinha / KDS'
                : 'Operador de Caixa',
            usuario: u.usuario,
            pin: pinCandidate,
            perfil: u.perfil,
            userObj: u
          });
        } else if (map.has(key) && u.pin) {
          const existing = map.get(key)!;
          map.set(key, { ...existing, pin: u.pin, userObj: { ...existing.userObj, ...u } });
        }
      });

    return Array.from(map.values());
  }, [users]);

  const [selectedOperatorId, setSelectedOperatorId] = useState<string>(DEFAULT_QUICK_OPERATORS[0].id);
  const [pinDigits, setPinDigits] = useState<string>('');

  const selectedOperator = useMemo(
    () => quickOperators.find((op) => op.id === selectedOperatorId) || quickOperators[0],
    [quickOperators, selectedOperatorId]
  );

  // Auto-submit when 4 digits are entered in Quick PIN mode
  useEffect(() => {
    if (loginMode === 'pin' && pinDigits.length === 4 && selectedOperator) {
      if (pinDigits === selectedOperator.pin) {
        setError(null);
        onLoginSuccess(selectedOperator.userObj, 'Acesso Rápido (PIN)');
      } else {
        setError(`PIN inválido para ${selectedOperator.label}. Tente novamente.`);
        const timer = setTimeout(() => setPinDigits(''), 320);
        return () => clearTimeout(timer);
      }
    }
  }, [pinDigits, loginMode, selectedOperator, onLoginSuccess]);

  const handleTraditionalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const typedUser = username.trim();
    const typedLower = typedUser.toLowerCase();
    const typedPass = password.trim();

    if (!typedUser || !typedPass) {
      setError('Informe usuário e senha para entrar.');
      return;
    }

    // Super Admin Master Email Login
    if (typedLower === 'tusemmaxe@gmail.com' || typedLower === 'tusemmaxe') {
      setIsSubmitting(true);
      try {
        await onSuperAdminLogin('tusemmaxe@gmail.com', password);
      } catch (err: any) {
        setError(err?.message || 'Usuário ou senha inválidos');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // 1. Check built-in test credentials (caixa / 1234 and admin / 0000)
    if (typedLower === 'caixa' && typedPass === '1234') {
      onLoginSuccess(
        {
          id: 'op-caixa-01',
          nome: 'Caixa 01',
          usuario: 'caixa',
          pin: '1234',
          perfil: UserRole.COMMON,
          ativo: true
        },
        'Login Tradicional'
      );
      return;
    }

    if (typedLower === 'admin' && typedPass === '0000') {
      onLoginSuccess(
        {
          id: 'op-admin',
          nome: 'Administrador',
          usuario: 'admin',
          pin: '0000',
          perfil: UserRole.ADMIN,
          ativo: true
        },
        'Login Tradicional'
      );
      return;
    }

    // 2. Check existing Firestore / dynamic users
    const foundUser = users.find(
      (u) => u.usuario.trim().toLowerCase() === typedLower && u.ativo !== false
    );
    if (foundUser && foundUser.senha === password) {
      onLoginSuccess(foundUser, 'Login Tradicional');
      return;
    }

    // 3. Preserve legacy Tusemm master login
    if (typedUser === 'Tusemm' && password === 'Tusemm@7') {
      onLoginSuccess(
        {
          id: '0',
          nome: 'Master Admin',
          usuario: 'Tusemm',
          perfil: UserRole.ADMIN,
          ativo: true
        },
        'Login Master'
      );
      return;
    }

    setError('Usuário ou senha inválidos');
  };

  const handlePinKey = (digit: string) => {
    setError(null);
    if (pinDigits.length < 4) {
      setPinDigits((prev) => prev + digit);
    }
  };

  const handlePinBackspace = () => {
    setError(null);
    setPinDigits((prev) => prev.slice(0, -1));
  };

  const handlePinClear = () => {
    setError(null);
    setPinDigits('');
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-[#1a0a36] via-[#270e52] to-[#120626] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md bg-white rounded-[36px] p-6 sm:p-8 shadow-2xl border border-purple-100 animate-in zoom-in-95 duration-300">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-purple-900 text-white rounded-3xl flex items-center justify-center text-3xl font-black mx-auto mb-3 shadow-lg">
            {(cantinaName || 'T')[0].toUpperCase()}
          </div>
          <h1 className="text-2xl font-black text-purple-950 uppercase tracking-tight leading-tight">
            Cantina TUSEMM
          </h1>
          <p className="text-[11px] text-purple-600/80 font-bold uppercase tracking-widest mt-1">
            {cantinaName || 'Frente de Caixa & Gestão'}
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1.5 bg-purple-50 p-1.5 rounded-2xl mb-6 border border-purple-100">
          <button
            type="button"
            onClick={() => {
              setLoginMode('credentials');
              setError(null);
            }}
            className={`py-3 rounded-xl text-xs font-black uppercase tracking-wide transition-all flex items-center justify-center gap-2 ${
              loginMode === 'credentials'
                ? 'bg-purple-900 text-white shadow-md'
                : 'text-purple-700 hover:bg-purple-100/70'
            }`}
          >
            <i className="fa-solid fa-user-lock"></i>
            <span>Usuário</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setLoginMode('pin');
              setPinDigits('');
              setError(null);
            }}
            className={`py-3 rounded-xl text-xs font-black uppercase tracking-wide transition-all flex items-center justify-center gap-2 ${
              loginMode === 'pin'
                ? 'bg-purple-900 text-white shadow-md'
                : 'text-purple-700 hover:bg-purple-100/70'
            }`}
          >
            <i className="fa-solid fa-table-cells"></i>
            <span>Acesso Rápido (PIN)</span>
          </button>
        </div>

        {inactivityNotice && (
          <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-2xl text-xs font-bold text-center">
            Sessão encerrada após 10 minutos de inatividade. Entre novamente para continuar.
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 text-center animate-in fade-in"
          >
            <i className="fa-solid fa-circle-exclamation text-red-500"></i>
            <span>{error}</span>
          </div>
        )}

        {loginMode === 'credentials' ? (
          <form onSubmit={handleTraditionalSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-black uppercase text-purple-900/70 mb-1.5 ml-1">
                Usuário
              </label>
              <div className="relative">
                <i className="fa-solid fa-user absolute left-4 top-1/2 -translate-y-1/2 text-purple-400"></i>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="Digite seu usuário (ex: caixa ou admin)"
                  value={username}
                  onChange={(e) => {
                    setError(null);
                    setUsername(e.target.value);
                  }}
                  className="w-full bg-purple-50/60 border-2 border-purple-100 focus:border-purple-600 focus:bg-white rounded-2xl pl-11 pr-4 py-4 font-bold text-purple-950 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase text-purple-900/70 mb-1.5 ml-1">
                Senha
              </label>
              <div className="relative">
                <i className="fa-solid fa-lock absolute left-4 top-1/2 -translate-y-1/2 text-purple-400"></i>
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Digite sua senha"
                  value={password}
                  onChange={(e) => {
                    setError(null);
                    setPassword(e.target.value);
                  }}
                  className="w-full bg-purple-50/60 border-2 border-purple-100 focus:border-purple-600 focus:bg-white rounded-2xl pl-11 pr-12 py-4 font-bold text-purple-950 outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-xl text-purple-500 hover:bg-purple-100 transition-colors"
                >
                  <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-purple-900 hover:bg-purple-950 text-white py-4.5 rounded-2xl font-black uppercase tracking-wider text-sm shadow-lg active:scale-95 transition-all disabled:opacity-60 mt-2"
            >
              {isSubmitting ? 'Entrando...' : 'Entrar no Caixa'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            {/* Operator Selection List */}
            <div>
              <p className="text-[11px] font-black uppercase text-purple-900/70 mb-2 ml-1">
                1. Selecione o Operador
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {quickOperators.map((op) => {
                  const isSelected = selectedOperator?.id === op.id;
                  return (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => {
                        setSelectedOperatorId(op.id);
                        setPinDigits('');
                        setError(null);
                      }}
                      className={`p-3 rounded-2xl border-2 text-left transition-all active:scale-95 flex sm:flex-col items-center sm:items-start justify-between gap-2 ${
                        isSelected
                          ? 'bg-purple-900 border-purple-900 text-white shadow-md'
                          : 'bg-purple-50/70 border-purple-100 text-purple-950 hover:border-purple-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-purple-200/70 text-purple-900'
                          }`}
                        >
                          <i
                            className={`fa-solid ${
                              op.perfil === UserRole.ADMIN ? 'fa-shield-halved' : 'fa-cash-register'
                            }`}
                          ></i>
                        </div>
                        <div className="min-w-0">
                          <span className="block text-xs font-black uppercase leading-tight truncate">
                            {op.label}
                          </span>
                          <span
                            className={`block text-[10px] font-semibold truncate ${
                              isSelected ? 'text-purple-200' : 'text-purple-600/75'
                            }`}
                          >
                            {op.roleLabel}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4-Digit PIN Indicator */}
            <div className="py-2">
              <p className="text-[11px] font-black uppercase text-center text-purple-900/70 mb-2.5">
                2. Digite o PIN de 4 dígitos ({selectedOperator?.label})
              </p>
              <div className="flex justify-center gap-3">
                {[0, 1, 2, 3].map((idx) => {
                  const filled = idx < pinDigits.length;
                  return (
                    <div
                      key={idx}
                      className={`w-12 h-12 rounded-2xl border-2 flex items-center justify-center text-xl font-black transition-all ${
                        filled
                          ? 'bg-purple-900 border-purple-900 text-white shadow-md scale-105'
                          : 'bg-purple-50 border-purple-200 text-purple-300'
                      }`}
                    >
                      {filled ? '●' : ''}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Large Touch Numeric Keypad */}
            <div className="grid grid-cols-3 gap-2.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handlePinKey(num)}
                  className="h-14 rounded-2xl bg-purple-50 hover:bg-purple-100 active:bg-purple-900 active:text-white text-purple-950 font-black text-xl border border-purple-100 transition-all active:scale-95 shadow-xs"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={handlePinClear}
                className="h-14 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-black text-xs uppercase tracking-wider transition-all active:scale-95"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => handlePinKey('0')}
                className="h-14 rounded-2xl bg-purple-50 hover:bg-purple-100 active:bg-purple-900 active:text-white text-purple-950 font-black text-xl border border-purple-100 transition-all active:scale-95 shadow-xs"
              >
                0
              </button>
              <button
                type="button"
                onClick={handlePinBackspace}
                aria-label="Apagar dígito"
                className="h-14 rounded-2xl bg-purple-100/80 hover:bg-purple-200 text-purple-900 font-black text-lg transition-all active:scale-95 flex items-center justify-center"
              >
                <i className="fa-solid fa-delete-left"></i>
              </button>
            </div>
          </div>
        )}

        {/* Quiet Test Hint Footer */}
        <div className="mt-6 pt-4 border-t border-purple-100 text-center text-[11px] text-gray-500 font-medium">
          <span>Caixa: </span>
          <strong className="text-purple-900">caixa</strong> / <strong className="text-purple-900">1234</strong>
          <span className="mx-2 text-gray-300">·</span>
          <span>Admin: </span>
          <strong className="text-purple-900">admin</strong> / <strong className="text-purple-900">0000</strong>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
