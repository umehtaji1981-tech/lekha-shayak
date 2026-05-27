import React, { useState, useEffect } from 'react';
import { Save, Hash, Type, Octagon as NumberIcon, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/db';

export const SequenceSettings = ({ companyId, activeFY }: any) => {
  const [sequences, setSequences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const voucherTypes = ['Sales', 'Purchases', 'Payment', 'Receipt', 'Contra', 'Credit Note', 'Debit Note', 'Journal'];

  useEffect(() => {
    if (companyId) {
      dbService.listenCollection(`companies/${companyId}/sequences`, [], (data) => {
        setSequences(data);
        setLoading(false);
      });
    }
  }, [companyId]);

  const handleUpdate = async (type: string, field: string, value: any) => {
    const seqId = `${type}_${activeFY.id}`;
    const existing = sequences.find(s => s.id === seqId);
    
    const data = {
      [field]: value,
      type,
      fy: activeFY.id,
      companyId,
      lastNumber: existing?.lastNumber || 0,
      padding: existing?.padding || 1,
      prefix: existing?.prefix || '',
      suffix: existing?.suffix || ''
    };

    if (existing) {
      await dbService.update(`companies/${companyId}/sequences`, seqId, data);
    } else {
      await dbService.set(`companies/${companyId}/sequences`, seqId, data);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex gap-4 items-start">
        <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
          <Hash size={20} />
        </div>
        <div>
          <h4 className="font-bold text-amber-900 text-sm">Voucher Numbering Settings</h4>
          <p className="text-xs text-amber-700 mt-1">
            Configure how your invoices and bills are numbered for the financial year {activeFY.label}. 
            Changes will apply to the next generated voucher.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {voucherTypes.map((type) => {
          const seq = sequences.find(s => s.type === type && s.fy === activeFY.id);
          const nextVal = (seq?.lastNumber || 0) + 1;
          const preview = `${seq?.prefix || ''}${nextVal.toString().padStart(seq?.padding || 1, '0')}${seq?.suffix || ''}`;

          return (
            <div key={type} className="card p-6 border border-slate-100">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="min-w-[150px]">
                  <h3 className="font-bold text-slate-900">{type}</h3>
                  <div className="mt-2 inline-flex items-center gap-2 px-2 py-1 bg-indigo-50 text-indigo-600 rounded text-[10px] font-bold uppercase tracking-tight">
                    Next: {preview}
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Prefix</label>
                    <input 
                      className="input-field py-1.5 min-h-0 text-sm" 
                      placeholder="e.g. INV/" 
                      value={seq?.prefix || ''}
                      onChange={e => handleUpdate(type, 'prefix', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Start From / Last</label>
                    <input 
                      type="number"
                      className="input-field py-1.5 min-h-0 text-sm" 
                      value={seq?.lastNumber || 0}
                      onChange={e => handleUpdate(type, 'lastNumber', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Padding</label>
                    <select 
                      className="input-field py-1.5 min-h-0 text-sm"
                      value={seq?.padding || 1}
                      onChange={e => handleUpdate(type, 'padding', Number(e.target.value))}
                    >
                      <option value={1}>None (1, 2, 3)</option>
                      <option value={2}>2 Digits (01)</option>
                      <option value={3}>3 Digits (001)</option>
                      <option value={4}>4 Digits (0001)</option>
                      <option value={5}>5 Digits (00001)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Suffix</label>
                    <input 
                      className="input-field py-1.5 min-h-0 text-sm" 
                      placeholder="e.g. /24-25" 
                      value={seq?.suffix || ''}
                      onChange={e => handleUpdate(type, 'suffix', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
