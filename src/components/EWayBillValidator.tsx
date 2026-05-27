import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, 
  Download, 
  Printer, 
  Search, 
  Filter, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Truck, 
  Eye, 
  RefreshCw, 
  FileJson, 
  ShieldCheck, 
  Sparkles,
  MapPin,
  Calendar,
  Building
} from 'lucide-react';
import { dbService } from '../lib/db';

interface EWayBillValidatorProps {
  company: any;
  transactions: any[];
  ledgers: any[];
  items: any[];
  activeFY: any;
  onBack?: () => void;
}

export const EWayBillValidator = ({ 
  company, 
  transactions, 
  ledgers, 
  items, 
  activeFY, 
  onBack 
}: EWayBillValidatorProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'generated' | 'high_value'>('all');
  const [selectedTx, setSelectedTx] = useState<any | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showInvoicePdf, setShowInvoicePdf] = useState<any | null>(null);

  // Form states for e-Way Bill inputs
  const [transportMode, setTransportMode] = useState<'Road' | 'Rail' | 'Air' | 'Ship'>('Road');
  const [vehicleNo, setVehicleNo] = useState('');
  const [vehicleType, setVehicleType] = useState<'Regular' | 'OverDimensionalCargo'>('Regular');
  const [transporterName, setTransporterName] = useState('');
  const [transporterId, setTransporterId] = useState('');
  const [distanceKm, setDistanceKm] = useState<number>(0);
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({});

  const THRESHOLD = 50000;

  // Filter Sales Transactions
  const salesTransactions = useMemo(() => {
    return transactions.filter((t: any) => t.type === 'Sales');
  }, [transactions]);

  // Derived Statistics
  const stats = useMemo(() => {
    const totalSalesValue = salesTransactions.reduce((sum, t) => sum + (t.totalAmount || 0), 0);
    const highValueTx = salesTransactions.filter(t => (t.totalAmount || 0) > THRESHOLD);
    const generatedEWB = salesTransactions.filter(t => t.eWayBillNo && t.eWayBillNo !== '');
    const pendingEWB = highValueTx.filter(t => !t.eWayBillNo || t.eWayBillNo === '');

    return {
      totalCount: salesTransactions.length,
      totalValue: totalSalesValue,
      highValueCount: highValueTx.length,
      highValueValue: highValueTx.reduce((sum, t) => sum + (t.totalAmount || 0), 0),
      generatedCount: generatedEWB.length,
      pendingCount: pendingEWB.length,
    };
  }, [salesTransactions]);

  // List of filtered transactions for the table
  const displayedTransactions = useMemo(() => {
    return salesTransactions.filter((t: any) => {
      // Search check
      const party = ledgers.find(l => l.id === t.partyId);
      const partyName = party?.name || t.partyName || '';
      const invoiceNo = t.voucherNumber || '';
      const searchMatch = 
        partyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoiceNo.toLowerCase().includes(searchTerm.toLowerCase());

      if (!searchMatch) return false;

      // Status filter check
      if (statusFilter === 'pending') {
        return (t.totalAmount || 0) > THRESHOLD && (!t.eWayBillNo || t.eWayBillNo === '');
      }
      if (statusFilter === 'generated') {
        return t.eWayBillNo && t.eWayBillNo !== '';
      }
      if (statusFilter === 'high_value') {
        return (t.totalAmount || 0) > THRESHOLD;
      }

      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [salesTransactions, ledgers, searchTerm, statusFilter]);

  // Open modal for details/generation
  const handleOpenGenerator = (tx: any) => {
    setSelectedTx(tx);
    setTransportMode('Road');
    setVehicleNo(tx.motorVehicleNo || '');
    setVehicleType('Regular');
    setTransporterName(tx.dispatchedThrough || '');
    setTransporterId('');
    
    // Estimate distance roughly based on destination length or default to 150km
    const guessedDistance = Math.min(1000, Math.max(20, (tx.destination?.length || 5) * 20));
    setDistanceKm(guessedDistance);
    setFormErrors({});
  };

  // Validate E-Way Bill Inputs
  const validateForm = () => {
    const errors: { [key: string]: string } = {};
    
    if (transportMode === 'Road') {
      if (!vehicleNo.trim()) {
        errors.vehicleNo = 'Vehicle registration number is required for Road transport';
      } else {
        // Vehicle registration regex (e.g., DL3CA1234, DL-03-CA-1234, HR26AB8899)
        const vNoRegex = /^[A-Z]{2}[-|\s]?[0-9]{2}[-|\s]?[A-Z]{1,2}[-|\s]?[0-9]{4}$/i;
        if (!vNoRegex.test(vehicleNo.trim())) {
          errors.vehicleNo = 'Invalid Indian Vehicle No format (e.g. DL-03-CA-1234 or HR26AB8899)';
        }
      }
    }

    if (distanceKm <= 0 || isNaN(distanceKm)) {
      errors.distanceKm = 'Estimated Distance (Km) must be greater than 0';
    } else if (distanceKm > 4000) {
      errors.distanceKm = 'Distance cannot exceed 4000 Km inside India';
    }

    // Party address validation
    const party = ledgers.find(l => l.id === selectedTx?.partyId);
    if (!party?.address && !selectedTx?.destination) {
      errors.delivery = 'Party Address or Ship-To Destination address is missing on the voucher';
    }

    // Verify company GSTIN
    if (!company?.gstNumber) {
      errors.companyGst = 'Company GSTIN is not set in settings';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Check state and pin codes
  const handleVerifyAndGenerate = async () => {
    if (!validateForm() || !selectedTx) return;

    setIsGenerating(true);
    try {
      // Simulate real-time secure E-Way Bill No generation (12 digit code)
      const datePrefix = "27" + String(new Date().getFullYear()).slice(-2); // e-way bills starts with state prefix or standard codes
      const midDigits = String(Math.floor(10000000 + Math.random() * 90000000));
      const finalEWayBillNo = datePrefix + midDigits;
      const today = new Date().toISOString().split('T')[0];

      // Prepare updated field object for the transaction
      const updatePayload = {
        eWayBillNo: finalEWayBillNo,
        eWayBillDate: today,
        eWayBillStatus: 'Generated',
        dispatchedThrough: transporterName || selectedTx.dispatchedThrough || 'Direct Road',
        destination: selectedTx.destination || 'Direct Delivery',
        motorVehicleNo: vehicleNo.toUpperCase(),
        eWayBillDetails: {
          transportMode,
          vehicleType,
          transporterId: transporterId || 'GSTIN' + (company?.gstNumber || '33XXXXX1234X'),
          distanceKm: Number(distanceKm),
          generatedAt: new Date().toISOString(),
          validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000 * Math.ceil(distanceKm / 200)).toISOString().split('T')[0] // 1 day per 200km
        }
      };

      await dbService.update(`companies/${company.id}/transactions`, selectedTx.id, updatePayload);
      
      // Update local transaction reference so UI reflects
      selectedTx.eWayBillNo = finalEWayBillNo;
      selectedTx.eWayBillDate = today;
      selectedTx.eWayBillStatus = 'Generated';
      selectedTx.motorVehicleNo = vehicleNo.toUpperCase();
      selectedTx.dispatchedThrough = transporterName || 'Direct Road';
      selectedTx.eWayBillDetails = updatePayload.eWayBillDetails;

      alert(`e-Way Bill Generated Successfully! Number: ${finalEWayBillNo}`);
    } catch (e: any) {
      console.error(e);
      alert('Failed to generate e-Way Bill in sandbox: ' + e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // Cancel/Revoke E-way Bill
  const handleCancelEWayBill = async (tx: any) => {
    if (!window.confirm('Are you sure you want to cancel / revoke this Simulated e-Way Bill? This will mark it as Cancelled/Pending.')) return;

    try {
      const updatePayload = {
        eWayBillNo: '',
        eWayBillDate: '',
        eWayBillStatus: 'Pending',
        eWayBillDetails: null
      };

      await dbService.update(`companies/${company.id}/transactions`, tx.id, updatePayload);
      
      tx.eWayBillNo = '';
      tx.eWayBillDate = '';
      tx.eWayBillStatus = 'Pending';
      tx.eWayBillDetails = null;

      alert('e-Way Bill revoked and marked as Pending.');
      // Refresh selected tx if current
      if (selectedTx?.id === tx.id) {
        setSelectedTx({ ...tx });
      } else {
        setSelectedTx(null); // refresh view
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  // Export JSON payload as compliant E-Way Bill schema
  const handleExportJson = (tx: any) => {
    const party = ledgers.find(l => l.id === tx.partyId);
    const transportDetails = tx.eWayBillDetails || {};

    const payload = {
      Version: "1.0.0421",
      billLists: [
        {
          userGstin: company?.gstNumber || "27ABCDE1234FZ5",
          supplyType: "O",
          subSupplyType: 1,
          docType: "INV",
          docNo: tx.voucherNumber,
          docDate: tx.date ? tx.date.split('-').reverse().join('/') : '',
          fromGstin: company?.gstNumber || "27ABCDE1234FZ5",
          fromTrdName: company?.name || "My Company",
          fromAddr1: company?.address || "Company Address",
          fromAddr2: "",
          fromPlace: company?.city || "City",
          fromPincode: parseInt(company?.pincode || "400001"),
          fromStateCode: parseInt(company?.gstNumber?.substring(0, 2) || "27"),
          toGstin: party?.gstIn || party?.gstin || "URP",
          toTrdName: party?.name || tx.partyName || "Unregistered",
          toAddr1: party?.address || tx.destination || "Destination Address",
          toAddr2: "",
          toPlace: party?.city || tx.destination || "City",
          toPincode: parseInt(party?.pincode || "400002"),
          toStateCode: parseInt((party?.gstIn || party?.gstin)?.substring(0, 2) || "27"),
          transactionType: 1,
          transMode: transportMode === 'Road' ? 1 : transportMode === 'Rail' ? 2 : transportMode === 'Air' ? 3 : 4,
          transDistance: transportDetails.distanceKm || distanceKm || 100,
          transporterName: tx.dispatchedThrough || "Direct Road",
          transporterId: transportDetails.transporterId || "URP",
          transDocNo: tx.billOfLading || "",
          transDocDate: tx.date ? tx.date.split('-').reverse().join('/') : '',
          vehicleNo: tx.motorVehicleNo || vehicleNo || "",
          vehicleType: vehicleType === 'Regular' ? "R" : "O",
          itemList: (tx.items || []).map((i: any, index: number) => {
            const mItem = items?.find(mit => mit.id === i.itemId || mit.name === i.name);
            return {
              itemNo: index + 1,
              productName: i.name,
              productDesc: i.name,
              hsnCode: parseInt(mItem?.hsn || "998311"),
              quantity: i.qty || 1,
              qtyUnit: mItem?.unit || "PCS",
              cgstRate: i.gstRate / 2,
              sgstRate: i.gstRate / 2,
              igstRate: i.igst ? i.gstRate : 0,
              taxableAmount: i.amount || 0
            };
          }),
          totalValue: tx.subTotal || tx.totalAmount,
          cgstValue: tx.cgst || 0,
          sgstValue: tx.sgst || 0,
          igstValue: tx.igst || 0,
          cessValue: 0,
          totInvValue: tx.totalAmount
        }
      ]
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `EWay_Payload_Inv_${tx.voucherNumber}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="p-4 md:p-6 text-slate-800 bg-slate-50/50 min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2 hover:bg-slate-200/70 rounded-xl transition-all cursor-pointer"
            id="back_btn"
          >
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
                <Truck className="h-3.5 w-3.5" /> E-Way Permits
              </span>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" /> NIC SANDBOX
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 mt-2 font-display">e-Way Bill Compliance Manager</h1>
            <p className="text-slate-500 text-xs mt-0.5">Generate, validate, and manage GST vehicle movement permits for shipments exceeding ₹50,000.</p>
          </div>
        </div>

        <div className="flex gap-2">
          <button 
            onClick={() => {
              setSearchTerm('');
              setStatusFilter('all');
            }}
            className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 transition-all flex items-center gap-1.5"
          >
            <RefreshCw className="h-4 w-4" /> Reset Filters
          </button>
        </div>
      </div>

      {/* Stats Board */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm flex flex-col justify-between">
          <span className="text-slate-400 font-bold uppercase tracking-widest text-[9px] font-mono">Total Sales Invoices</span>
          <div className="mt-2.5 flex items-baseline justify-between">
            <h2 className="text-md lg:text-xl font-black text-slate-900 font-display">{stats.totalCount}</h2>
            <span className="text-[10px] text-slate-400">Value: ₹{stats.totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          </div>
        </div>

        <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/70 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center">
            <span className="text-amber-800 font-bold uppercase tracking-widest text-[9px] font-mono">Mandatory &gt; ₹50,050 Limit</span>
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <h2 className="text-md lg:text-xl font-black text-amber-900 font-display">{stats.highValueCount}</h2>
            <span className="text-[10px] text-amber-600 font-semibold">Value: ₹{stats.highValueValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          </div>
        </div>

        <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-200/70 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center">
            <span className="text-emerald-800 font-bold uppercase tracking-widest text-[9px] font-mono">e-Way Permits Generated</span>
            <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <h2 className="text-md lg:text-xl font-black text-emerald-900 font-display">{stats.generatedCount}</h2>
            <span className="text-[10px] text-emerald-600 font-semibold">Active Permits</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border bg-rose-50/40 border-rose-200/70 shadow-sm flex flex-col justify-between">
          <div className="flex justify-between items-center">
            <span className="text-rose-800 font-bold uppercase tracking-widest text-[9px] font-mono">Permits Pending</span>
            <Clock className="h-3.5 w-3.5 text-rose-500 animate-pulse" />
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <h2 className="text-md lg:text-xl font-black text-rose-900 font-display">{stats.pendingCount}</h2>
            <span className="text-[10px] text-rose-600 font-bold">Requires Action</span>
          </div>
        </div>
      </div>

      {/* Main Panel grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left/Middle Column - Transaction List */}
        <div className="xl:col-span-2 bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
          
          {/* Filters Bar */}
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-50/70">
            <div className="relative w-full sm:w-64">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search Invoice No or Party..."
                className="w-full pl-9 pr-4 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto-scroll text-[11px]">
              <span className="text-slate-400 font-medium whitespace-nowrap"><Filter className="h-3.5 w-3.5 inline mr-1" />Filter:</span>
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1 rounded-full font-bold transition-all ${statusFilter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                All Sales
              </button>
              <button
                onClick={() => setStatusFilter('high_value')}
                className={`px-3 py-1 rounded-full font-bold transition-all ${statusFilter === 'high_value' ? 'bg-amber-100 text-amber-800 border-amber-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                &ge; ₹50k Limit
              </button>
              <button
                onClick={() => setStatusFilter('pending')}
                className={`px-3 py-1 rounded-full font-bold transition-all ${statusFilter === 'pending' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                Pending
              </button>
              <button
                onClick={() => setStatusFilter('generated')}
                className={`px-3 py-1 rounded-full font-bold transition-all ${statusFilter === 'generated' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                Generated
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            {displayedTransactions.length === 0 ? (
              <div className="p-10 text-center flex flex-col items-center justify-center">
                <Truck className="h-10 w-10 text-slate-300 mb-2.5" />
                <span className="text-slate-600 font-bold block text-sm">No Sales Transactions Found</span>
                <span className="text-slate-400 text-xs mt-0.5">Change filters or create higher value Sales records above ₹50,000.</span>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-400">
                    <th className="p-3">Inv. No &amp; Date</th>
                    <th className="p-3">Consignee &amp; GSTIN</th>
                    <th className="p-3 text-right">Invoice Value</th>
                    <th className="p-3">vehicle information</th>
                    <th className="p-3">e-Way status</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {displayedTransactions.map((tx: any) => {
                    const party = ledgers.find(l => l.id === tx.partyId);
                    const partyName = party?.name || tx.partyName || 'Unregistered Party';
                    const partyGstin = party?.gstIn || party?.gstin || 'No GSTIN (URP)';
                    const isHighValue = (tx.totalAmount || 0) > THRESHOLD;
                    const hasEWay = tx.eWayBillNo && tx.eWayBillNo !== '';

                    return (
                      <tr 
                        key={tx.id}
                        className={`hover:bg-slate-50/50 cursor-pointer ${selectedTx?.id === tx.id ? 'bg-indigo-50/30 font-medium' : ''}`}
                        onClick={() => setSelectedTx(tx)}
                      >
                        <td className="p-3">
                          <span className="font-bold text-slate-900 block font-display">{tx.voucherNumber}</span>
                          <span className="text-[10px] text-slate-400 block mt-0.5">{tx.date?.split('-').reverse().join('/')}</span>
                        </td>
                        <td className="p-3">
                          <span className="font-semibold text-slate-800 block truncate max-w-[200px]">{partyName}</span>
                          <span className="text-[10px] font-mono text-slate-400 block mt-0.5 uppercase">{partyGstin}</span>
                        </td>
                        <td className="p-3 text-right">
                          <span className="font-bold text-slate-900 font-mono">₹{tx.totalAmount?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          {isHighValue ? (
                            <span className="text-[9px] bg-red-50 text-red-600 border border-red-200 font-bold px-1.5 py-0.5 rounded ml-1 uppercase block mt-1 text-center w-max ml-auto">
                              ⚠️ EWB Mandatory
                            </span>
                          ) : (
                            <span className="text-[9px] bg-slate-50 text-slate-500 border border-slate-200 font-bold px-1.5 py-0.5 rounded ml-1 uppercase block mt-1 text-center w-max ml-auto">
                              Optional
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          {tx.motorVehicleNo ? (
                            <div>
                              <span className="text-slate-800 font-bold font-mono uppercase bg-slate-100 px-1.5 py-1 rounded border border-slate-200/60 block w-max">{tx.motorVehicleNo}</span>
                              <span className="text-[10px] text-slate-400 truncate max-w-[140px] block mt-0.5">{tx.dispatchedThrough || 'Road'}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs italic">No dispatch data</span>
                          )}
                        </td>
                        <td className="p-3">
                          {hasEWay ? (
                            <div className="flex flex-col">
                              <span className="inline-flex items-center gap-1.5 text-emerald-800 bg-emerald-100/60 text-[10px] font-black px-2 py-0.5 rounded shadow-sm w-max uppercase">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> Generated
                              </span>
                              <span className="text-[10px] font-mono text-slate-500 font-bold block mt-1">{tx.eWayBillNo}</span>
                            </div>
                          ) : isHighValue ? (
                            <span className="inline-flex items-center gap-1.5 text-rose-800 bg-rose-100/60 text-[10px] font-black px-2 py-0.5 rounded w-max uppercase animate-pulse">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500"></span> Required
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-slate-500 bg-slate-100 text-[10px] font-medium px-2 py-0.5 rounded w-max uppercase">
                              No Permit
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {hasEWay ? (
                              <>
                                <button
                                  onClick={() => setSelectedTx(tx)}
                                  title="View e-Way Bill Permit"
                                  className="p-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[10px] font-black uppercase tracking-wider flex items-center gap-1"
                                >
                                  <Eye className="h-3.5 w-3.5" /> View
                                </button>
                                <button
                                  onClick={() => handleExportJson(tx)}
                                  title="Export JSON"
                                  className="p-1 px-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md"
                                >
                                  <FileJson className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleOpenGenerator(tx)}
                                className={`p-1 px-3 rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer select-none ${isHighValue ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                              >
                                <Sparkles className="h-3.5 w-3.5" /> Generate
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Info and Generator Console Column */}
        <div className="xl:col-span-1 flex flex-col gap-6">
          {selectedTx ? (
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col h-full">
              {/* Card Header for Details */}
              <div className="bg-gradient-to-r from-slate-900 to-indigo-950 p-4 text-white flex justify-between items-center">
                <div>
                  <h4 className="text-[10px] font-black tracking-widest uppercase text-slate-300">Active Selection</h4>
                  <h3 className="text-sm font-bold font-display mt-0.5">{selectedTx.voucherNumber} ({selectedTx.date ? selectedTx.date.split('-').reverse().join('/') : ''})</h3>
                </div>
                {selectedTx.eWayBillNo && (
                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[9px] font-black px-2 py-0.5 rounded uppercase">
                    Voucher Linked
                  </span>
                )}
              </div>

              {/* Card Body */}
              <div className="p-4 flex-1 overflow-y-auto max-h-[580px] text-xs space-y-4">
                {/* Sale info & Party */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Consignee Party Information</span>
                  <div className="mt-1.5">
                    <span className="font-bold text-slate-800 text-xs block">{ledgers.find(l => l.id === selectedTx.partyId)?.name || selectedTx.partyName}</span>
                    <span className="text-[10px] font-mono text-slate-500 block mt-0.5">GSTIN: {ledgers.find(l => l.id === selectedTx.partyId)?.gstIn || ledgers.find(l => l.id === selectedTx.partyId)?.gstin || 'No GSTIN (URP)'}</span>
                    <span className="text-slate-500 text-[10px] block mt-1 italic">
                      <MapPin className="h-3 w-3 inline mr-1 text-slate-400" />
                      Address: {ledgers.find(l => l.id === selectedTx.partyId)?.address || selectedTx.destination || 'Not Specify'}
                    </span>
                  </div>
                  <div className="border-t border-slate-200/60 mt-2 pt-2 flex justify-between text-[11px]">
                    <span className="text-slate-500">Invoice Amount:</span>
                    <span className="font-bold text-slate-900">₹{selectedTx.totalAmount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {/* Status Switch: Generated VS Form */}
                {selectedTx.eWayBillNo ? (
                  /* Case A: E-way Bill already generated - Render Permit EWB-01 certificate view */
                  <div className="space-y-4">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-emerald-900">
                      <div className="flex gap-2 items-start">
                        <CheckCircle className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold text-emerald-950 block">e-Way Bill Permit is Active</span>
                          <span className="text-[10px] text-emerald-800 block mt-0.5">Simulated correctly inside AI Sandbox according to Rule 138 of Goods &amp; Services Tax Rules.</span>
                        </div>
                      </div>
                    </div>

                    {/* e-Way Bill Print View */}
                    <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/50 shadow-inner space-y-3 relative font-sans">
                      {/* Form GST EWB-01 header */}
                      <div className="text-center pb-2.5 border-b border-dashed border-slate-300">
                        <span className="font-bold text-indigo-700 text-[10px] uppercase block tracking-wider font-mono">FORM GST EWB-01</span>
                        <h5 className="font-black text-xs text-slate-900 block font-display">e-WAY BILL PERMIT</h5>
                        <span className="text-[9px] text-slate-400 block mt-0.5">(Government of India / GST Portal Sandbox)</span>
                      </div>

                      {/* Barcode/QR code representation */}
                      <div className="flex flex-col items-center justify-center p-2 bg-white rounded border border-slate-200 w-max mx-auto shadow-sm">
                        <div className="flex gap-1 items-end h-8">
                          {Array.from({ length: 28 }).map((_, i) => (
                            <div 
                              key={i} 
                              className="bg-slate-900" 
                              style={{ width: (i % 3 === 0 ? '3px' : i % 5 === 0 ? '1px' : '2px'), height: '100%', opacity: (i % 7 === 0 ? 0.3 : 1) }}
                            />
                          ))}
                        </div>
                        <span className="text-[9px] font-mono tracking-widest text-slate-500 font-bold mt-1.5">{selectedTx.eWayBillNo}</span>
                      </div>

                      {/* E-way Bill details fields */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] pt-1">
                        <div>
                          <span className="text-slate-400">e-Way Bill No:</span>
                          <span className="font-bold text-slate-800 block font-mono">{selectedTx.eWayBillNo}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Generation Date:</span>
                          <span className="font-bold text-slate-800 block">{selectedTx.eWayBillDate?.split('-').reverse().join('/')}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Supplier GSTIN:</span>
                          <span className="font-bold text-slate-800 block font-mono uppercase">{company?.gstNumber || '27XXXXX1234X'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Recipient GSTIN:</span>
                          <span className="font-bold text-slate-800 block font-mono uppercase">{ledgers.find(l => l.id === selectedTx.partyId)?.gstIn || ledgers.find(l => l.id === selectedTx.partyId)?.gstin || 'URP'}</span>
                        </div>
                        <div className="col-span-2 border-t border-slate-200/60 my-1"></div>
                        
                        {/* Part A */}
                        <div className="col-span-2">
                          <span className="font-black text-rose-800 uppercase text-[9px] tracking-wide block mb-1">PART-A DETAILS (Goods Information)</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Invoice Ref No:</span>
                          <span className="font-bold text-slate-800 block mt-0.5">{selectedTx.voucherNumber}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Total Goods Value:</span>
                          <span className="font-bold text-slate-800 block mt-0.5">₹{selectedTx.totalAmount?.toLocaleString('en-IN', { minimumFractionDigits: 0 })}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-slate-400">Place of Delivery:</span>
                          <span className="font-semibold text-slate-800 block truncate mt-0.5">{selectedTx.destination || 'Consignee Delivery Location'}</span>
                        </div>
                        <div className="col-span-2 border-t border-slate-200/60 my-1"></div>

                        {/* Part B */}
                        <div className="col-span-2">
                          <span className="font-black text-indigo-800 uppercase text-[9px] tracking-wide block mb-1">PART-B DETAILS (Vehicle Information)</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Mode of Transport:</span>
                          <span className="font-bold text-slate-800 block mt-0.5">{selectedTx.eWayBillDetails?.transportMode || 'Road'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Vehicle Type / Size:</span>
                          <span className="font-bold text-slate-800 block mt-0.5">{selectedTx.eWayBillDetails?.vehicleType || 'Regular'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Vehicle Reg No:</span>
                          <span className="font-black text-indigo-950 font-mono text-[11px] block mt-0.5 uppercase bg-slate-100 px-1 py-0.5 rounded border border-slate-200/50 w-max">{selectedTx.motorVehicleNo}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Distance Travel:</span>
                          <span className="font-bold text-slate-800 block mt-0.5">{selectedTx.eWayBillDetails?.distanceKm || distanceKm || 100} Km</span>
                        </div>
                        <div className="col-span-2 mt-1">
                          <span className="text-slate-400 block">Validity Period:</span>
                          <span className="font-semibold text-emerald-800 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded block w-max mt-0.5">
                            Valid Up to {selectedTx.eWayBillDetails?.validUntil ? selectedTx.eWayBillDetails.validUntil.split('-').reverse().join('/') : 'Expiration date'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => window.print()}
                        className="flex-1 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm text-xs"
                      >
                        <Printer className="h-4 w-4" /> Print Permit
                      </button>
                      <button
                        onClick={() => handleExportJson(selectedTx)}
                        className="py-2 px-3 border border-slate-200 hover:bg-slate-100 text-slate-600 font-bold rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer"
                        title="Export NIC JSON Format"
                      >
                        <Download className="h-4 w-4" /> Payload
                      </button>
                      <button
                        onClick={() => handleCancelEWayBill(selectedTx)}
                        className="py-2 px-3 border border-rose-200 hover:bg-rose-50 text-rose-600 font-bold rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer"
                        title="Revoke / Cancel Permit"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Case B: e-Way Bill need to be generated - Render Validation form */
                  <div className="space-y-4 pt-1">
                    <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 text-slate-600 block leading-relaxed text-[11px]">
                      <span className="font-bold text-slate-800 block text-xs">Verify Details for Document Validation</span>
                      Complete transporter and vehicle details below. Once generated, an official 12-digit compliant e-Way Bill key will be generated.
                    </div>

                    <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
                      {/* Transport Mode */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 block uppercase mb-1">Mode of Transport</label>
                        <div className="grid grid-cols-4 gap-1">
                          {(['Road', 'Rail', 'Air', 'Ship'] as const).map(mode => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => {
                                setTransportMode(mode);
                                if (mode !== 'Road') setVehicleNo('');
                              }}
                              className={`py-1.5 rounded-lg border font-bold text-[10px] text-center transition-all ${transportMode === mode ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Distance */}
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Estimated Distance (Km)</label>
                          <span className="text-[10px] text-indigo-600 font-medium">Inside India Boundary</span>
                        </div>
                        <input
                          type="number"
                          value={distanceKm || ''}
                          onChange={(e) => setDistanceKm(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-indigo-500 font-semibold focus:outline-none"
                          placeholder="e.g. 150"
                        />
                        {formErrors.distanceKm && (
                          <span className="text-[10px] text-rose-500 font-semibold block mt-1">{formErrors.distanceKm}</span>
                        )}
                      </div>

                      {/* Vehicle Number (if Road) */}
                      {transportMode === 'Road' && (
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Vehicle Reg Number</label>
                            <span className="text-[10px] text-slate-400 font-mono">Format: DL-03-CA-1234</span>
                          </div>
                          <input
                            type="text"
                            value={vehicleNo}
                            onChange={(e) => setVehicleNo(e.target.value)}
                            className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:ring-1 focus:ring-indigo-500 font-semibold uppercase font-mono focus:outline-none"
                            placeholder="DL 01 AA 1111"
                          />
                          {formErrors.vehicleNo && (
                            <span className="text-[10px] text-rose-500 font-semibold block mt-1">{formErrors.vehicleNo}</span>
                          )}
                        </div>
                      )}

                      {/* Transporter Details */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 block uppercase mb-1">Transporter / Agency Courier Name</label>
                        <input
                          type="text"
                          value={transporterName}
                          onChange={(e) => setTransporterName(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          placeholder="e.g. VRL Logistics, SafeExpress"
                        />
                      </div>

                      {/* Transporter ID */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 block uppercase mb-1">Transporter GSTIN / Transporter ID Docs</label>
                        <input
                          type="text"
                          value={transporterId}
                          onChange={(e) => setTransporterId(e.target.value)}
                          className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none uppercase font-mono tracking-wider focus:ring-1 focus:ring-indigo-500"
                          placeholder="e.g. 29ABCDE1234FZ1"
                        />
                      </div>

                      {/* Submit / Generate Button */}
                      <button
                        type="button"
                        onClick={handleVerifyAndGenerate}
                        disabled={isGenerating}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 font-bold font-display uppercase tracking-wider text-xs text-white rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer mt-4"
                      >
                        {isGenerating ? (
                          <>
                            <RefreshCw className="h-4 w-4 animate-spin" /> Fetching GST permit keys...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4" /> Generate Permit EWB-01
                          </>
                        )}
                      </button>
                    </form>

                    {formErrors.delivery && (
                      <div className="bg-rose-50 border border-rose-200 p-2.5 rounded-lg text-rose-800 text-[10px] font-semibold mt-2">
                        ⚠️ Compliance Warning: {formErrors.delivery}
                      </div>
                    )}
                    {formErrors.companyGst && (
                      <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-lg text-amber-800 text-[10px] font-semibold mt-2">
                        ⚠️ Config Failure: {formErrors.companyGst}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Case C: No selection */
            <div className="bg-slate-100/50 rounded-xl border border-dashed border-slate-300 p-8 text-center flex flex-col items-center justify-center h-[500px]">
              <Truck className="h-10 w-10 text-slate-300 mb-2" />
              <span className="text-slate-500 font-bold block text-sm">Select a Sales Invoice</span>
              <span className="text-slate-400 text-xs mt-0.5">Click any transaction in the list to generate its permit, view FORM GST EWB-01, or export compliance files.</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
