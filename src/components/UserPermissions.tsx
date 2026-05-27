
import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Trash2, Shield, Building2, Mail } from 'lucide-react';
import { dbService } from '../lib/db';
import { collection, query, where, getDocs, doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { UserRole, UserProfile, UserAssignment } from '../types';

interface UserPermissionsProps {
  activeCompany: any;
  currentUserProfile: UserProfile | null;
}

export const UserPermissions = ({ activeCompany, currentUserProfile }: UserPermissionsProps) => {
  const [assignedUsers, setAssignedUsers] = useState<UserProfile[]>([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('Sales');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = activeCompany.ownerId === currentUserProfile?.uid;

  useEffect(() => {
    const fetchAssignedUsers = async () => {
      setLoading(true);
      try {
        // Find users who have an assignment for this company
        // Firestore doesn't support array-of-objects contains directly easily, 
        // so we might need to search or change schema.
        // For this demo, let's just fetch all users and filter locally OR 
        // fetch users where email matches if we invited them.
        
        // Better: We should have a collection of assignments for the company too? 
        // Or just scan users (not scalable but works for small teams).
        const usersSnap = await getDocs(collection(db, 'users'));
        const users = usersSnap.docs.map(d => ({ 
          ...d.data(), 
          uid: d.id // Ensure uid is always correctly mapped from doc ID
        } as UserProfile))
          .filter(u => u.assignments?.some(a => a.companyId === activeCompany.id));
        
        setAssignedUsers(users);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchAssignedUsers();
  }, [activeCompany.id]);

  const handleAddUser = async () => {
    if (!newUserEmail) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Find user by email
      const q = query(collection(db, 'users'), where('email', '==', newUserEmail));
      const snap = await getDocs(q);
      
      if (snap.empty) {
        setError("User with this email not found. They must sign in once first.");
        setLoading(false);
        return;
      }

      const targetUser = snap.docs[0].data() as UserProfile;
      const targetUid = snap.docs[0].id;

      // 2. Add assignment
      const newAssignment: UserAssignment = {
        companyId: activeCompany.id,
        companyName: activeCompany.name,
        role: newUserRole
      };

      await updateDoc(doc(db, 'users', targetUid), {
        assignments: arrayUnion(newAssignment),
        companyIds: arrayUnion(activeCompany.id)
      });

      // Update local state
      setAssignedUsers(prev => {
        const exists = prev.find(u => u.uid === targetUid);
        if (exists) {
          return prev.map(u => u.uid === targetUid ? { ...u, assignments: [...(u.assignments || []), newAssignment] } : u);
        }
        return [...prev, { ...targetUser, assignments: [newAssignment] }];
      });

      setNewUserEmail('');
      alert(`User ${newUserEmail} added successfully as ${newUserRole}`);
    } catch (err) {
      setError("Failed to add user.");
    } finally {
      setLoading(false);
    }
  };

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleRemoveUser = async (targetUid: string) => {
    setLoading(true);
    setConfirmDelete(null);
    try {
      const targetUser = assignedUsers.find(u => u.uid === targetUid);
      if (!targetUser) {
        setError("User not found in local state.");
        setLoading(false);
        return;
      }

      // Filter out this company's assignment
      const updatedAssignments = (targetUser.assignments || []).filter(a => a.companyId !== activeCompany.id);
      const updatedCompanyIds = (targetUser.companyIds || []).filter(id => id !== activeCompany.id);

      await updateDoc(doc(db, 'users', targetUid), {
        assignments: updatedAssignments,
        companyIds: updatedCompanyIds
      });

      setAssignedUsers(prev => prev.filter(u => u.uid !== targetUid));
    } catch (err: any) {
      console.error("Removal error:", err);
      setError("Failed to remove user: " + (err.message || "Unknown error"));
    } finally {
      setLoading(false);
    }
  };

  if (!isOwner) {
    return (
      <div className="card p-12 text-center">
        <Shield size={48} className="mx-auto text-slate-300 mb-4" />
        <h3 className="text-xl font-bold">Access Restricted</h3>
        <p className="text-slate-500">Only the company owner can manage user permissions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <Users size={20} />
          </div>
          <div>
            <h3 className="font-bold text-lg">Team Management</h3>
            <p className="text-xs text-slate-500">Assign roles to team members for {activeCompany.name}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 bg-slate-50 p-4 rounded-2xl">
          <div className="space-y-1">
            <label className="label text-[10px] uppercase tracking-widest font-black">User Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input 
                className="input-field pl-9 py-2" 
                placeholder="colleague@example.com" 
                value={newUserEmail}
                onChange={e => setNewUserEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
             <label className="label text-[10px] uppercase tracking-widest font-black">Role</label>
             <select 
              className="input-field py-2"
              value={newUserRole}
              onChange={e => setNewUserRole(e.target.value as UserRole)}
             >
               <option value="Sales">Sales</option>
               <option value="Accountant">Accountant</option>
               <option value="Admin">Admin</option>
             </select>
          </div>
          <div className="flex items-end">
            <button 
              onClick={handleAddUser}
              disabled={loading || !newUserEmail}
              className="btn-primary w-full h-[40px] flex items-center justify-center gap-2"
            >
              <UserPlus size={16} /> Add Member
            </button>
          </div>
        </div>

        {error && <p className="text-red-500 text-xs mb-4 p-3 bg-red-50 rounded-lg">{error}</p>}

        <div className="space-y-3">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Active Members</h4>
          {assignedUsers.length === 0 ? (
            <div className="text-center py-8 text-slate-400 italic text-sm">No external team members added yet.</div>
          ) : (
            assignedUsers.map(u => (
              <div key={u.uid} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:border-indigo-100 transition-all">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-bold">
                    {u.name?.[0] || u.email[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">{u.name || 'User'}</p>
                    <p className="text-xs text-slate-500">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      u.assignments.find(a => a.companyId === activeCompany.id)?.role === 'Admin' ? 'bg-red-50 text-red-600' :
                      u.assignments.find(a => a.companyId === activeCompany.id)?.role === 'Accountant' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      {u.assignments.find(a => a.companyId === activeCompany.id)?.role}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {confirmDelete === u.uid ? (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleRemoveUser(u.uid)}
                          className="text-[10px] font-black uppercase tracking-tighter bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700"
                        >
                          Confirm
                        </button>
                        <button 
                          onClick={() => setConfirmDelete(null)}
                          className="text-[10px] font-black uppercase tracking-tighter bg-slate-100 text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setConfirmDelete(u.uid)}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card p-6 bg-indigo-900 text-white border-none relative overflow-hidden">
        <div className="relative z-10">
          <h3 className="font-bold flex items-center gap-2 mb-2"><Shield size={18} /> Role Permissions Overview</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-6">
            <div className="space-y-2">
              <div className="text-xs font-black text-indigo-300 uppercase tracking-widest">Sales</div>
              <ul className="text-xs space-y-1.5 opacity-80">
                <li>• View Dashboard</li>
                <li>• Create Sales/Purchase Invoices</li>
                <li>• View Customer Ledgers</li>
                <li>• Inventory Stock Check</li>
              </ul>
            </div>
            <div className="space-y-2 border-x border-white/10 px-8">
              <div className="text-xs font-black text-indigo-300 uppercase tracking-widest">Accountant</div>
              <ul className="text-xs space-y-1.5 opacity-80">
                <li>• All Sales features</li>
                <li>• All Financial Reports</li>
                <li>• GST Filing & Reports</li>
                <li>• Bank Reconciliation</li>
                <li>• Vouchers & Journals</li>
              </ul>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-black text-indigo-300 uppercase tracking-widest">Admin</div>
              <ul className="text-xs space-y-1.5 opacity-80">
                <li>• Everything in Lekha Sahayak</li>
                <li>• System Settings</li>
                <li>• User Management</li>
                <li>• Company Data Clear</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 p-8 opacity-10">
           <Building2 size={120} />
        </div>
      </div>
    </div>
  );
};
