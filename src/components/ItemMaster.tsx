import React, { useState } from 'react';
import { Plus, Search, Tag, IndianRupee, Layers, ShoppingBag, Pencil, HelpCircle, Trash2, X, FileSpreadsheet } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/db';
import { HSN_LIBRARY } from '../constants/hsnCodes';
import { BulkStockUploadModal } from './BulkStockUploadModal';

export const ItemMaster = ({ companyId }: { companyId: string }) => {
  const [items, setItems] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showHsnLookup, setShowHsnLookup] = useState(false);
  const [hsnSearch, setHsnSearch] = useState('');
  const [formData, setFormData] = useState<any>({
    name: '',
    hsn: '',
    sku: '',
    unit: 'PCS',
    gstRate: 18,
    purchasePrice: 0,
    salesPrice: 0,
    stockLevel: 0,
    openingStockRate: 0,
    openingStockValue: 0
  });

  const [units, setUnits] = useState<any[]>([]);
  const [showAddMiniUnit, setShowAddMiniUnit] = useState(false);
  const [miniUnitData, setMiniUnitData] = useState({ name: '', symbol: '' });
  
  const [itemToDelete, setItemToDelete] = useState<any>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<any[]>([]);

  React.useEffect(() => {
    return dbService.listenCollection(`companies/${companyId}/transactions`, [], (data) => {
      setTransactions(data);
    });
  }, [companyId]);

  React.useEffect(() => {
    return dbService.listenCollection(`companies/${companyId}/units`, [], (data) => {
      setUnits(data);
    });
  }, [companyId]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showAdd && !showAddMiniUnit && e.altKey && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
        setShowAddMiniUnit(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAdd, showAddMiniUnit]);

  const handleCreateMiniUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!miniUnitData.name || !miniUnitData.symbol) return;
    
    const uppercaseSymbol = miniUnitData.symbol.trim().toUpperCase();
    
    // Check if symbol already exists to prevent duplicates
    const exists = units.some(u => (u.symbol || '').toUpperCase() === uppercaseSymbol);
    if (!exists) {
      await dbService.add(`companies/${companyId}/units`, {
        name: miniUnitData.name.trim(),
        symbol: uppercaseSymbol,
        companyId
      });
    }

    setFormData((prev: any) => ({ ...prev, unit: uppercaseSymbol }));
    setMiniUnitData({ name: '', symbol: '' });
    setShowAddMiniUnit(false);
  };

  React.useEffect(() => {
    if (selectedItem) {
      setFormData({
        name: selectedItem.name || '',
        hsn: selectedItem.hsn || '',
        sku: selectedItem.sku || '',
        unit: selectedItem.unit || 'PCS',
        gstRate: selectedItem.gstRate || 18,
        purchasePrice: selectedItem.purchasePrice || 0,
        salesPrice: selectedItem.salesPrice || 0,
        stockLevel: (selectedItem.openingStockQty !== undefined && selectedItem.openingStockQty !== null) ? selectedItem.openingStockQty : 0,
        openingStockRate: selectedItem.openingStockRate || 0,
        openingStockValue: selectedItem.openingStockValue || 0
      });
    } else {
      setFormData({
        name: '',
        hsn: '',
        sku: '',
        unit: 'PCS',
        gstRate: 18,
        purchasePrice: 0,
        salesPrice: 0,
        stockLevel: 0,
        openingStockRate: 0,
        openingStockValue: 0
      });
    }
  }, [selectedItem, showAdd]);

  React.useEffect(() => {
    return dbService.listenCollection(`companies/${companyId}/items`, [], (data) => {
      setItems(data);
      setLoading(false);
    });
  }, [companyId]);

  const handleSubmit = async (e: any, andNext = false) => {
    e.preventDefault();
    
    let item: any;
    if (selectedItem) {
      const oldOpeningQty = (selectedItem.openingStockQty !== undefined && selectedItem.openingStockQty !== null) 
        ? Number(selectedItem.openingStockQty || 0) 
        : 0;
      const newOpeningQty = Number(formData.stockLevel || 0);
      const currentStockLevel = Number(selectedItem.stockLevel || 0);
      const updatedStockLevel = currentStockLevel - oldOpeningQty + newOpeningQty;
      
      item = {
        ...formData,
        openingStockQty: newOpeningQty,
        stockLevel: updatedStockLevel,
        companyId
      };
      await dbService.update(`companies/${companyId}/items`, selectedItem.id, item);
    } else {
      const newOpeningQty = Number(formData.stockLevel || 0);
      item = {
        ...formData,
        openingStockQty: newOpeningQty,
        companyId
      };
      await dbService.add(`companies/${companyId}/items`, item);
    }
    
    if (andNext) {
      setFormData({
        name: '',
        hsn: '',
        sku: '',
        unit: 'PCS',
        gstRate: 18,
        purchasePrice: 0,
        salesPrice: 0,
        stockLevel: 0,
        openingStockRate: 0,
        openingStockValue: 0
      });
      setSelectedItem(null);
    } else {
      setShowAdd(false);
      setSelectedItem(null);
    }
  };

  const handleEdit = (item: any) => {
    setSelectedItem(item);
    setShowAdd(true);
  };

  const handleDelete = (item: any) => {
    setItemToDelete(item);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      const queryInTransactions = transactions.some((t: any) => 
        t.items?.some((i: any) => i.itemId === itemToDelete.id)
      );

      if (queryInTransactions) {
        setDeleteError(`Cannot delete "${itemToDelete.name}" because it is currently used in transactions. Please delete or modify those transactions first.`);
        return;
      }

      await dbService.delete(`companies/${companyId}/items`, itemToDelete.id);
      setItemToDelete(null);
      setDeleteError(null);
    } catch (e) {
      console.error("Delete failed", e);
      setDeleteError("Failed to delete item. Please try again.");
    }
  };

  const filteredItems = items.filter((item: any) => 
    (item.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.sku || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.hsn || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            id="stock-search-input"
            type="text"
            placeholder="Search stock by name, SKU or HSN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-sm pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white transition-all shadow-sm shadow-slate-100"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors"
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {searchQuery && (
            <span className="text-xs text-indigo-600 bg-indigo-50/50 border border-indigo-100 px-3 py-1.5 rounded-lg font-medium self-center animate-pulse">
              Filtered: {filteredItems.length} of {items.length} items
            </span>
          )}
          <button 
            id="bulk-stock-upload-btn" 
            onClick={() => setShowBulkUpload(true)} 
            className="px-4 py-2 hover:bg-slate-100 border border-slate-200 font-bold text-slate-600 rounded-xl transition-all h-10 flex items-center justify-center gap-2 hover:text-slate-800 cursor-pointer text-sm shadow-sm bg-white"
          >
            <FileSpreadsheet size={16} className="text-indigo-600" /> Bulk Upload Levels
          </button>
          <button id="add-stock-item-btn" onClick={() => { setSelectedItem(null); setShowAdd(true); }} className="btn-primary flex items-center justify-center gap-2">
            <Plus size={18} /> Add Item
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6 border-l-4 border-indigo-600">
          <div className="text-sm text-slate-500 mb-1">Total SKU</div>
          <div className="text-2xl font-bold">{items.length} Items</div>
        </div>
        <div className="card p-6 border-l-4 border-emerald-600">
          <div className="text-sm text-slate-500 mb-1">Stock Value</div>
          <div className="text-2xl font-bold">₹{items.reduce((acc, curr) => acc + (curr.stockLevel * curr.purchasePrice), 0).toLocaleString()}</div>
        </div>
        <div className="card p-6 border-l-4 border-orange-600">
          <div className="text-sm text-slate-500 mb-1">Low Stock Alerts</div>
          <div className="text-2xl font-bold">{items.filter(i => i.stockLevel < 5).length} Items</div>
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm font-sans">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
              <tr>
                <th className="px-6 py-4">Item Name</th>
                <th className="px-6 py-4">HSN/SAC</th>
                <th className="px-6 py-4">GST Rate</th>
                <th className="px-6 py-4">Sales Price</th>
                <th className="px-6 py-4">Stock</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-semibold">{item.name}</div>
                    <div className="text-xs text-slate-400">SKU: {item.sku || 'N/A'}</div>
                  </td>
                  <td className="px-6 py-4 font-mono">{item.hsn}</td>
                  <td className="px-6 py-4"><span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold">{item.gstRate}%</span></td>
                  <td className="px-6 py-4 font-medium">₹{item.salesPrice}</td>
                  <td className="px-6 py-4">
                    <div className={`font-bold ${item.stockLevel < 5 ? 'text-red-600' : 'text-slate-900'}`}>
                      {item.stockLevel} {item.unit}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex gap-2 items-center">
                      <button onClick={() => handleEdit(item)} className="text-indigo-600 hover:text-indigo-800 p-1.5 hover:bg-indigo-50 rounded-lg transition-all" title="Edit Item">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => handleDelete(item)} className="text-slate-300 hover:text-red-500 p-1.5 hover:bg-red-50 rounded-lg transition-all" title="Delete Item">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic text-sm">
                    {searchQuery ? 'No stock records match your search criteria.' : 'No items found. Add your first item.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 z-[100] overflow-y-auto p-4 flex justify-center items-start">
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="card w-full max-w-2xl p-8 my-auto">
            <h3 className="text-xl font-bold mb-6">{selectedItem ? 'Edit Item' : 'Add New Item'}</h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-6">
              <div className="col-span-2">
                <label className="label">Item Name*</label>
                <input 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                  className="input-field" 
                  required 
                />
              </div>
              <div className="relative">
                <label className="label flex justify-between">
                  <span>HSN/SAC Code</span>
                  <button 
                    type="button" 
                    onClick={() => setShowHsnLookup(!showHsnLookup)}
                    className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-[10px] uppercase font-bold"
                  >
                    <Search size={10} /> Library
                  </button>
                </label>
                <input 
                  value={formData.hsn} 
                  onChange={e => setFormData({...formData, hsn: e.target.value})} 
                  className="input-field" 
                />
                
                <AnimatePresence>
                  {showHsnLookup && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute left-0 right-0 top-full mt-2 bg-white rounded-xl shadow-xl border border-slate-100 z-20 p-4 max-h-64 overflow-y-auto"
                    >
                      <div className="relative mb-3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input 
                          type="text" 
                          placeholder="Search HSN or Description..."
                          className="input-field pl-9 py-1.5 text-xs"
                          value={hsnSearch}
                          onChange={e => setHsnSearch(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        {HSN_LIBRARY.filter(h => (h.code || '').includes(hsnSearch || '') || (h.description || '').toLowerCase().includes((hsnSearch || '').toLowerCase())).map(h => (
                          <button
                            key={h.code}
                            type="button"
                            onClick={() => {
                              setFormData({...formData, hsn: h.code, gstRate: h.gstRate});
                              setShowHsnLookup(false);
                            }}
                            className="w-full text-left p-2 hover:bg-indigo-50 rounded-lg transition-colors group"
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-bold text-xs font-mono">{h.code}</span>
                              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1 rounded">{h.gstRate}%</span>
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">{h.description}</div>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div>
                <label className="label">SKU</label>
                <input 
                  value={formData.sku} 
                  onChange={e => setFormData({...formData, sku: e.target.value})} 
                  className="input-field" 
                />
              </div>
              <div>
                <label className="label flex justify-between items-center">
                  <span>Unit (e.g. PCS, KG)</span>
                  <button 
                    type="button" 
                    onClick={() => setShowAddMiniUnit(true)}
                    className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-[10px] uppercase font-bold"
                    title="Shortcut: Alt+U to save time"
                  >
                    <Plus size={11} className="stroke-[3]" /> Add Unit <span className="text-[9px] text-slate-400 font-normal ml-0.5">(Alt+U)</span>
                  </button>
                </label>
                <select 
                  value={formData.unit} 
                  onChange={e => setFormData({...formData, unit: e.target.value})} 
                  className="input-field"
                  required
                >
                  {units.length > 0 && (
                    <optgroup label="Created Units">
                      {units.map((u: any) => (
                        <option key={u.id} value={u.symbol}>{u.symbol} - {u.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Standard Units">
                    {['PCS', 'KG', 'MTR', 'BOX', 'NOS', 'BAG', 'BTL', 'CAN', 'CTN', 'DOZ', 'GMS', 'LTR', 'PAC', 'SET'].map(std => {
                      const exists = units.some((u: any) => (u.symbol || '').toUpperCase() === std);
                      if (exists) return null;
                      return <option key={std} value={std}>{std}</option>;
                    })}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="label">GST Rate (%)</label>
                <select 
                  value={formData.gstRate} 
                  onChange={e => setFormData({...formData, gstRate: Number(e.target.value)})} 
                  className="input-field"
                >
                  {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
              <div>
                <label className="label">Purchase Price (Exc. GST)</label>
                <input 
                  value={formData.purchasePrice} 
                  onChange={e => {
                    const pPrice = Number(e.target.value);
                    setFormData({...formData, purchasePrice: pPrice});
                  }} 
                  type="number" 
                  className="input-field" 
                />
              </div>
              <div>
                <label className="label">Sales Price (Exc. GST)</label>
                <input 
                  value={formData.salesPrice} 
                  onChange={e => setFormData({...formData, salesPrice: Number(e.target.value)})} 
                  type="number" 
                  className="input-field" 
                />
                <div className="flex flex-wrap gap-1 mt-2">
                  <span className="text-[8px] text-slate-400 font-black uppercase tracking-wider self-center mr-1">Markup:</span>
                  {[10, 15, 20, 25, 30, 40, 50].map((pct) => {
                    const price = Number((formData.purchasePrice * (1 + pct / 100)).toFixed(2));
                    const isSelected = Math.abs(formData.salesPrice - price) < 0.05;
                    return (
                      <button
                        type="button"
                        key={pct}
                        onClick={() => setFormData({ ...formData, salesPrice: price })}
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded hover:scale-105 transition-all ${
                          isSelected 
                            ? 'bg-indigo-600 text-white shadow-sm' 
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                        }`}
                      >
                        {pct}%
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 col-span-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div>
                  <label className="label">Opening Stock (Qty)</label>
                  <input 
                    value={formData.stockLevel} 
                    onChange={e => {
                      const qty = Number(e.target.value);
                      const rate = formData.openingStockRate || 0;
                      setFormData({...formData, stockLevel: qty, openingStockValue: qty * rate});
                    }} 
                    type="number" 
                    className="input-field bg-white" 
                  />
                </div>
                <div>
                  <label className="label">Opening Rate</label>
                  <input 
                    value={formData.openingStockRate} 
                    onChange={e => {
                      const rate = Number(e.target.value);
                      const qty = formData.stockLevel || 0;
                      setFormData({...formData, openingStockRate: rate, openingStockValue: qty * rate});
                    }} 
                    type="number" 
                    className="input-field bg-white" 
                  />
                </div>
                <div>
                  <label className="label">Opening Value</label>
                  <input 
                    value={formData.openingStockValue} 
                    onChange={e => setFormData({...formData, openingStockValue: Number(e.target.value)})} 
                    type="number" 
                    className="input-field bg-white" 
                  />
                </div>
              </div>
              
              <div className="col-span-2 flex justify-end gap-3 mt-4">
                <button type="button" onClick={() => { setShowAdd(false); setSelectedItem(null); }} className="btn-secondary">Cancel</button>
                {!selectedItem && (
                  <button type="button" onClick={(e) => {
                    const form = (e.target as any).closest('form');
                    if (form.checkValidity()) {
                      handleSubmit({ ...e, target: form, preventDefault: () => {} } as any, true);
                    } else {
                      form.reportValidity();
                    }
                  }} className="btn-secondary border-indigo-200 text-indigo-600">Save & Add Next</button>
                )}
                <button type="submit" className="btn-primary px-8">
                  {selectedItem ? 'Update Item' : 'Save Item'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showAddMiniUnit && (
        <div className="fixed inset-0 bg-black/60 z-[110] overflow-y-auto p-4 flex justify-center items-center">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="card w-full max-w-md p-6 shadow-2xl border border-indigo-100 bg-white">
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-indigo-50">
              <h4 className="text-base font-bold text-indigo-900">Add Quick Unit of Measure</h4>
              <span className="text-[10px] font-bold bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded uppercase tracking-wider">Alt+U Master</span>
            </div>
            
            <form onSubmit={handleCreateMiniUnit} className="space-y-4">
              <div className="space-y-1">
                <label className="label text-[11px] font-bold text-slate-600">Unit Name*</label>
                <input 
                  type="text"
                  placeholder="e.g. Kilograms, Boxes" 
                  value={miniUnitData.name} 
                  onChange={e => setMiniUnitData({...miniUnitData, name: e.target.value})} 
                  className="input-field py-2" 
                  required 
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="label text-[11px] font-bold text-slate-600">Unit Symbol* (Uppercase)</label>
                <input 
                  type="text"
                  placeholder="e.g. KG, BOX" 
                  value={miniUnitData.symbol} 
                  onChange={e => setMiniUnitData({...miniUnitData, symbol: e.target.value.toUpperCase()})} 
                  className="input-field py-2 uppercase font-mono" 
                  required 
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button 
                  type="button" 
                  onClick={() => {
                    setMiniUnitData({ name: '', symbol: '' });
                    setShowAddMiniUnit(false);
                  }} 
                  className="btn-secondary py-1.5 text-xs h-9 px-4"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn-primary py-1.5 text-xs h-9 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                >
                  Create & Select
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {itemToDelete && (
        <div className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="bg-white rounded-2xl border border-slate-100 shadow-2xl p-6 max-w-md w-full space-y-4 text-left"
          >
            <div className="flex items-start gap-4 text-left">
              <div className="p-3 bg-red-105 rounded-xl text-red-600 shrink-0">
                <Trash2 size={24} />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-slate-900 font-sans font-display">Delete Item Master</h4>
                <p className="text-xs text-slate-550 leading-relaxed font-sans mt-1">
                  Are you sure you want to delete <span className="font-bold text-slate-800">"{itemToDelete.name}"</span>? This action is permanent and cannot be undone.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="bg-red-50 border border-red-100 p-3 rounded-xl text-xs font-semibold text-red-600 leading-normal font-sans text-left">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2 font-sans text-xs">
              <button 
                type="button" 
                onClick={() => {
                  setItemToDelete(null);
                  setDeleteError(null);
                }} 
                className="px-4 py-2 hover:bg-slate-100 border border-slate-200 font-bold text-slate-600 rounded-xl transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button 
                type="button" 
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 font-bold text-white rounded-xl transition-all cursor-pointer"
              >
                Confirm Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {showBulkUpload && (
        <BulkStockUploadModal
          companyId={companyId}
          existingItems={items}
          onClose={() => setShowBulkUpload(false)}
        />
      )}
    </div>
  );
};
