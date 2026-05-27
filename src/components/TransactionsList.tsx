import React, { useState, useEffect } from 'react';
import { Search, Filter, Download, MoreVertical, Eye, Printer, Trash2, Pencil } from 'lucide-react';
import { dbService } from '../lib/db';
import { where, orderBy } from 'firebase/firestore';

export const TransactionsList = ({ companyId, type, activeFY, onEdit, onPrint, onPreview }: { companyId: string, type: string, activeFY: any, onEdit?: (transaction: any) => void, onPrint?: (transaction: any) => void, onPreview?: (transaction: any) => void }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const constraints = [
      where('type', '==', type),
      where('date', '>=', activeFY.startDate),
      where('date', '<=', activeFY.endDate),
      orderBy('date', 'desc')
    ];

    return dbService.listenCollection(
      `companies/${companyId}/transactions`, 
      constraints, 
      (res) => {
        setData(res);
        setLoading(false);
      }
    );
  }, [companyId, type, activeFY]);

  if (loading) return <div className="py-20 text-center text-slate-400">Loading {type} data...</div>;

  return (
    <div className="card">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
            <tr>
              <th className="px-6 py-4">Date</th>
              <th className="px-6 py-4">Ref #</th>
              <th className="px-6 py-4">Party</th>
              <th className="px-6 py-4 text-right">Amount</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50 transition-colors cursor-pointer group">
                <td className="px-6 py-4">{new Date(row.date).toLocaleDateString()}</td>
                <td className="px-6 py-4 font-mono font-medium">{row.voucherNumber || 'N/A'}</td>
                <td className="px-6 py-4">
                  <div className="font-semibold text-slate-700">{row.partyName}</div>
                  {row.bankName && <div className="text-[10px] text-slate-400 font-medium">Account: {row.bankName}</div>}
                </td>
                <td className="px-6 py-4 text-right font-bold">₹{row.totalAmount.toLocaleString()}</td>
                <td className="px-6 py-4">
                  {row.isPaid ? (
                    <span className="bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2 py-0.5 rounded">PAID</span>
                  ) : (
                    <span className="bg-orange-50 text-orange-600 text-[10px] font-bold px-2 py-0.5 rounded uppercase">Credit</span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                   <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => { e.stopPropagation(); onEdit?.(row); }}
                        className="p-1.5 hover:bg-indigo-50 rounded-lg text-indigo-400"
                        title="Edit"
                      >
                        <Pencil size={16} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onPreview?.(row); }}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                        title="Preview"
                      >
                        <Eye size={16} />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); onPrint?.(row); }}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400"
                        title="Print"
                      >
                        <Printer size={16} />
                      </button>
                      {confirmDeleteId === row.id ? (
                        <div className="flex items-center gap-1.5 bg-red-50 p-1 rounded-lg border border-red-100" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await dbService.deleteTransactionWithStock(companyId, row.id);
                                setConfirmDeleteId(null);
                              } catch (err) {
                                console.error("Error deleting transaction:", err);
                                alert("Failed to delete transaction: " + (err instanceof Error ? err.message : String(err)));
                              }
                            }}
                            className="bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold px-2 py-1 rounded"
                          >
                            Delete
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-[10px] font-bold px-2 py-1 rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation();
                            setConfirmDeleteId(row.id);
                          }}
                          className="p-1.5 hover:bg-red-50 rounded-lg text-red-400 animate-fade-in"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                   </div>
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-20 text-center">
                   <p className="text-slate-400 mb-2">No {type} records found.</p>
                   <p className="text-xs text-slate-300">Create one to see it appearing here.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
