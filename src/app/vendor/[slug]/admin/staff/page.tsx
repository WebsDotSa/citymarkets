"use client";

import { useEffect, useState, use } from "react";
import { useConfirm } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import {
  Users,
  Plus,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Eye,
  UserCog,
  Trash2,
  Power,
  PowerOff,
  Mail,
  Clock,
} from "lucide-react";

interface StaffPageProps {
  params: Promise<{ slug: string }>;
}

interface StaffMember {
  id: string;
  email: string;
  fullNameAr: string | null;
  fullNameEn: string | null;
  role: "owner" | "manager" | "staff" | "viewer";
  permissions: string[];
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface CurrentUser {
  role: "owner" | "manager" | "staff" | "viewer";
  staffId: string;
}

type ModalState =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; staff: StaffMember };

const ROLE_LABELS: Record<StaffMember["role"], { label: string; icon: any; color: string }> = {
  owner: { label: "مالك", icon: ShieldCheck, color: "text-emerald-600 bg-emerald-50" },
  manager: { label: "مدير", icon: ShieldCheck, color: "text-blue-600 bg-blue-50" },
  staff: { label: "موظف", icon: UserCog, color: "text-amber-600 bg-amber-50" },
  viewer: { label: "مشاهد", icon: Eye, color: "text-gray-600 bg-gray-50" },
};

const inputClass =
  "w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none text-sm";

