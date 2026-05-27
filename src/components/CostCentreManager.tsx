import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Pencil, Search, Target, AlertCircle, Briefcase, FileText, CheckCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/db';

interface CostCentre {
  id: string;
  name: string;
  code: string;
  department?: string;
  description?: string;
  status: 'Active' | 'Inactive';
  companyId: string;
}

export const CostCentreManager = ({ companyId }: { companyId: string }) => {
  const [costCentres, setCostCentres] = useState<CostCentre[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modals & Forms
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingCostCentre, setEditingCostCentre] = useState<CostCentre | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState<CostCentre | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    department: '',
    description: '',
    status: 'Active' as 'Active' | 'Inactive'
  });

  // Listen to Cost Centres
  useEffect(() => {
    setLoading(true);
    const unsubCC = dbService.listenCollection(
      `companies/${companyId}/costCentres`, 
      [], 
      (data) => {
        setCostCentres(data as CostCentre[]);
        setLoading(false);
      }
    );
    return () => {
      unsubCC();
    };
  }, [companyId]);

  // Listen to Transactions (to check references on delete)
  useEffect(() => {
    const unsubTx = dbService.listenCollection(
      `companies/${companyId}/transactions`,
      [],
      (data) => {
        setTransactions(data);
      }
    );
    return () => {
      unsubTx();
    };
  }, [companyId]);

  const handleOpenAdd = () => {
    setEditingCostCentre(null);
    setFormData({
      name: '',
      code: `CC-${Math.floor(1000 + Math.random() * 9000)}`,
      department: '',
      description: '',
      status: 'Active'
    });
    setShowFormModal(true);
  };

  const handleOpenEdit = (cc: CostCentre) => {
    setEditingCostCentre(cc);
    setFormData({
      name: cc.name,
      code: cc.code || '',
      department: cc.department || '',
      description: cc.description || '',
      status: cc.status || 'Active'
    });
    setShowFormModal(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    const dataPayload = {
      name: formData.name.trim(),
      code: formData.code.trim().toUpperCase(),
      department: formData.department.trim(),
      description: formData.description.trim(),
      status: formData.status,
      companyId
    };

    try {
      if (editingCostCentre) {
        await dbService.update(
          `companies/${companyId}/costCentres`,
          editingCostCentre.id,
          dataPayload
        );
      } else {
        await dbService.add(
          `companies/${companyId}/costCentres`,
          dataPayload
        );
      }
      setShowFormModal(false);
      setEditingCostCentre(null);
    } catch (err) {
      console.error('Error saving Cost Centre:', err);
    }
  };

  const handleDeleteClick = (cc: CostCentre) => {
    setShowDeleteModal(cc);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!showDeleteModal) return;

    try {
      // Check if reference exists in transactions
      const isReferencedInTransactions = transactions.some((t: any) => 
        t.costCentreAllocations?.some((alloc: any) => alloc.costCentreId === showDeleteModal.id)
      );

      if (isReferencedInTransactions) {
        setDeleteError(`Cannot delete Cost Centre "${showDeleteModal.name}" as it is currently allocated in one or more Transactions.`);
        return;
      }

      await dbService.delete(`companies/${companyId}/costCentres`, showDeleteModal.id);
      setShowDeleteModal(null);
      setDeleteError(null);
    } catch (err) {
      console.error('Error deleting Cost Centre:', err);
      setDeleteError('Failed to delete Cost Centre. Please try again.');
    }
  };

  const filteredCostCentres = costCentres.filter(cc => {
    const term = searchTerm.toLowerCase();
    return (
      cc.name.toLowerCase().includes(term) ||
      (cc.code && cc.code.toLowerCase().includes(term)) ||
      (cc.department && cc.department.toLowerCase().includes(term))
    );
  });

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Search Cost Centres by name, code or department..."
            className="input-field pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button onClick={handleOpenAdd} className="btn-primary flex items-center justify-center gap-2">
          <Plus size={18} /> Add Cost Centre
        </button>
      </div>

      {/* Main Grid / Cards */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
          <p className="text-xs text-slate-500 font-medium">Loading Cost Centres...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCostCentres.map((cc) => (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              key={cc.id}
              className="card p-6 flex flex-col justify-between hover:shadow-lg transition-all border border-slate-100"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                      <Target size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-lg leading-tight">{cc.name}</h4>
                      <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                        {cc.code || 'NO CODE'}
                      </span>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase transition-all ${
                    cc.status === 'Active' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-200'
                  }`}>
                    {cc.status || 'Active'}
                  </span>
                </div>

                {/* Additional Info */}
                <div className="space-y-2 pt-1 border-t border-slate-50">
                  {cc.department && (
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <Briefcase size={14} className="text-slate-400" />
                      <span className="font-medium text-slate-500">Dept:</span>
                      <span className="font-bold text-slate-800">{cc.department}</span>
                    </div>
                  )}
                  {cc.description && (
                    <div className="flex items-start gap-2 text-xs text-slate-600">
                      <FileText size={14} className="text-slate-400 mt-0.5 shrink-0" />
                      <p className="text-slate-500 leading-relaxed italic">{cc.description}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-slate-50">
                <button
                  onClick={() => handleOpenEdit(cc)}
                  className="text-indigo-650 hover:text-indigo-800 p-2 hover:bg-indigo-50 rounded-lg transition-all"
                  title="Edit Cost Centre"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => handleDeleteClick(cc)}
                  className="text-slate-350 hover:text-red-500 p-2 hover:bg-red-50 rounded-lg transition-all"
                  title="Delete Cost Centre"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </motion.div>
          ))}

          {filteredCostCentres.length === 0 && (
            <div className="col-span-full py-20 text-center card bg-slate-50 border-dashed border-2 border-slate-200 flex flex-col items-center justify-center space-y-3">
              <Target size={40} className="text-slate-300" />
              <div className="space-y-1">
                <h4 className="font-bold text-slate-700">No Cost Centres Found</h4>
                <p className="text-xs text-slate-500 max-w-sm">
                  {searchTerm ? 'No Cost Centres match your search criteria.' : 'Cost centres let you segment expenditures or revenues across various departments or projects.'}
                </p>
              </div>
              {!searchTerm && (
                <button onClick={handleOpenAdd} className="btn-secondary text-xs py-1.5 px-4 mt-2">
                  Create First Cost Centre
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Form Dialog/Modal */}
      <AnimatePresence>
        {showFormModal && (
          <div className="fixed inset-0 bg-black/60 z-[100] p-4 flex items-center justify-center overflow-y-auto">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl border border-slate-100 shadow-2xl p-8 max-w-md w-full text-left space-y-6"
            >
              <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                <h3 className="text-xl font-bold font-display text-slate-900">
                  {editingCostCentre ? 'Edit Cost Centre' : 'New Cost Centre'}
                </h3>
                <button 
                  onClick={() => setShowFormModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <label className="label">Cost Centre Name*</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. Marketing Department, Project Alpha"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Cost Centre Code*</label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. MKTG"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Status</label>
                    <select
                      className="input-field"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as 'Active' | 'Inactive' })}
                    >
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="label">Department / Project (Optional)</label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder="e.g. Sales, R&D, Internal"
                    value={formData.department}
                    onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Description (Optional)</label>
                  <textarea
                    className="input-field min-h-20 max-h-40"
                    placeholder="Provide notes or target of this cost centre..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowFormModal(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary px-8"
                  >
                    {editingCostCentre ? 'Update Cost Centre' : 'Save Cost Centre'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="fixed inset-0 bg-black/60 z-[110] p-4 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl border border-slate-100 shadow-2xl p-6 max-w-sm w-full space-y-4 text-left"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-red-100 text-red-650 rounded-xl shrink-0">
                  <Trash2 size={24} />
                </div>
                <div className="space-y-1">
                  <h4 className="text-base font-bold text-slate-900 font-sans">Delete Cost Centre</h4>
                  <p className="text-xs text-slate-550 leading-relaxed font-sans">
                    Are you sure you want to delete <span className="font-bold text-slate-800">"{showDeleteModal.name}"</span>? This action is permanent and cannot be undone.
                  </p>
                </div>
              </div>

              {deleteError && (
                <div className="bg-red-50 border border-red-100 p-3 rounded-xl text-xs font-semibold text-red-600 leading-normal font-sans">
                  <div className="flex gap-2 items-start">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{deleteError}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2 font-sans text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(null);
                    setDeleteError(null);
                  }}
                  className="px-4 py-2 hover:bg-slate-100 border border-slate-200 font-bold text-slate-600 rounded-xl transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 bg-red-650 hover:bg-red-700 font-bold text-white rounded-xl transition-all cursor-pointer"
                >
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
