
import React, { useState, useEffect } from 'react';
import { Building2, Save, Trash2, AlertTriangle, ShieldAlert, Upload, Layers, Sparkles, Plus, Eye } from 'lucide-react';
import { dbService } from '../lib/db';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface CompanySettingsProps {
  activeCompany: any;
  onCompanyUpdate: (updated: any) => void;
  onCompanyDelete: () => void;
  userProfile: any;
}

export const CompanySettings = ({ activeCompany, onCompanyUpdate, onCompanyDelete, userProfile }: CompanySettingsProps) => {
  const [formData, setFormData] = useState<any>({
    name: activeCompany.name || '',
    gstIn: activeCompany.gstIn || '',
    address: activeCompany.address || '',
    phone: activeCompany.phone || '',
    email: activeCompany.email || '',
    registrationType: activeCompany.registrationType || 'Regular',
    accountingMode: activeCompany.accountingMode || 'Commercial',
    state: activeCompany.state || 'Maharashtra',
    stateCode: activeCompany.stateCode || '27',
    logo: activeCompany.logo || '',
    bankName: activeCompany.bankName || '',
    accountNumber: activeCompany.accountNumber || '',
    ifscCode: activeCompany.ifscCode || '',
    branch: activeCompany.branch || '',
    bankAccounts: activeCompany.bankAccounts || (activeCompany.bankName ? [{
      id: 'default',
      bankName: activeCompany.bankName || '',
      accountNumber: activeCompany.accountNumber || '',
      ifscCode: activeCompany.ifscCode || '',
      branch: activeCompany.branch || '',
      isDefault: true
    }] : []),
    dashboardConfig: activeCompany.dashboardConfig || {
      stats: true,
      trend: true,
      topItems: true,
      stockAlerts: true,
      recent: true,
      logs: true,
      profitLoss: true,
      balanceSheet: true
    },
    customBranding: activeCompany.customBranding || {
      headerSubtitle: '',
      headerAlign: 'center',
      headerBorderSize: 'single',
      signatureLabel: 'Authorized Signatory',
      signatureHeight: 60,
      signatureAlign: 'right',
      termsOfSale: [
        'Goods once sold will not be taken back or exchanged.',
        'Our responsibility ceases as soon as goods leave our premises.',
        'Subject to local jurisdiction only.'
      ],
      watermarkText: 'ORIGINAL',
      watermarkEnabled: true,
      watermarkColor: '#6366f1',
      watermarkOpacity: 5,
      watermarkFontSize: 60,
      watermarkRotation: -30
    }
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // States for dynamic multiple bank accounts additions/modifications
  const [showBankForm, setShowBankForm] = useState(false);
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [bankInput, setBankInput] = useState({
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    branch: ''
  });

  const isOwner = activeCompany.ownerId === userProfile?.uid;

  useEffect(() => {
    setFormData({
      name: activeCompany.name || '',
      gstIn: activeCompany.gstIn || '',
      address: activeCompany.address || '',
      phone: activeCompany.phone || '',
      email: activeCompany.email || '',
      registrationType: activeCompany.registrationType || 'Regular',
      accountingMode: activeCompany.accountingMode || 'Commercial',
      manualClosingStock: activeCompany.manualClosingStock ?? false,
      manualClosingStockValue: activeCompany.manualClosingStockValue ?? 0,
      state: activeCompany.state || 'Maharashtra',
      stateCode: activeCompany.stateCode || '27',
      logo: activeCompany.logo || '',
      bankName: activeCompany.bankName || '',
      accountNumber: activeCompany.accountNumber || '',
      ifscCode: activeCompany.ifscCode || '',
      branch: activeCompany.branch || '',
      bankAccounts: activeCompany.bankAccounts || (activeCompany.bankName ? [{
        id: 'default',
        bankName: activeCompany.bankName || '',
        accountNumber: activeCompany.accountNumber || '',
        ifscCode: activeCompany.ifscCode || '',
        branch: activeCompany.branch || '',
        isDefault: true
      }] : []),
      dashboardConfig: activeCompany.dashboardConfig || {
        stats: true,
        trend: true,
        topItems: true,
        stockAlerts: true,
        recent: true,
        logs: true,
        profitLoss: true,
        balanceSheet: true
      },
      customBranding: activeCompany.customBranding || {
        headerSubtitle: '',
        headerAlign: 'center',
        headerBorderSize: 'single',
        signatureLabel: 'Authorized Signatory',
        signatureHeight: 60,
        signatureAlign: 'right',
        termsOfSale: [
          'Goods once sold will not be taken back or exchanged.',
          'Our responsibility ceases as soon as goods leave our premises.',
          'Subject to local jurisdiction only.'
        ],
        watermarkText: 'ORIGINAL',
        watermarkEnabled: true,
        watermarkColor: '#6366f1',
        watermarkOpacity: 5,
        watermarkFontSize: 60,
        watermarkRotation: -30
      }
    });
  }, [activeCompany]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert("File size should be less than 2MB");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, logo: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const removeLogo = () => {
    setFormData(prev => ({ ...prev, logo: '' }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) return;
    
    setIsSaving(true);
    try {
      const defaultBank = formData.bankAccounts?.find((b: any) => b.isDefault) || formData.bankAccounts?.[0];
      const updatedFormData = {
        ...formData,
        bankName: defaultBank?.bankName || '',
        accountNumber: defaultBank?.accountNumber || '',
        ifscCode: defaultBank?.ifscCode || '',
        branch: defaultBank?.branch || ''
      };

      await updateDoc(doc(db, 'companies', activeCompany.id), {
        ...updatedFormData,
        updatedAt: new Date().toISOString()
      });
      onCompanyUpdate({ ...activeCompany, ...updatedFormData });
      alert("Company details updated successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to update company details.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isOwner) return;
    setIsDeleting(true);
    try {
      // In a real app, we'd recursively delete all sub-collections (ledgers, txs, items)
      // or set a 'deleted' flag. For this app, we'll delete the main doc.
      await deleteDoc(doc(db, 'companies', activeCompany.id));
      alert("Company deleted successfully.");
      onCompanyDelete();
    } catch (err) {
      console.error(err);
      alert("Failed to delete company.");
    } finally {
      setIsDeleting(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="card p-12 text-center space-y-4">
        <ShieldAlert size={48} className="mx-auto text-red-500" />
        <h3 className="text-xl font-bold text-slate-900">Permission Denied</h3>
        <p className="text-slate-500">Only the company owner can modify or delete this company profile.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <Building2 size={20} />
          </div>
          <div>
            <h3 className="font-bold text-lg">Alter Company Details</h3>
            <p className="text-xs text-slate-500">Edit business profile and contact information</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2 space-y-2">
            <label className="label">Company Logo</label>
            <div className="flex items-center gap-6">
              <div className="w-24 h-24 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden group relative">
                {formData.logo ? (
                  <>
                    <img src={formData.logo} alt="Preview" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                    <button 
                      type="button"
                      onClick={removeLogo}
                      className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                    >
                      <Trash2 size={20} />
                    </button>
                  </>
                ) : (
                  <div className="text-slate-300">
                    <Building2 size={32} />
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-1">
                <input 
                  type="file" 
                  id="logo-upload" 
                  className="hidden" 
                  accept="image/*"
                  onChange={handleLogoUpload}
                />
                <label 
                  htmlFor="logo-upload" 
                  className="btn-secondary h-10 px-4 cursor-pointer inline-flex items-center gap-2 text-xs"
                >
                  <Upload size={14} /> {formData.logo ? 'Change Logo' : 'Upload Logo'}
                </label>
                <p className="text-[10px] text-slate-400">Recommended: Square image, max 2MB (PNG, JPG)</p>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <label className="label">Company Name</label>
            <input 
              className="input-field" 
              required
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
          </div>
          <div className="space-y-1">
            <label className="label">GSTIN</label>
            <input 
              className="input-field uppercase" 
              placeholder="27ABCDE1234F1Z5"
              maxLength={15}
              value={formData.gstIn}
              onChange={e => setFormData({...formData, gstIn: e.target.value.toUpperCase()})}
            />
          </div>
          <div className="space-y-1">
            <label className="label">Registration Type</label>
            <select 
              className="input-field"
              value={formData.registrationType}
              onChange={e => setFormData({...formData, registrationType: e.target.value})}
            >
              <option value="Regular">GST Regular</option>
              <option value="Composition">GST Composition</option>
              <option value="Unregistered">Unregistered</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="label">Company / Trust Accounting Mode</label>
            <select 
              className="input-field"
              value={formData.accountingMode || 'Commercial'}
              onChange={e => setFormData({...formData, accountingMode: e.target.value})}
            >
              <option value="Commercial">Commercial (Business Trading & Inventory)</option>
              <option value="AccountsOnly">Accounting without Inventory (Accounts Only)</option>
              <option value="NGO_Trust">NGO / Trust / Association (Zero Stocks, Income & Expenditure)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="label">Closing Stock Valuation Mode</label>
            <select 
              id="manual-closing-stock-select"
              className="input-field"
              value={formData.manualClosingStock ? 'Manual' : 'Dynamic'}
              onChange={e => setFormData({
                ...formData, 
                manualClosingStock: e.target.value === 'Manual',
                manualClosingStockValue: formData.manualClosingStockValue ?? 0
              })}
            >
              <option value="Dynamic">Dynamic (Derived from Transactions & Inventory)</option>
              <option value="Manual">Manual (Explicit User Defined Closing Value)</option>
            </select>
          </div>

          {formData.manualClosingStock && (
            <div className="space-y-1">
              <label className="label">Manual Closing Stock Value (₹)</label>
              <input 
                id="manual-closing-stock-val-input"
                type="number"
                min="0"
                className="input-field"
                placeholder="Enter manual closing stock value..."
                value={formData.manualClosingStockValue ?? 0}
                onChange={e => setFormData({...formData, manualClosingStockValue: Math.max(0, Number(e.target.value))})}
              />
            </div>
          )}
          <div className="space-y-1">
            <label className="label">Phone Number</label>
            <input 
              className="input-field" 
              value={formData.phone}
              onChange={e => setFormData({...formData, phone: e.target.value})}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="label">Office Address</label>
            <textarea 
              className="input-field min-h-[100px] py-2" 
              value={formData.address}
              onChange={e => setFormData({...formData, address: e.target.value})}
            />
          </div>

          <div className="md:col-span-2 mt-4 pt-4 border-t border-slate-100 space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h4 className="font-bold text-sm text-slate-700">Bank Accounts (Displayed on Invoices & Vouchers)</h4>
                <p className="text-xs text-slate-500">Configure multiple company bank accounts to select when billing</p>
              </div>
              {!showBankForm && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingBankId(null);
                    setBankInput({ bankName: '', accountNumber: '', ifscCode: '', branch: '' });
                    setShowBankForm(true);
                  }}
                  className="btn-secondary text-xs h-9 px-4 flex items-center gap-1 bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-100"
                >
                  + Add Bank
                </button>
              )}
            </div>

            {/* Bank Accounts List Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {formData.bankAccounts && formData.bankAccounts.length > 0 ? (
                formData.bankAccounts.map((acc: any) => (
                  <div key={acc.id} className={`p-4 border-2 rounded-xl space-y-2 relative transition-all ${acc.isDefault ? 'border-indigo-650 bg-indigo-50/20' : 'border-slate-100 hover:border-slate-200'}`}>
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-slate-800 text-xs flex items-center gap-2">
                          {acc.bankName}
                          {acc.isDefault && (
                            <span className="bg-indigo-600 text-white text-[9px] font-black tracking-wider uppercase px-1.5 py-0.5 rounded">DEFAULT</span>
                          )}
                        </p>
                        <p className="text-slate-500 font-mono text-[11px] mt-0.5">A/C: {acc.accountNumber}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingBankId(acc.id);
                            setBankInput({
                              bankName: acc.bankName,
                              accountNumber: acc.accountNumber,
                              ifscCode: acc.ifscCode,
                              branch: acc.branch || ''
                            });
                            setShowBankForm(true);
                          }}
                          className="p-1 px-2 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 rounded"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const filtered = formData.bankAccounts.filter((b: any) => b.id !== acc.id);
                            // If we deleted default, set another default if list is not empty
                            if (acc.isDefault && filtered.length > 0) {
                              filtered[0].isDefault = true;
                            }
                            setFormData({ ...formData, bankAccounts: filtered });
                          }}
                          className="p-1 px-2 text-[10px] font-bold text-red-650 hover:bg-red-50 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 text-[10px] text-slate-500 pt-1 border-t border-slate-50">
                      <div><span className="text-slate-400">IFSC:</span> <span className="font-bold text-slate-700">{acc.ifscCode}</span></div>
                      {acc.branch && <div><span className="text-slate-400">Branch:</span> <span className="font-bold text-slate-700">{acc.branch}</span></div>}
                    </div>

                    {!acc.isDefault && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = formData.bankAccounts.map((b: any) => ({
                            ...b,
                            isDefault: b.id === acc.id
                          }));
                          setFormData({ ...formData, bankAccounts: updated });
                        }}
                        className="text-[10px] text-indigo-600 font-bold hover:underline mt-2 block"
                      >
                        Set as Default
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="md:col-span-2 text-center py-6 text-slate-400 italic text-xs bg-slate-50 rounded-xl border border-dashed-2">
                  No bank accounts configured. Click "+ Add Bank" to create one.
                </div>
              )}
            </div>

            {/* Inline Add/Edit Bank Form */}
            {showBankForm && (
              <div className="bg-slate-50 p-4 rounded-xl border border-indigo-100 mt-4 space-y-4">
                <p className="font-bold text-xs text-indigo-900 border-b border-indigo-100/50 pb-1.5">
                  {editingBankId ? 'Modify Bank Account Details' : 'Register New Bank Account'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="label text-[10px]">Bank Name*</label>
                    <input
                      className="input-field bg-white"
                      placeholder="e.g. State Bank of India"
                      value={bankInput.bankName}
                      onChange={e => setBankInput({ ...bankInput, bankName: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="label text-[10px]">Account Number*</label>
                    <input
                      className="input-field bg-white font-mono"
                      placeholder="e.g. 50100123456789"
                      value={bankInput.accountNumber}
                      onChange={e => setBankInput({ ...bankInput, accountNumber: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="label text-[10px]">IFSC Code*</label>
                    <input
                      className="input-field bg-white uppercase font-serif"
                      placeholder="e.g. SBIN0001234"
                      value={bankInput.ifscCode}
                      onChange={e => setBankInput({ ...bankInput, ifscCode: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="label text-[10px]">Branch Name</label>
                    <input
                      className="input-field bg-white"
                      placeholder="e.g. Bandra East Branch"
                      value={bankInput.branch}
                      onChange={e => setBankInput({ ...bankInput, branch: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowBankForm(false)}
                    className="btn-secondary text-xs h-8 px-3"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!bankInput.bankName || !bankInput.accountNumber || !bankInput.ifscCode) {
                        alert("Bank Name, Account Number, and IFSC are all required!");
                        return;
                      }

                      let list = [...(formData.bankAccounts || [])];
                      if (editingBankId) {
                        list = list.map((b: any) => b.id === editingBankId ? { ...b, ...bankInput } : b);
                      } else {
                        const newBank = {
                          id: 'bank_' + Date.now(),
                          ...bankInput,
                          isDefault: list.length === 0 // Default if it's the first one
                        };
                        list.push(newBank);
                      }

                      setFormData({ ...formData, bankAccounts: list });
                      setShowBankForm(false);
                    }}
                    className="btn-primary text-xs h-8 px-4"
                  >
                    Save Account
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="md:col-span-2 mt-8 pt-8 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-4">
               <Layers size={18} className="text-indigo-600" />
               <h4 className="font-bold text-sm text-slate-700">Dashboard Preferences</h4>
            </div>
            <p className="text-xs text-slate-500 mb-6 font-medium">Select which snapshots and widgets you want to see on your main dashboard.</p>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
               {[
                 { key: 'stats', label: 'Key Performance Stats' },
                 { key: 'trend', label: 'Sales & Purchase Trends' },
                 { key: 'profitLoss', label: 'Profit & Loss Snapshot' },
                 { key: 'balanceSheet', label: 'Balance Sheet Snapshot' },
                 { key: 'stockAlerts', label: 'Inventory Stock Alerts' },
                 { key: 'topItems', label: 'Top Selling Items' },
                 { key: 'recent', label: 'Recent Transactions' },
                 { key: 'logs', label: 'Activity Logs' }
               ].map((widget) => (
                 <label 
                   key={widget.key} 
                   className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                     (formData.dashboardConfig?.[widget.key] !== false) 
                       ? 'border-indigo-100 bg-indigo-50/30' 
                       : 'border-slate-100 bg-white opacity-60'
                   }`}
                 >
                   <span className="text-xs font-bold text-slate-700">{widget.label}</span>
                   <div className="relative">
                     <input 
                       type="checkbox" 
                       className="sr-only"
                       checked={formData.dashboardConfig?.[widget.key] !== false}
                       onChange={(e) => {
                         const current = formData.dashboardConfig || {};
                         setFormData({
                           ...formData,
                           dashboardConfig: {
                             ...current,
                             [widget.key]: e.target.checked
                           }
                         });
                       }}
                     />
                     <div className={`w-10 h-5 rounded-full transition-colors ${formData.dashboardConfig?.[widget.key] !== false ? 'bg-indigo-600' : 'bg-slate-200'}`}>
                        <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${formData.dashboardConfig?.[widget.key] !== false ? 'translate-x-5' : ''}`} />
                     </div>
                   </div>
                 </label>
               ))}
            </div>
          </div>

          {/* Custom Branding & Dynamic PDF Watermarks */}
          <div id="dynamic-branding-section" className="md:col-span-2 mt-8 pt-8 border-t border-slate-100">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={18} className="text-indigo-600 animate-pulse" />
              <h4 className="font-bold text-sm text-slate-700">Dynamic Watermarks & Custom Branding</h4>
            </div>
            <p className="text-xs text-slate-500 mb-6 font-medium">
              Configure business headers, signature margins, terms of sale, and dynamic watermarks printed on Sales Invoices, Receipt Vouchers, and ledger statements.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 bg-slate-50/50 p-6 rounded-3xl border border-slate-100">
              
              {/* Left Column: Form Controls */}
              <div className="space-y-6">
                
                {/* Section A: Header Customization */}
                <div className="bg-white p-4 rounded-2xl border border-slate-100 space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                    <span className="text-indigo-600 text-xs font-black uppercase">1. Business Headers</span>
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="label text-[10px]">Business Header Tagline / Subtitle</label>
                      <input
                        type="text"
                        className="input-field text-xs text-slate-700 font-medium"
                        placeholder="e.g. ISO Certified • Manufacturer of Premium Textiles"
                        value={formData.customBranding?.headerSubtitle || ''}
                        onChange={(e) => {
                          const cb = formData.customBranding || {};
                          setFormData({
                            ...formData,
                            customBranding: { ...cb, headerSubtitle: e.target.value }
                          });
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="label text-[10px]">Header Alignment</label>
                        <select
                          className="input-field text-xs py-1.5"
                          value={formData.customBranding?.headerAlign || 'center'}
                          onChange={(e) => {
                            const cb = formData.customBranding || {};
                            setFormData({
                              ...formData,
                              customBranding: { ...cb, headerAlign: e.target.value }
                            });
                          }}
                        >
                          <option value="left">Left Aligned</option>
                          <option value="center">Centered</option>
                          <option value="right">Right Aligned</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="label text-[10px]">Header Border</label>
                        <select
                          className="input-field text-xs py-1.5"
                          value={formData.customBranding?.headerBorderSize || 'single'}
                          onChange={(e) => {
                            const cb = formData.customBranding || {};
                            setFormData({
                              ...formData,
                              customBranding: { ...cb, headerBorderSize: e.target.value }
                            });
                          }}
                        >
                          <option value="none">No Border Line</option>
                          <option value="single">Single Line</option>
                          <option value="double">Double Accent Line</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section B: Signature & Layout Margins */}
                <div className="bg-white p-4 rounded-2xl border border-slate-100 space-y-4">
                  <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                    <span className="text-indigo-600 text-xs font-black uppercase">2. Authorised Signatures & Margins</span>
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="label text-[10px]">Signatory Section Label</label>
                        <input
                          type="text"
                          className="input-field text-xs font-medium"
                          placeholder="e.g. Authorized Signatory"
                          value={formData.customBranding?.signatureLabel || 'Authorized Signatory'}
                          onChange={(e) => {
                            const cb = formData.customBranding || {};
                            setFormData({
                              ...formData,
                              customBranding: { ...cb, signatureLabel: e.target.value }
                            });
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="label text-[10px]">Signatory Position Align</label>
                        <select
                          className="input-field text-xs py-1.5"
                          value={formData.customBranding?.signatureAlign || 'right'}
                          onChange={(e) => {
                            const cb = formData.customBranding || {};
                            setFormData({
                              ...formData,
                              customBranding: { ...cb, signatureAlign: e.target.value }
                            });
                          }}
                        >
                          <option value="left">Align Left</option>
                          <option value="center">Align Center</option>
                          <option value="right">Align Right</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <label className="label text-[10px]">Physical Room / Spacing Height for Sign & Stamp</label>
                        <span className="text-[10px] font-black font-mono text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                          {formData.customBranding?.signatureHeight || 60}px
                        </span>
                      </div>
                      <input
                        type="range"
                        min="20"
                        max="160"
                        step="10"
                        className="w-full h-1.5 accent-indigo-600 cursor-pointer bg-slate-100 rounded-lg appearance-none border-none"
                        value={formData.customBranding?.signatureHeight || 60}
                        onChange={(e) => {
                          const cb = formData.customBranding || {};
                          setFormData({
                             ...formData,
                             customBranding: { ...cb, signatureHeight: parseInt(e.target.value) }
                          });
                        }}
                      />
                      <p className="text-[9px] text-slate-400">Controls the spacing added above your business name to prevent overlapping when physically signing or stamping vouchers and bills.</p>
                    </div>
                  </div>
                </div>

                {/* Section C: Watermark Design Studio */}
                <div className="bg-white p-4 rounded-2xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-indigo-600 text-xs font-black uppercase">3. PDF & Print Watermarks</span>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={formData.customBranding?.watermarkEnabled !== false}
                        onChange={(e) => {
                          const cb = formData.customBranding || {};
                          setFormData({
                            ...formData,
                            customBranding: { ...cb, watermarkEnabled: e.target.checked }
                          });
                        }}
                      />
                      <div className={`w-8 h-4 rounded-full transition-colors relative ${formData.customBranding?.watermarkEnabled !== false ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${formData.customBranding?.watermarkEnabled !== false ? 'translate-x-4' : ''}`} />
                      </div>
                    </label>
                  </div>
                  <div className={`space-y-3 transition-opacity ${formData.customBranding?.watermarkEnabled !== false ? 'opacity-100' : 'opacity-40 cursor-not-allowed'}`}>
                    <div className="space-y-1">
                      <label className="label text-[10px]">Watermark Text</label>
                      <input
                        type="text"
                        disabled={formData.customBranding?.watermarkEnabled === false}
                        className="input-field text-xs font-mono uppercase"
                        placeholder="e.g. ORIGINAL, DUPLICATE, COPY, PAID, DRAFT"
                        value={formData.customBranding?.watermarkText || ''}
                        onChange={(e) => {
                          const cb = formData.customBranding || {};
                          setFormData({
                            ...formData,
                            customBranding: { ...cb, watermarkText: e.target.value.toUpperCase() }
                          });
                        }}
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      {/* Color Palette Choice */}
                      <div className="space-y-1">
                        <label className="label text-[10px]">Watermark Color</label>
                        <select
                          disabled={formData.customBranding?.watermarkEnabled === false}
                          className="input-field text-xs py-1.5"
                          value={formData.customBranding?.watermarkColor || '#6366f1'}
                          onChange={(e) => {
                            const cb = formData.customBranding || {};
                            setFormData({
                              ...formData,
                              customBranding: { ...cb, watermarkColor: e.target.value }
                            });
                          }}
                        >
                          <option value="#6366f1">Indigo Splash</option>
                          <option value="#475569">Slate Dark</option>
                          <option value="#dc2626">Crimson Danger</option>
                          <option value="#d97706">Amber Attention</option>
                          <option value="#059669">Emerald Safe</option>
                        </select>
                      </div>

                      {/* Rotation degrees */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center">
                          <label className="label text-[10px]">Rotation Angle</label>
                          <span className="text-[10px] font-bold text-indigo-600">{formData.customBranding?.watermarkRotation || -30}°</span>
                        </div>
                        <select
                          disabled={formData.customBranding?.watermarkEnabled === false}
                          className="input-field text-xs py-1.5"
                          value={formData.customBranding?.watermarkRotation || -30}
                          onChange={(e) => {
                            const cb = formData.customBranding || {};
                            setFormData({
                              ...formData,
                              customBranding: { ...cb, watermarkRotation: parseInt(e.target.value) }
                            });
                          }}
                        >
                          <option value="0">Horizontal (0°)</option>
                          <option value="-15">Shallow (-15°)</option>
                          <option value="-30">Medium (-30°)</option>
                          <option value="-45">Diagonal (-45°)</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label className="label text-[10px]">Watermark Density / Opacity</label>
                        <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 rounded">{formData.customBranding?.watermarkOpacity || 5}%</span>
                      </div>
                      <input
                        type="range"
                        min="2"
                        max="20"
                        step="1"
                        disabled={formData.customBranding?.watermarkEnabled === false}
                        className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600 border-none"
                        value={formData.customBranding?.watermarkOpacity || 5}
                        onChange={(e) => {
                          const cb = formData.customBranding || {};
                          setFormData({
                            ...formData,
                            customBranding: { ...cb, watermarkOpacity: parseInt(e.target.value) }
                          });
                        }}
                      />
                    </div>
                  </div>
                </div>

              </div>

              {/* Right Column: Terms of Sale Editor & Live Document Preview */}
              <div className="space-y-6">
                
                {/* Terms of Sale Configurator */}
                <div className="bg-white p-4 rounded-2xl border border-slate-100 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="text-indigo-600 text-xs font-black uppercase">4. Structural Terms of Sale & Payment Conditions</span>
                  </div>
                  
                  <div className="space-y-3">
                    <p className="text-[10px] text-slate-400">These parameters will populate dynamically as professional enumerated terms at the bottom left footer of all sales invoices.</p>
                    
                    <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                      {(formData.customBranding?.termsOfSale || []).map((term: string, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 group bg-slate-50 p-2 rounded-xl border border-slate-100">
                          <span className="text-[10px] font-black text-slate-400 font-mono shrink-0 w-4 h-4 bg-white border rounded-full flex items-center justify-center">{idx + 1}</span>
                          <input
                            type="text"
                            className="bg-transparent border-none text-[11px] font-semibold text-slate-700 flex-1 p-0 focus:ring-0"
                            value={term}
                            onChange={(e) => {
                              const cb = formData.customBranding || {};
                              const newTerms = [...(cb.termsOfSale || [])];
                              newTerms[idx] = e.target.value;
                              setFormData({
                                ...formData,
                                customBranding: { ...cb, termsOfSale: newTerms }
                              });
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const cb = formData.customBranding || {};
                              const newTerms = (cb.termsOfSale || []).filter((_: any, i: number) => i !== idx);
                              setFormData({
                                ...formData,
                                customBranding: { ...cb, termsOfSale: newTerms }
                              });
                            }}
                            className="text-slate-300 hover:text-red-500 transition-colors p-1"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      {(formData.customBranding?.termsOfSale || []).length === 0 && (
                        <p className="text-[10.5px] text-slate-400 italic text-center py-4 bg-slate-50/50 rounded-xl">No custom business terms configured. Default generic terms will be printed.</p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const cb = formData.customBranding || {};
                        const currentTerms = cb.termsOfSale || [];
                        setFormData({
                          ...formData,
                          customBranding: { ...cb, termsOfSale: [...currentTerms, 'New custom term of sale / delivery.'] }
                        });
                      }}
                      className="w-full py-2 border border-dashed border-slate-200 uppercase tracking-wide cursor-pointer hover:bg-slate-50/60 rounded-xl text-[10px] text-center font-bold text-slate-500 hover:text-indigo-650 transition-all flex items-center justify-center gap-2"
                    >
                      <Plus size={12} />
                      Add Custom Term
                    </button>
                  </div>
                </div>

                {/* Subtitle / Miniature Watermark Preview */}
                <div className="bg-white p-5 rounded-2xl border border-dashed border-indigo-200 select-none">
                  <p className="font-bold text-slate-400 text-[10px] uppercase mb-3 tracking-widest flex items-center gap-1.5"><Eye size={12} className="text-indigo-500" /> Print Style Live Preview Sheet</p>
                  
                  <div className="relative border border-slate-100 p-6 rounded-xl bg-slate-50/20 overflow-hidden font-sans">
                     
                     {/* Light/Simple Mock Watermark */}
                     {formData.customBranding?.watermarkEnabled !== false && formData.customBranding?.watermarkText && (
                       <div 
                         style={{
                           transform: `translate(-50%, -50%) rotate(${formData.customBranding?.watermarkRotation ?? -30}deg)`,
                           color: formData.customBranding?.watermarkColor || '#6366f1',
                           opacity: (formData.customBranding?.watermarkOpacity ?? 5) / 100
                         }}
                         className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl font-black tracking-widest pointer-events-none uppercase whitespace-nowrap z-0 select-none font-mono"
                       >
                         {formData.customBranding?.watermarkText}
                       </div>
                     )}

                     <div className="relative z-10 space-y-4">
                       {/* Company Info Area */}
                       <div className={`text-${formData.customBranding?.headerAlign || 'center'} space-y-0.5 border-b pb-3`}>
                         <h4 className="font-extrabold text-sm text-indigo-700 uppercase tracking-tight">{formData.name || 'Your Company'}</h4>
                         {formData.customBranding?.headerSubtitle && (
                           <p className="text-[10px] font-bold text-slate-500 italic">{formData.customBranding.headerSubtitle}</p>
                         )}
                         <p className="text-[8px] text-slate-400">123 Business Boulevard, Commercial Sector • GSTIN: {formData.gstIn || 'N/A'}</p>
                         {formData.customBranding?.headerBorderSize === 'double' && (
                           <div className="border-b-2 border-indigo-600/30 border-double h-1 -mt-1" />
                         )}
                       </div>

                       {/* Mock invoice content */}
                       <div className="grid grid-cols-2 text-[8px] text-slate-400">
                         <div>
                           <p className="font-extrabold text-[#555] uppercase">Bill To:</p>
                           <p className="font-bold">ABC Distribution Partners Ltd</p>
                         </div>
                         <div className="text-right">
                           <p className="font-extrabold text-[#555] uppercase">Invoice Info:</p>
                           <p>Vch No: <span className="font-mono">SI-2627-0491</span></p>
                         </div>
                       </div>

                       {/* Terms section */}
                       <div className="text-[8px] border-t pt-3 flex justify-between gap-4">
                         <div className="space-y-1 max-w-[120px] shrink-0">
                           <p className="font-bold text-slate-500 uppercase text-[7px]">Terms & Conditions</p>
                           <ol className="list-decimal pl-2 space-y-0.5 text-slate-400" style={{ transform: 'scale(1)', transformOrigin: 'top left' }}>
                             {(formData.customBranding?.termsOfSale || []).slice(0, 2).map((term: string, i: number) => (
                               <li key={i} className="truncate">{term}</li>
                             ))}
                             {(formData.customBranding?.termsOfSale || []).length > 2 && <li className="italic text-[6px]">And more...</li>}
                           </ol>
                         </div>
                         <div className="flex-1 flex flex-col items-center justify-end" style={{ textAlign: formData.customBranding?.signatureAlign || 'right' }}>
                           <div style={{ minHeight: `${Math.min(60, formData.customBranding?.signatureHeight || 60) / 2}px` }} className="flex items-center justify-center text-[7px] italic text-indigo-400 font-serif">
                             (Stamp & Sign)
                           </div>
                           <div className="border-t border-slate-300 w-24 pt-1" style={{ textAlign: formData.customBranding?.signatureAlign || 'right' }}>
                             <p className="text-[7px] font-extrabold text-slate-400 uppercase tracking-tight truncate">{formData.customBranding?.signatureLabel || 'Authorized Signatory'}</p>
                             <span className="text-[6.5px] font-bold text-slate-400 uppercase block truncate">{formData.name || 'Your Company'}</span>
                           </div>
                         </div>
                       </div>

                     </div>
                   </div>
                 </div>

               </div>
               
             </div>
           </div>

          <div className="md:col-span-2 flex justify-end">
            <button 
              type="submit" 
              disabled={isSaving}
              className="btn-primary px-8 h-12 flex items-center gap-2"
            >
              <Save size={18} /> {isSaving ? 'Updating...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      <div className="card border-red-100 bg-red-50/30 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-100 text-red-600 rounded-lg">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="font-bold text-lg text-red-900">Danger Zone</h3>
            <p className="text-xs text-red-600">Irreversible actions for this company</p>
          </div>
        </div>

        {!showDeleteConfirm ? (
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-2xl border border-red-100">
            <div>
              <p className="font-bold text-sm text-slate-900">Delete this company</p>
              <p className="text-xs text-slate-500">This will permanently remove "{activeCompany.name}" and all its records.</p>
            </div>
            <button 
              onClick={() => setShowDeleteConfirm(true)}
              className="btn-secondary border-red-200 text-red-600 hover:bg-red-50 h-10 px-6 whitespace-nowrap"
            >
              Delete Company
            </button>
          </div>
        ) : (
          <div className="bg-white p-6 rounded-2xl border-2 border-red-200 space-y-4">
            <p className="font-black text-red-600 uppercase tracking-tight text-center">Are you absolutely sure?</p>
            <p className="text-sm text-slate-500 text-center">This action cannot be undone. Type <span className="font-bold text-slate-900 select-all">{activeCompany.name}</span> to confirm.</p>
            <input 
              className="input-field text-center font-bold text-red-600 border-red-200"
              placeholder="Type company name here"
              onChange={(e) => {
                if (e.target.value === activeCompany.name) {
                  // Enable delete button state could go here if we wanted more friction
                }
              }}
            />
            <div className="flex gap-3 justify-center">
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                className="btn-secondary h-10 px-6"
              >
                Cancel
              </button>
              <button 
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-red-600 text-white font-bold h-10 px-8 rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-100"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Permanent Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
