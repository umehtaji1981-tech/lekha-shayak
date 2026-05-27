import React, { useState } from 'react';
import { ShieldCheck, Info } from 'lucide-react';

interface GSTR3BNatureViewProps {
  company: any;
  reportPeriod: any;
  natureCalculation: any;
  natureTree: any;
  expandedNodes: { [key: string]: boolean };
  toggleNode: (nodeName: string) => void;
  formatIndianCurrency: (num: number) => string;
  formatDateInShort: (dateStr: string) => string;
}

export const GSTR3BNatureView: React.FC<GSTR3BNatureViewProps> = ({
  company,
  reportPeriod,
  natureCalculation,
  natureTree,
  expandedNodes,
  toggleNode,
  formatIndianCurrency,
  formatDateInShort
}) => {
  const renderLedgerRow = (
    label: string,
    vals: { taxable: number; igst: number; cgst: number; sgst: number; cess?: number; tax: number },
    indentation: number = 0,
    isBold: boolean = false,
    onToggle?: () => void,
    isExpanded: boolean = true,
    isFolder: boolean = false
  ) => {
    const valStr = (val: number | undefined) => {
      if (val === undefined || Math.abs(val) < 0.01) return '—';
      return formatIndianCurrency(val);
    };

    return (
      <tr 
        onClick={onToggle}
        className={`hover:bg-slate-50 transition-all cursor-pointer border-b border-slate-100/50 ${isFolder ? 'font-semibold text-slate-900 bg-slate-50/20' : 'text-slate-700'} ${isBold ? 'font-bold' : ''}`}
      >
        <td className="py-2.5 px-3 flex items-center min-w-0" style={{ paddingLeft: `${indentation * 16 + 12}px` }}>
          {isFolder && (
            <span className="mr-1.5 text-[9px] text-slate-500 shrink-0 select-none">
              {isExpanded ? '▼' : '▶'}
            </span>
          )}
          <span className="truncate">{label}</span>
        </td>
        <td className="py-2.5 px-3 text-right font-mono text-[11px]">{valStr(vals.taxable)}</td>
        <td className="py-2.5 px-3 text-right font-mono text-[11px]">{valStr(vals.igst)}</td>
        <td className="py-2.5 px-3 text-right font-mono text-[11px]">{valStr(vals.cgst)}</td>
        <td className="py-2.5 px-3 text-right font-mono text-[11px]">{valStr(vals.sgst)}</td>
        <td className="py-2.5 px-3 text-right font-mono text-[11px]">{valStr(vals.cess || 0)}</td>
        <td className={`py-2.5 px-3 text-right font-mono text-[11px] ${isBold ? 'text-indigo-700 font-extrabold' : 'text-slate-900 font-medium'}`}>
          {valStr(vals.tax)}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-8 font-sans max-w-full">
      {/* Tally Invoice Styled Header Layout */}
      <div className="border border-slate-300 p-6 rounded-xl bg-white space-y-4">
        <div className="text-center space-y-1 mb-2">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{company?.name || 'Goodluck Traders'}</h1>
          <p className="text-[11px] text-slate-500 whitespace-pre-line leading-relaxed">{company?.address || 'Near Rajpura Gate\nRastipura Burhanpur'}</p>
          <p className="text-[11px] text-slate-500">
            Contact : {company?.phone || '8871995348'} | Email : {company?.email || 'goodlucktraders@gmail.com'}
          </p>
          <div className="pt-2">
            <span className="px-3 py-1 bg-slate-100 uppercase text-[10px] tracking-widest font-black text-slate-700 border border-slate-200 rounded">
              GSTR-3B Return (Nature view style)
            </span>
          </div>
          <p className="text-[11px] font-bold text-indigo-600 mt-2 bg-indigo-50/50 inline-block px-3 py-1 rounded-full">
            Period: {formatDateInShort(reportPeriod.startDate)} to {formatDateInShort(reportPeriod.endDate)}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
          <div className="text-[11px] space-y-1.5 text-slate-600">
            <div><strong className="text-slate-800">GST Registration:</strong> <span className="font-mono bg-slate-50 px-1 py-0.5 border border-slate-150 rounded">{company?.gstIn || '23AMIPB4686M1ZS'}</span></div>
            <div><strong className="text-slate-800">Filer Status:</strong> <span className="font-semibold text-amber-600">Computation Draft</span></div>
            <div><strong className="text-slate-800">Last activity:</strong> {new Date().toLocaleString()}</div>
          </div>

          {/* Vouchers Count Summary Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden divide-y divide-slate-100 text-xs">
            <div className="grid grid-cols-2 bg-slate-50 p-2 font-bold text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <span>Particulars</span>
              <span className="text-right">Voucher Count</span>
            </div>
            <div className="grid grid-cols-2 p-2 bg-white">
              <span className="font-semibold text-slate-800">Total Vouchers</span>
              <span className="text-right font-bold text-slate-900">{natureCalculation.vouchers.total}</span>
            </div>
            <div className="grid grid-cols-2 p-2 pl-4 text-[11px] text-slate-600 bg-white">
              <span>Included in Return</span>
              <span className="text-right font-medium text-slate-800">{natureCalculation.vouchers.included}</span>
            </div>
            <div className="grid grid-cols-2 p-2 pl-4 text-[11px] text-slate-600 bg-white">
              <span>Not Relevant for This Return</span>
              <span className="text-right font-medium text-slate-800">{natureCalculation.vouchers.notRelevant}</span>
            </div>
            <div className="grid grid-cols-2 p-2 pl-4 text-[11px] text-slate-600 bg-white">
              <span>Uncertain Transactions</span>
              <span className="text-right text-amber-600 font-bold">{natureCalculation.vouchers.uncertain}</span>
            </div>
            <div className="grid grid-cols-2 p-2 pl-4 text-[11px] text-slate-600 bg-white">
              <span>Vouchers having conflicts</span>
              <span className="text-right text-rose-600 font-bold">{natureCalculation.vouchers.conflicts}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Nature View Main Ledger Grid Table */}
      <div className="border border-slate-300 rounded-xl overflow-hidden bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white font-bold text-[10px] uppercase tracking-wider">
                <th className="py-3 px-3 w-[35%]">Particulars</th>
                <th className="py-3 px-3 text-right">Taxable Amount</th>
                <th className="py-3 px-3 text-right">IGST</th>
                <th className="py-3 px-3 text-right">CGST</th>
                <th className="py-3 px-3 text-right">SGST/UTGST</th>
                <th className="py-3 px-3 text-right">Cess</th>
                <th className="py-3 px-3 text-right">Tax Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-sans text-xs">
              <tr className="bg-slate-100/80 font-black text-[10px] text-slate-700 uppercase tracking-wider">
                <td colSpan={7} className="py-2.5 px-3 text-slate-800">Liability (Outward & Inward Reverse Charge)</td>
              </tr>

              {/* Outward Supplies Folder */}
              {renderLedgerRow('Outward Supplies', natureTree.outwardTotal, 1, true, () => toggleNode('outward'), expandedNodes.outward, true)}
              {expandedNodes.outward && (
                <>
                  {renderLedgerRow('Local Supplies', natureTree.localSalesTotal, 2, true, () => toggleNode('localSales'), expandedNodes.localSales, true)}
                  {expandedNodes.localSales && (
                    <>
                      {renderLedgerRow('Taxable', natureTree.localSalesTotal, 3, true, () => toggleNode('localRegSales'), expandedNodes.localRegSales, true)}
                      {expandedNodes.localRegSales && (
                        <>
                          {renderLedgerRow('Registered Dealer Supplies', natureTree.lrTotal, 4, true, () => toggleNode('localRegSalesTaxable'), expandedNodes.localRegSalesTaxable, true)}
                          {expandedNodes.localRegSalesTaxable && (
                            <>
                              {renderLedgerRow('Non-Reverse Charge', natureTree.lrTotal, 5, false, undefined, true, false)}
                              {renderLedgerRow('Sales Taxable', natureTree.lrTotal, 6, false, () => toggleNode('localRegSalesTaxableRates'), expandedNodes.localRegSalesTaxableRates, true)}
                              {expandedNodes.localRegSalesTaxableRates && (
                                <>
                                  {renderLedgerRow('5 %', natureTree.lr_5, 7, false)}
                                  {renderLedgerRow('12 %', natureTree.lr_12, 7, false)}
                                  {renderLedgerRow('18 %', natureTree.lr_18, 7, false)}
                                  {renderLedgerRow('28 %', natureTree.lr_28, 7, false)}
                                </>
                              )}
                            </>
                          )}

                          {renderLedgerRow('Consumer Supplies', natureTree.lcTotal, 4, true, () => toggleNode('localConsSales'), expandedNodes.localConsSales, true)}
                          {expandedNodes.localConsSales && (
                            <>
                              {renderLedgerRow('Sales Taxable', natureTree.lcTotal, 5, false, () => toggleNode('localConsSalesTaxable'), expandedNodes.localConsSalesTaxable, true)}
                              {expandedNodes.localConsSalesTaxable && (
                                <>
                                  {renderLedgerRow('5 %', natureTree.lc_5, 6, false)}
                                  {renderLedgerRow('12 %', natureTree.lc_12, 6, false)}
                                  {renderLedgerRow('18 %', natureTree.lc_18, 6, false)}
                                  {renderLedgerRow('28 %', natureTree.lc_28, 6, false)}
                                </>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {renderLedgerRow('Interstate Supplies', natureTree.interSalesTotal, 2, true, () => toggleNode('interSales'), expandedNodes.interSales, true)}
                  {expandedNodes.interSales && (
                    <>
                      {renderLedgerRow('Taxable', natureTree.interSalesTotal, 3, true, () => toggleNode('interSalesTaxable'), expandedNodes.interSalesTaxable, true)}
                      {expandedNodes.interSalesTaxable && (
                        <>
                          {renderLedgerRow('Registered Dealer Supplies', natureTree.irTotal, 4, true, () => toggleNode('interRegSales'), expandedNodes.interRegSales, true)}
                          {expandedNodes.interRegSales && (
                            <>
                              {renderLedgerRow('Non-Reverse Charge', natureTree.irTotal, 5, false, undefined, true, false)}
                              {renderLedgerRow('Sales Taxable', natureTree.irTotal, 6, false, () => toggleNode('interRegSalesTaxable'), expandedNodes.interRegSalesTaxable, true)}
                              {expandedNodes.interRegSalesTaxable && (
                                <>
                                  {renderLedgerRow('5 %', natureTree.ir_5, 7, false)}
                                  {renderLedgerRow('12 %', natureTree.ir_12, 7, false)}
                                  {renderLedgerRow('18 %', natureTree.ir_18, 7, false)}
                                  {renderLedgerRow('28 %', natureTree.ir_28, 7, false)}
                                </>
                              )}
                            </>
                          )}

                          {renderLedgerRow('Consumer Supplies', natureTree.icTotal, 4, true, () => toggleNode('interConsSales'), expandedNodes.interConsSales, true)}
                          {expandedNodes.interConsSales && (
                            <>
                              {renderLedgerRow('Sales Taxable', natureTree.icTotal, 5, false, () => toggleNode('interConsSalesTaxable'), expandedNodes.interConsSalesTaxable, true)}
                              {expandedNodes.interConsSalesTaxable && (
                                <>
                                  {renderLedgerRow('5 %', natureTree.ic_5, 6, false)}
                                  {renderLedgerRow('12 %', natureTree.ic_12, 6, false)}
                                  {renderLedgerRow('18 %', natureTree.ic_18, 6, false)}
                                  {renderLedgerRow('28 %', natureTree.ic_28, 6, false)}
                                </>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Inward Reverse Charge Supplies */}
              {renderLedgerRow('Inward Reverse Charge Supplies', natureTree.inwardRcTotal, 1, true, () => toggleNode('rcm'), expandedNodes.rcm, true)}
              {expandedNodes.rcm && (
                <>
                  {renderLedgerRow('Local Supplies', natureTree.rcLocalTotal, 2, true, () => toggleNode('rcmLocal'), expandedNodes.rcmLocal, true)}
                  {expandedNodes.rcmLocal && (
                    <>
                      {renderLedgerRow('Purchase Taxable', natureTree.rcLocalTotal, 3, false, () => toggleNode('rcmLocalPurchases'), expandedNodes.rcmLocalPurchases, true)}
                      {expandedNodes.rcmLocalPurchases && (
                        <>
                          {renderLedgerRow('5 %', natureTree.rcLocal_5, 4, false)}
                          {renderLedgerRow('12 %', natureTree.rcLocal_12, 4, false)}
                          {renderLedgerRow('18 %', natureTree.rcLocal_18, 4, false)}
                          {renderLedgerRow('28 %', natureTree.rcLocal_28, 4, false)}
                        </>
                      )}
                    </>
                  )}

                  {renderLedgerRow('Interstate Supplies', natureTree.rcInterTotal, 2, true, () => toggleNode('rcmInter'), expandedNodes.rcmInter, true)}
                  {expandedNodes.rcmInter && (
                    <>
                      {renderLedgerRow('Purchase Taxable', natureTree.rcInterTotal, 3, false, () => toggleNode('rcmInterPurchases'), expandedNodes.rcmInterPurchases, true)}
                      {expandedNodes.rcmInterPurchases && (
                        <>
                          {renderLedgerRow('5 %', natureTree.rcInter_5, 4, false)}
                          {renderLedgerRow('12 %', natureTree.rcInter_12, 4, false)}
                          {renderLedgerRow('18 %', natureTree.rcInter_18, 4, false)}
                          {renderLedgerRow('28 %', natureTree.rcInter_28, 4, false)}
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Tax Liability summaries with authentic double-borders style */}
              <tr className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-400">
                <td className="py-2.5 px-3 pl-8">Liability from Outward Supplies</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.outwardTotal.taxable)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.outwardTotal.igst)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.outwardTotal.cgst)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.outwardTotal.sgst)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">—</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.outwardTotal.tax)}</td>
              </tr>

              <tr className="bg-slate-100 font-bold text-slate-800 border-t border-slate-300">
                <td className="py-2.5 px-3 pl-8">Tax Liability from Inward Supplies</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.inwardRcTotal.taxable)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.inwardRcTotal.igst)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.inwardRcTotal.cgst)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.inwardRcTotal.sgst)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">—</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.inwardRcTotal.tax)}</td>
              </tr>

              <tr className="bg-indigo-50 font-black text-slate-900 border-t-2 border-b-[4px] border-double border-slate-800">
                <td className="py-3 px-3">Total Tax Liability</td>
                <td className="py-3 px-3 text-right font-mono text-xs">{formatIndianCurrency(natureTree.totalTaxLiability.taxable)}</td>
                <td className="py-3 px-3 text-right font-mono text-xs text-indigo-700">{formatIndianCurrency(natureTree.totalTaxLiability.igst)}</td>
                <td className="py-3 px-3 text-right font-mono text-xs text-indigo-700">{formatIndianCurrency(natureTree.totalTaxLiability.cgst)}</td>
                <td className="py-3 px-3 text-right font-mono text-xs text-indigo-700">{formatIndianCurrency(natureTree.totalTaxLiability.sgst)}</td>
                <td className="py-3 px-3 text-right font-mono text-xs">—</td>
                <td className="py-3 px-3 text-right font-mono text-xs text-indigo-800 font-black">{formatIndianCurrency(natureTree.totalTaxLiability.tax)}</td>
              </tr>

              {/* INPUT TAX CREDIT (ITC) PAGE */}
              <tr className="bg-slate-800 text-white font-black text-[10px] text-slate-100 uppercase tracking-wider">
                <td colSpan={7} className="py-3 px-3">Input Tax Credit (ITC Eligible ledger)</td>
              </tr>

              {/* Local Supplies ITC */}
              {renderLedgerRow('Local Supplies', natureTree.itcLocalTotal, 1, true, () => toggleNode('itcLocal'), expandedNodes.itcLocal, true)}
              {expandedNodes.itcLocal && (
                <>
                  {renderLedgerRow('Taxable', natureTree.itcLocalTotal, 2, true, undefined, true, false)}
                  {renderLedgerRow('Registered Dealer Supplies', natureTree.itclrTotal, 3, true, () => toggleNode('itcLocalReg'), expandedNodes.itcLocalReg, true)}
                  {expandedNodes.itcLocalReg && (
                    <>
                      {renderLedgerRow('Non-Reverse Charge', natureTree.itclrTotal, 4, false, undefined, true, false)}
                      {renderLedgerRow('Purchase Taxable', natureTree.itclrTotal, 5, false, () => toggleNode('itcLocalRegPurch'), expandedNodes.itcLocalRegPurch, true)}
                      {expandedNodes.itcLocalRegPurch && (
                        <>
                          {renderLedgerRow('5 %', natureTree.itclr_5, 6, false)}
                          {renderLedgerRow('12 %', natureTree.itclr_12, 6, false)}
                          {renderLedgerRow('18 %', natureTree.itclr_18, 6, false)}
                          {renderLedgerRow('28 %', natureTree.itclr_28, 6, false)}
                        </>
                      )}
                    </>
                  )}

                  {renderLedgerRow('Unregistered Supplies', natureTree.itcluTotal, 3, true, () => toggleNode('itcLocalUnreg'), expandedNodes.itcLocalUnreg, true)}
                  {expandedNodes.itcLocalUnreg && (
                    <>
                      {renderLedgerRow('Reverse Charge', natureTree.itcluTotal, 4, false, undefined, true, false)}
                      {renderLedgerRow('Purchase Taxable', natureTree.itcluTotal, 5, false, () => toggleNode('itcLocalUnregPurch'), expandedNodes.itcLocalUnregPurch, true)}
                      {expandedNodes.itcLocalUnregPurch && (
                        <>
                          {renderLedgerRow('5 %', natureTree.itclu_5, 6, false)}
                          {renderLedgerRow('12 %', natureTree.itclu_12, 6, false)}
                          {renderLedgerRow('18 %', natureTree.itclu_18, 6, false)}
                          {renderLedgerRow('28 %', natureTree.itclu_28, 6, false)}
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Interstate Supplies ITC */}
              {renderLedgerRow('Interstate Supplies', natureTree.itcInterTotal, 1, true, () => toggleNode('itcInter'), expandedNodes.itcInter, true)}
              {expandedNodes.itcInter && (
                <>
                  {renderLedgerRow('Taxable', natureTree.itcInterTotal, 2, true, undefined, true, false)}
                  {renderLedgerRow('Registered Dealer Supplies', natureTree.itcInterTotal, 3, true, () => toggleNode('itcInterReg'), expandedNodes.itcInterReg, true)}
                  {expandedNodes.itcInterReg && (
                    <>
                      {renderLedgerRow('Non-Reverse Charge', natureTree.itcInterTotal, 4, false, undefined, true, false)}
                      {renderLedgerRow('Purchase Taxable', natureTree.itcInterTotal, 5, false, () => toggleNode('itcInterRegPurch'), expandedNodes.itcInterRegPurch, true)}
                      {expandedNodes.itcInterRegPurch && (
                        <>
                          {renderLedgerRow('5 %', natureTree.itcir_5, 6, false)}
                          {renderLedgerRow('12 %', natureTree.itcir_12, 6, false)}
                          {renderLedgerRow('18 %', natureTree.itcir_18, 6, false)}
                          {renderLedgerRow('28 %', natureTree.itcir_28, 6, false)}
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ITC summaries with authentic borders style */}
              <tr className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-400">
                <td className="py-2.5 px-3">Total ITC</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.itcTotalRaw.taxable)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.itcTotalRaw.igst)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.itcTotalRaw.cgst)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.itcTotalRaw.sgst)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">—</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">{formatIndianCurrency(natureTree.itcTotalRaw.tax)}</td>
              </tr>

              <tr className="bg-slate-150 font-bold text-rose-600 border-t border-slate-300">
                <td className="py-2.5 px-3">Less: Ineligible for Input Tax Credit</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">({formatIndianCurrency(natureTree.lessIneligible.taxable)})</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">—</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">({formatIndianCurrency(natureTree.lessIneligible.cgst)})</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">({formatIndianCurrency(natureTree.lessIneligible.sgst)})</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">—</td>
                <td className="py-2.5 px-3 text-right font-mono text-[11px]">({formatIndianCurrency(natureTree.lessIneligible.tax)})</td>
              </tr>

              <tr className="bg-emerald-50 font-black text-slate-900 border-t-2 border-b-[4px] border-double border-slate-800">
                <td className="py-3 px-3">Eligible for Input Tax Credit (Net ITC)</td>
                <td className="py-3 px-3 text-right font-mono text-xs">{formatIndianCurrency(natureTree.eligibleItc.taxable)}</td>
                <td className="py-3 px-3 text-right font-mono text-xs text-emerald-700">{formatIndianCurrency(natureTree.eligibleItc.igst)}</td>
                <td className="py-3 px-3 text-right font-mono text-xs text-emerald-700">{formatIndianCurrency(natureTree.eligibleItc.cgst)}</td>
                <td className="py-3 px-3 text-right font-mono text-xs text-emerald-700">{formatIndianCurrency(natureTree.eligibleItc.sgst)}</td>
                <td className="py-3 px-3 text-right font-mono text-xs">—</td>
                <td className="py-3 px-3 text-right font-mono text-xs text-emerald-800 font-extrabold">{formatIndianCurrency(natureTree.eligibleItc.tax)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 p-4 font-sans text-xs text-amber-950 rounded-xl leading-relaxed flex items-start gap-3">
        <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <strong className="font-bold text-amber-900 block">Filing Advisory Notes</strong>
          <p>
            The values calculated above represent the exact <strong>Nature of Supply</strong> as registered in Lekha Sahayak books of accounts.
            Toggle categories with <strong>▼/▶</strong> folder prefixes to inspect individual transaction groups and rates. Use this view to audit potential mismatch flags before final submission on GSTR portal.
          </p>
        </div>
      </div>
    </div>
  );
};
