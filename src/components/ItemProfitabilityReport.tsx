import React, { useState, useMemo, useRef } from 'react';
import { ArrowLeft, Download, ShoppingBag, BarChart3, TrendingUp, Calendar, Search, RefreshCw } from 'lucide-react';
import { dbService } from '../lib/db';
import { jsPDF } from 'jspdf';
import { toCanvas } from 'html-to-image';

export const ItemProfitabilityReport = ({ company, transactions, companyId, activeFY, reportPeriod, setReportPeriod, onBack }: any) => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState('');

  React.useEffect(() => {
    return dbService.listenCollection(`companies/${companyId}/items`, [], (data) => {
      setItems(data);
      setLoading(false);
    });
  }, [companyId]);

  const profitabilityData = useMemo(() => {
    const filteredTx = transactions.filter((t: any) => 
      t.type === 'Sales' && t.date >= reportPeriod.startDate && t.date <= reportPeriod.endDate
    );

    const itemStats: Record<string, any> = {};

    filteredTx.forEach((tx: any) => {
      if (!tx.items) return;
      tx.items.forEach((line: any) => {
        if (!line.itemId) return;
        
        if (!itemStats[line.itemId]) {
          const itemMaster = items.find(i => i.id === line.itemId);
          itemStats[line.itemId] = {
            id: line.itemId,
            name: line.name || itemMaster?.name || 'Unknown Item',
            sku: itemMaster?.sku || '',
            unit: itemMaster?.unit || '',
            purchasePrice: itemMaster?.purchasePrice || 0,
            quantitySold: 0,
            salesValue: 0,
            cogs: 0,
            profit: 0
          };
        }

        const stats = itemStats[line.itemId];
        const qty = Number(line.qty) || 0;
        const rate = Number(line.rate) || 0;
        const amount = Number(line.amount) || 0;

        stats.quantitySold += qty;
        stats.salesValue += amount;
        stats.cogs += (qty * stats.purchasePrice);
      });
    });

    return Object.values(itemStats)
      .map(item => ({
        ...item,
        profit: item.salesValue - item.cogs,
        margin: item.salesValue > 0 ? ((item.salesValue - item.cogs) / item.salesValue) * 100 : 0
      }))
      .filter(item => (item.name || '').toLowerCase().includes((searchTerm || '').toLowerCase()) || (item.sku || '').toLowerCase().includes((searchTerm || '').toLowerCase()))
      .sort((a, b) => b.profit - a.profit);
  }, [transactions, items, reportPeriod, searchTerm]);

  const totals = useMemo(() => {
    return profitabilityData.reduce((acc, curr) => ({
      sales: acc.sales + curr.salesValue,
      cogs: acc.cogs + curr.cogs,
      profit: acc.profit + curr.profit
    }), { sales: 0, cogs: 0, profit: 0 });
  }, [profitabilityData]);

  const downloadPDF = async () => {
    if (!reportRef.current) return;
    setIsDownloading(true);
    setIsExporting(true);
    
    setTimeout(async () => {
      try {
        const canvas = await toCanvas(reportRef.current!, {
          quality: 0.95,
          backgroundColor: '#ffffff',
        });
        
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4'
        });
        
        const imgProps = pdf.getImageProperties(imgData);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(`ItemProfitability_${new Date().toISOString().split('T')[0]}.pdf`);
      } catch (error) {
        console.error('PDF Generation Error:', error);
        alert('Failed to generate PDF. Please use the Print option.');
      } finally {
        setIsDownloading(false);
        setIsExporting(false);
      }
    }, 100);
  };

  if (loading) return <div className="h-64 flex items-center justify-center text-slate-400">Loading item data...</div>;

  return (
    <div className="space-y-6 pb-20 print:pb-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm gap-4 print:hidden">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h3 className="font-bold text-slate-900">Item Profitability Report</h3>
            <p className="text-[10px] text-slate-400 font-medium">Profit analysis based on sales vs master purchase price</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              className="input-field pl-9 py-1.5 text-xs w-48 bg-slate-50 border-transparent focus:bg-white focus:border-indigo-500 transition-all" 
              placeholder="Filter by name or SKU..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <input 
              type="date" 
              value={reportPeriod.startDate}
              onChange={e => setReportPeriod({...reportPeriod, startDate: e.target.value})}
              className="bg-transparent border-none text-[10px] font-bold text-slate-600 focus:ring-0 p-1 cursor-pointer"
            />
            <span className="text-slate-300 px-1 self-center">—</span>
            <input 
              type="date" 
              value={reportPeriod.endDate}
              onChange={e => setReportPeriod({...reportPeriod, endDate: e.target.value})}
              className="bg-transparent border-none text-[10px] font-bold text-slate-600 focus:ring-0 p-1 cursor-pointer"
            />
          </div>
          <button 
            onClick={downloadPDF} 
            disabled={isDownloading}
            className="btn-secondary text-xs flex items-center gap-2 whitespace-nowrap"
          >
            {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            {isDownloading ? 'Downloading...' : 'Download PDF'}
          </button>
        </div>
      </div>

      <div ref={reportRef} className="space-y-6 bg-white p-8 print:p-0">
        <div className={`${isExporting ? 'block' : 'hidden'} print:block text-center mb-8 pb-6 border-b-2 border-slate-900`}>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900">{company?.name}</h1>
          <div className="text-[10px] uppercase font-bold text-slate-500 mt-1 flex flex-col gap-0.5">
            <span>{company?.address}</span>
            <span>GSTIN: {company?.gstIn} | PAN: {company?.pan || (company?.gstIn ? company.gstIn.substring(2, 12) : 'N/A')}</span>
            {company?.phone && <span>Ph: {company.phone} | Email: {company.email}</span>}
          </div>
          <div className="mt-6 pt-4 border-t border-slate-100">
            <h2 className="text-xl font-bold uppercase tracking-widest text-slate-800">Item Profitability Analysis</h2>
            <p className="text-sm font-bold text-slate-500 mt-1">Period: {new Date(reportPeriod.startDate).toLocaleDateString()} to {new Date(reportPeriod.endDate).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 print:grid-cols-3">
          <div className="card p-6 border-l-4 border-indigo-600">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Sales (Revenue)</span>
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><ShoppingBag size={14} /></div>
            </div>
            <div className="text-2xl font-black text-slate-900">₹{totals.sales.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 mt-1">Excl. applicable GST</div>
          </div>
          <div className="card p-6 border-l-4 border-orange-600">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total COGS</span>
              <div className="p-2 bg-orange-50 text-orange-600 rounded-lg"><TrendingUp size={14} /></div>
            </div>
            <div className="text-2xl font-black text-slate-900">₹{totals.cogs.toLocaleString()}</div>
            <div className="text-[10px] text-slate-400 mt-1">Based on purchase price in item master</div>
          </div>
          <div className="card p-6 border-l-4 border-emerald-600">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Net Profit</span>
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><BarChart3 size={14} /></div>
            </div>
            <div className="text-2xl font-black text-emerald-600">₹{totals.profit.toLocaleString()}</div>
            <div className="text-[10px] text-emerald-500 font-bold mt-1">
              Overall Margin: {totals.sales > 0 ? ((totals.profit / totals.sales) * 100).toFixed(2) : 0}%
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100 uppercase text-[10px] font-black text-slate-400 tracking-widest">
                <tr>
                  <th className="px-6 py-4">Item Details</th>
                  <th className="px-6 py-4 text-center">Unit</th>
                  <th className="px-6 py-4 text-center">Qty Sold</th>
                  <th className="px-6 py-4 text-right">Sales Value</th>
                  <th className="px-6 py-4 text-right">COGS (Cost)</th>
                  <th className="px-6 py-4 text-right">Profit</th>
                  <th className="px-6 py-4 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {profitabilityData.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-800">{row.name}</div>
                      <div className="text-[10px] text-slate-400">SKU: {row.sku || 'N/A'} | Cost: ₹{row.purchasePrice}</div>
                    </td>
                    <td className="px-6 py-4 text-center text-xs font-medium text-slate-500">{row.unit}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="font-bold text-slate-700">{row.quantitySold}</span>
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900">₹{row.salesValue.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right font-medium text-slate-500">₹{row.cogs.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right">
                      <span className={`font-black ${row.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        ₹{row.profit.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className={`w-12 h-1.5 rounded-full bg-slate-100 overflow-hidden hidden sm:block`}>
                          <div 
                            className={`h-full ${row.profit >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} 
                            style={{ width: `${Math.min(Math.abs(row.margin), 100)}%` }}
                          />
                        </div>
                        <span className={`text-[11px] font-black min-w-[40px] ${row.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {row.margin.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
                {profitabilityData.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-20 text-center text-slate-400 italic">
                      No sales data found for the selected period.
                    </td>
                  </tr>
                )}
              </tbody>
              {profitabilityData.length > 0 && (
                <tfoot className="bg-slate-900 text-white font-bold">
                  <tr>
                    <td colSpan={3} className="px-6 py-4 uppercase text-xs tracking-widest">Grand Total</td>
                    <td className="px-6 py-4 text-right">₹{totals.sales.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right">₹{totals.cogs.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-emerald-400">₹{totals.profit.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-emerald-400">
                      {totals.sales > 0 ? ((totals.profit / totals.sales) * 100).toFixed(1) : 0}%
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex items-start gap-4 print:hidden">
        <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
          <Calendar size={18} />
        </div>
        <div>
          <h4 className="text-sm font-bold text-amber-900 mb-1">Calculation Method Notice</h4>
          <p className="text-xs text-amber-700 leading-relaxed">
            Profits are calculated using <strong>Revenue - (Qty Sold × Master Purchase Price)</strong>. 
            This assumes a static cost per item based on your current Item Master settings. For FIFO or Average Costing, ensure your purchase prices are updated in the Item Master regularly.
          </p>
        </div>
      </div>
    </div>
  );
};
