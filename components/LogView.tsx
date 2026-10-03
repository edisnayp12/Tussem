
import React from 'react';
import { AuditLog } from '../types';

interface LogViewProps {
  logs: AuditLog[];
}

const LogView: React.FC<LogViewProps> = ({ logs }) => {
  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-purple-950 uppercase tracking-tighter">Logs do Sistema</h2>
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">Monitoramento de Alterações (Últimos 7 dias)</p>
        </div>
      </div>

      <div className="bg-white rounded-[32px] shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">Data/Hora</th>
              <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">Usuário</th>
              <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">Ação</th>
              <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase">Detalhes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.map(log => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-[9px] font-bold text-gray-500">
                  {new Date(log.data).toLocaleString()}
                </td>
                <td className="px-6 py-4">
                  <div className="text-[10px] font-black text-purple-900 uppercase">{log.usuario_nome || 'Desconhecido'}</div>
                  <div className="text-[8px] text-gray-400 font-bold">ID: {(log.usuario_id || '').slice(0, 8)}...</div>
                </td>
                <td className="px-6 py-4">
                   <div className="text-[10px] font-black text-gray-700 uppercase">{log.acao}</div>
                </td>
                <td className="px-6 py-4 text-[9px] font-medium text-gray-600 italic">
                  {log.detalhes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && (
          <div className="p-10 text-center text-gray-400 text-xs font-bold uppercase">Nenhum log registrado recentemente.</div>
        )}
      </div>
    </div>
  );
};

export default LogView;