export default function VendorStaffPage({ params }: StaffPageProps) {
  use(params);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [submitting, setSubmitting] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      // Fetch staff list AND the current session in parallel so we
      // can disable buttons appropriately (manager can't add another
      // manager, owner-only delete, etc.).
      const [staffRes, meRes] = await Promise.all([
        fetch("/api/v1/vendor/staff", { credentials: "include" }),
        fetch("/api/v1/vendor/auth/me", { credentials: "include" }),
      ]);

      if (staffRes.ok) {
        const data = await staffRes.json();
        setStaff(data.staff || []);
      }
      if (meRes.ok) {
        const me = await meRes.json();
        if (me?.user) {
          setCurrentUser({
            role: me.user.role,
            staffId: me.user.id,
          });
        }
      }
    } finally {
      setLoading(false);
    }
  }

  const canAddManager = currentUser?.role === "owner";
  const canDelete = currentUser?.role === "owner";

  async function toggleActive(s: StaffMember) {
    const action = s.isActive ? "إيقاف" : "تفعيل";
    if (
      !(await confirm({
        title: `${action} الموظف`,
        message: `${action} دخول "${s.email}"؟${
          s.isActive ? " سيتم إلغاء جلسته الحالية." : ""
        }`,
      }))
    )
      return;
    const res = await csrfFetch(`/api/v1/vendor/staff/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !s.isActive }),
      credentials: "include",
    }).then((r) => r.json());
    if (res.success) {
      setStaff((list) =>
        list.map((x) => (x.id === s.id ? { ...x, isActive: !x.isActive } : x)),
      );
    } else {
      await confirm({
        title: "فشلت العملية",
        message: res.error || "حاول مرة أخرى",
      });
    }
  }

  async function deleteStaff(s: StaffMember) {
    if (
      !(await confirm({
        title: "حذف الموظف",
        message: `حذف "${s.email}" نهائياً من المتجر؟ لا يمكن التراجع.`,
        danger: true,
      }))
    )
      return;
    const res = await csrfFetch(`/api/v1/vendor/staff/${s.id}`, {
      method: "DELETE",
      credentials: "include",
    }).then((r) => r.json());
    if (res.success) {
      setStaff((list) => list.filter((x) => x.id !== s.id));
    } else {
      await confirm({
        title: "فشل الحذف",
        message: res.error || "حاول مرة أخرى",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">الموظفون</h1>
          <p className="text-gray-500">
            إدارة صلاحيات دخول فريقك للوحة تحكم المتجر
          </p>
        </div>
        <button
          onClick={() => setModal({ kind: "create" })}
          className="px-4 py-2 bg-primary text-white rounded-xl font-medium hover:bg-primary/90 transition flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          إضافة موظف
        </button>
      </div>

      {/* Role legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(["owner", "manager", "staff", "viewer"] as const).map((role) => {
          const meta = ROLE_LABELS[role];
          const Icon = meta.icon;
          return (
            <div
              key={role}
              className="bg-white rounded-xl p-3 flex items-center gap-3"
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${meta.color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-gray-500">{role}</p>
                <p className="text-sm font-semibold text-gray-900">{meta.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl overflow-hidden">
        {loading ? (
          <div className="divide-y">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gray-100 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 bg-gray-100 rounded animate-pulse" />
                  <div className="h-3 w-24 bg-gray-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : staff.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 mb-1">لا يوجد موظفون بعد</p>
            <p className="text-sm text-gray-400">أضف أول موظف ليبدأ العمل</p>
          </div>
        ) : (
          <div className="divide-y">
            {staff.map((s) => {
              const meta = ROLE_LABELS[s.role];
              const Icon = meta.icon;
              const isSelf = s.id === currentUser?.staffId;
              return (
                <div
                  key={s.id}
                  className="p-4 flex items-center gap-4 hover:bg-gray-50/50"
                >
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${meta.color}`}
                  >
                    <Icon className="w-6 h-6" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900 truncate">
                        {s.fullNameAr || s.fullNameEn || s.email}
                      </p>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${meta.color}`}
                      >
                        {meta.label}
                      </span>
                      {isSelf && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                          أنت
                        </span>
                      )}
                      {!s.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500">
                          موقوف
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5 flex items-center gap-1.5">
                      <Mail className="w-3 h-3" />
                      <span className="truncate" dir="ltr">{s.email}</span>
                    </p>
                    {s.lastLoginAt && (
                      <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        آخر دخول:{" "}
                        {new Date(s.lastLoginAt).toLocaleString("ar-SA")}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {/* Don't let a manager suspend/demote an owner —
                        owners are protected from non-owners. */}
                    {s.role !== "owner" || currentUser?.role === "owner" ? (
                      <>
                        <button
                          onClick={() => toggleActive(s)}
                          disabled={isSelf}
                          className="p-2 rounded-lg hover:bg-gray-100 transition disabled:opacity-30 disabled:cursor-not-allowed"
                          title={s.isActive ? "إيقاف الدخول" : "تفعيل الدخول"}
                        >
                          {s.isActive ? (
                            <PowerOff className="w-4 h-4 text-amber-600" />
                          ) : (
                            <Power className="w-4 h-4 text-emerald-600" />
                          )}
                        </button>
                        <button
                          onClick={() => setModal({ kind: "edit", staff: s })}
                          disabled={isSelf}
                          className="px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100 transition text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="تعديل"
                        >
                          تعديل
                        </button>
                        {canDelete && !isSelf && (
                          <button
                            onClick={() => deleteStaff(s)}
                            className="p-2 rounded-lg hover:bg-red-50 transition text-red-600"
                            title="حذف"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modal.kind !== "closed" && (
        <StaffModal
          state={modal}
          submitting={submitting}
          currentUser={currentUser}
          canPromoteToManager={canAddManager}
          onClose={() => setModal({ kind: "closed" })}
          onSaved={async () => {
            setModal({ kind: "closed" });
            await load();
          }}
          onSubmittingChange={setSubmitting}
        />
      )}

      {confirm.dialog}
    </div>
  );
}

function StaffModal({
  state,
  submitting,
  currentUser,
  canPromoteToManager,
  onClose,
  onSaved,
  onSubmittingChange,
}: {
  state: { kind: "create" } | { kind: "edit"; staff: StaffMember };
  submitting: boolean;
  currentUser: CurrentUser | null;
  canPromoteToManager: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onSubmittingChange: (v: boolean) => void;
}) {
  const editing = state.kind === "edit";
  const target = editing ? state.staff : null;

  const [email, setEmail] = useState(editing ? target!.email : "");
  const [password, setPassword] = useState("");
  const [fullNameAr, setFullNameAr] = useState(
    editing ? target!.fullNameAr || "" : "",
  );
  const [fullNameEn, setFullNameEn] = useState(
    editing ? target!.fullNameEn || "" : "",
  );
  const [role, setRole] = useState<StaffMember["role"]>(
    editing ? target!.role : "staff",
  );
  const [isActive, setIsActive] = useState(editing ? target!.isActive : true);
  const [error, setError] = useState<string | null>(null);

  // Lock-in on open: never let role demotion of the only owner
  // slip through, since the API also blocks it.
  const isOwnerTarget = editing && target!.role === "owner";

  function reset() {
    setError(null);
    setPassword("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    reset();
    onSubmittingChange(true);

    try {
      let res: any;
      if (editing) {
        const payload: Record<string, unknown> = {
          fullNameAr: fullNameAr.trim() || null,
          fullNameEn: fullNameEn.trim() || null,
          isActive,
        };
        // Only owners can change roles, period. We still guard at the
        // form level so the dropdown is disabled for managers.
        if (currentUser?.role === "owner" && !isOwnerTarget) {
          payload.role = role;
        } else if (isOwnerTarget) {
          // Owners always stay owners; we never send `role` for them.
        }
        res = await csrfFetch(`/api/v1/vendor/staff/${target!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        }).then((r) => r.json());
      } else {
        if (password.length < 8) {
          setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
          onSubmittingChange(false);
          return;
        }
        res = await csrfFetch("/api/v1/vendor/staff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
            fullNameAr: fullNameAr.trim() || undefined,
            fullNameEn: fullNameEn.trim() || undefined,
            role,
          }),
          credentials: "include",
        }).then((r) => r.json());
      }

      if (!res.success) {
        setError(res.error || "فشل الحفظ");
        return;
      }
      await onSaved();
    } catch {
      setError("حدث خطأ في الاتصال");
    } finally {
      onSubmittingChange(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b">
            <h2 className="text-xl font-bold text-gray-900">
              {editing ? "تعديل موظف" : "موظف جديد"}
            </h2>
          </div>

          <div className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                {error}
              </div>
            )}

            {!editing && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    البريد الإلكتروني
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    dir="ltr"
                    placeholder="staff@example.com"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    كلمة المرور
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="8 أحرف على الأقل"
                    className={inputClass}
                  />
                </div>
              </>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  الاسم (عربي)
                </label>
                <input
                  type="text"
                  value={fullNameAr}
                  onChange={(e) => setFullNameAr(e.target.value)}
                  placeholder="اختياري"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  الاسم (English)
                </label>
                <input
                  type="text"
                  value={fullNameEn}
                  onChange={(e) => setFullNameEn(e.target.value)}
                  placeholder="optional"
                  dir="ltr"
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                الدور
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as StaffMember["role"])}
                disabled={
                  isOwnerTarget ||
                  (editing && currentUser?.role !== "owner")
                }
                className={`${inputClass} disabled:bg-gray-100 disabled:text-gray-500`}
              >
                {/* Owners can only be created via DB / migration. The
                    API also rejects owner creation. */}
                {canPromoteToManager || role === "manager" ? (
                  <option value="manager">مدير — كل الصلاحيات</option>
                ) : null}
                <option value="staff">موظف — إدارة طلبات/منتجات</option>
                <option value="viewer">مشاهد — قراءة فقط</option>
              </select>
              {isOwnerTarget && (
                <p className="text-xs text-gray-500 mt-1">
                  لا يمكن تغيير دور المالك من هنا.
                </p>
              )}
              {!isOwnerTarget && editing && currentUser?.role !== "owner" && (
                <p className="text-xs text-gray-500 mt-1">
                  تعديل الدور متاح للمالك فقط.
                </p>
              )}
            </div>

            {editing && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-sm text-gray-900">فعّال</span>
              </label>
            )}
          </div>

          <div className="p-4 border-t flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-gray-700 hover:bg-gray-100 transition"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/90 transition flex items-center gap-2 disabled:opacity-50"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              حفظ
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
