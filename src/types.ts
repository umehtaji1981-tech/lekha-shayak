
export type UserRole = 'Admin' | 'Sales' | 'Accountant';

export interface UserAssignment {
  companyId: string;
  role: UserRole;
  companyName: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  globalRole?: 'SuperAdmin'; // Add if needed, but for now standard users
  assignments: UserAssignment[];
  companyIds: string[]; // For fast rule checks
}

export const PERMISSIONS = {
  Admin: ['*'], // All pages
  Accountant: [
    'dashboard', 
    'sales', 
    'purchases', 
    'receipts', 
    'payments', 
    'contra', 
    'credit-note', 
    'debit-note', 
    'journal', 
    'inventory', 
    'ledgers', 
    'units', 
    'cost-centres',
    'reports', 
    'gst-reports', 
    'financial-reports', 
    'stock-summary', 
    'bank-reconciliation', 
    'settings', 
    'rollover',
    'sales_reg',
    'pur_reg',
    'cn_reg',
    'dn_reg',
    'contra_reg',
    'journal_reg',
    'receipt_reg',
    'payment_reg',
    'gstr1',
    'gstr3b',
    'eway-bill-validator'
  ],
  Sales: [
    'dashboard',
    'sales',
    'purchases',
    'inventory',
    'ledgers',
    'units',
    'cost-centres',
    'new-sale',
    'new-purchase',
    'reports',
    'gst-reports',
    'financial-reports',
    'stock-summary',
    'sales_reg',
    'pur_reg',
    'cn_reg',
    'dn_reg',
    'contra_reg',
    'journal_reg',
    'receipt_reg',
    'payment_reg',
    'stock',
    'gstr1',
    'eway-bill-validator'
  ]
};
