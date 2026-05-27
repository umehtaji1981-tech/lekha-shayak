import React, { useState } from 'react';
import { Plus, Trash2, Box } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/db';

export const UnitMaster = ({ companyId }: { companyId: string }) => {
  const [units, setUnits] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    return dbService.listenCollection(`companies/${companyId}/units`, [], (data) => {
      setUnits(data);
      setLoading(false);
    });
  }, [companyId]);

  const handleAdd = async (e: any) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const unit = {
      name: data.get('name'),
      symbol: data.get('symbol'),
      companyId
    };
    await dbService.add(`companies/${companyId}/units`, unit);
    setShowAdd(false);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this unit?')) {
      // In a real app, check if unit is used in any items
      // await dbService.delete(`companies/${companyId}/units`, id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end items-center">
        <button onClick={() => setShowAdd(true)} className="btn-primary">
          <Plus size={18} /> Add Unit
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {units.map((unit) => (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            key={unit.id} 
            className="card p-6 flex items-center justify-between"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                <Box size={24} />
              </div>
              <div>
                <div className="font-bold text-lg">{unit.name}</div>
                <div className="text-xs text-slate-500 font-mono">Symbol: {unit.symbol}</div>
              </div>
            </div>
            <button onClick={() => handleDelete(unit.id)} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
              <Trash2 size={18} />
            </button>
          </motion.div>
        ))}
        {units.length === 0 && !loading && (
          <div className="col-span-full py-20 text-center text-slate-400">
            No units defined. Standard units like PCS, KG, MTR are common.
          </div>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-[100] overflow-y-auto p-4 flex justify-center items-start">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="card w-full max-w-md p-8 my-auto">
            <h3 className="text-xl font-bold mb-6">Create New Unit</h3>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="label">Unit Name*</label>
                <input name="name" className="input-field" placeholder="e.g. Pieces" required />
              </div>
              <div>
                <label className="label">Unit Symbol*</label>
                <input name="symbol" className="input-field" placeholder="e.g. PCS" required />
              </div>
              <div className="flex justify-end gap-4 mt-6">
                <button type="button" onClick={() => setShowAdd(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary px-8">Save Unit</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
