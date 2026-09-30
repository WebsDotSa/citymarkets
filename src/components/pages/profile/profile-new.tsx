"use client";

/**
 * ProfileNew — customer profile page with order history + wishlist + addresses.
 *
 * The `-new` suffix is intentional (audit H34): this file replaced an
 * older single-page `profile.tsx` flow during the profile-page redesign.
 * The legacy file was removed; the new one kept the `-new` discriminator
 * so the route import at src/app/profile/page.tsx + the existing test
 * file at ./profile-new.test.tsx don't need to change. Do NOT rename
 * without auditing the 2 importers.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthState, useAuthActions } from "@/contexts/auth-context";
import { useWishlistState } from "@/contexts/wishlist-context";
import { useDeliveryLocationActions } from "@/contexts/delivery-location-context";
import { useConfirm } from "@/components/ui/toast";
import { csrfFetch } from "@/lib/csrf-client";
import { error as logError } from "@/lib/logger";
import {
  User,
  Phone,
  Mail,
  MapPin,
  Bell,
  Heart,
  CreditCard,
  Shield,
  Gift,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Settings,
  Package,
  Star,
  Award,
  Clock,
  Edit2,
  Plus,
  Trash2,
  Check,
  X,
} from "lucide-react";

interface Address {
  id: string;
  label: string;
  address: string;
  city: string;
  building?: string;
  floor?: string;
  instructions?: string;
  is_default: boolean;
}

interface ProfileSection {
  title: string;
  items: {
    icon: React.ReactNode;
    label: string;
    value?: string;
    href: string;
    badge?: string;
    badgeColor?: string;
  }[];
}

export function ProfileNew() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuthState();
  const { signOut } = useAuthActions();
  const { itemCount: wishlistCount } = useWishlistState();
  const { openSheet } = useDeliveryLocationActions();
  const [loading, setLoading] = useState(true);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [ordersCount, setOrdersCount] = useState(0);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    // Wait for the auth bootstrap to settle before deciding to redirect,
    // otherwise the page flashes the spinner and bounces to /auth/login
    // on a hard refresh (matches profile-edit.tsx:49-52 pattern).
    if (authLoading) return;
    if (!user) {
      router.push("/auth/login?redirect=/profile");
      return;
    }

    Promise.all([
      fetch("/api/v1/delivery-addresses").then((r) => r.json()),
      // /api/v1/loyalty/points does NOT exist (404); use the canonical
      // endpoint which returns { success, data: { balance, ... } }.
      fetch("/api/v1/loyalty")
        .then((r) => r.json())
        .catch(() => ({ success: false, data: { balance: 0 } })),
      // Best-effort order count — capped at 20 by the API, so we render
      // it as a hint rather than an exact figure for heavy shoppers.
      fetch("/api/v1/orders?limit=20")
        .then((r) => r.json())
        .catch(() => ({ success: false, orders: [] })),
    ])
      .then(([addrRes, loyaltyRes, ordersRes]) => {
        if (addrRes.success) setAddresses(addrRes.data || []);
        setLoyaltyPoints(
          loyaltyRes?.data?.balance ?? loyaltyRes?.points ?? 0,
        );
        const list = Array.isArray(ordersRes?.orders) ? ordersRes.orders : [];
        setOrdersCount(list.length);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [user, authLoading, router]);

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary-600/30 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  const sections: ProfileSection[] = [
    {
      title: "حسابي",
      items: [
        { icon: <User className="w-5 h-5" />, label: "الملف الشخصي", value: user.name || user.phone, href: "/profile/edit" },
        { icon: <Phone className="w-5 h-5" />, label: "رقم الهاتف", value: user.phone, href: "/profile/edit" },
        { icon: <Mail className="w-5 h-5" />, label: "البريد الإلكتروني", value: user.email || "غير محدد", href: "/profile/edit" },
      ],
    },
    {
      title: "العناوين",
      items: [
        { icon: <MapPin className="w-5 h-5" />, label: "عناويني", href: "/profile/addresses", badge: `${addresses.length}`, badgeColor: "bg-primary-100 text-primary-700" },
      ],
    },
    {
      title: "طلباتي",
      items: [
        { icon: <Package className="w-5 h-5" />, label: "الطلبات", href: "/orders", badge: ordersCount > 0 ? `${ordersCount}` : undefined, badgeColor: "bg-primary-100 text-primary-700" },
        { icon: <Heart className="w-5 h-5" />, label: "المفضلة", href: "/wishlist", badge: wishlistCount > 0 ? `${wishlistCount}` : undefined, badgeColor: "bg-red-100 text-red-700" },
        { icon: <Star className="w-5 h-5" />, label: "مراجعاتي", href: "/profile/reviews" },
      ],
    },
    {
      title: "الولاء والمكافآت",
      items: [
        // Real balance lives at /profile/loyalty (the marketing page
        // /loyalty is a one-way funnel, not a balance surface).
        { icon: <Award className="w-5 h-5" />, label: "نقاط الولاء", href: "/profile/loyalty", badge: loyaltyPoints > 0 ? `${loyaltyPoints} نقطة` : undefined, badgeColor: "bg-amber-100 text-amber-700" },
        { icon: <Gift className="w-5 h-5" />, label: "الرموز الترويجية", href: "/profile/coupons" },
      ],
    },
    {
      title: "الإعدادات",
      items: [
        { icon: <Bell className="w-5 h-5" />, label: "الإشعارات", href: "/profile/notifications" },
        { icon: <Shield className="w-5 h-5" />, label: "الأمان والخصوصية", href: "/profile/security" },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-l from-primary-600 to-primary-700 px-4 pt-6 pb-20">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-white mb-6">حسابي</h1>
          
          {/* Profile Card */}
          <div className="bg-white rounded-3xl p-6 shadow-xl">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-l from-primary-500 to-primary-600 flex items-center justify-center text-white text-3xl font-bold shadow-lg">
                {user.name?.charAt(0) || user.phone?.charAt(0) || "م"}
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-gray-900">{user.name || "مستخدم"}</h2>
                <p className="text-gray-500 text-sm" dir="ltr">{user.phone}</p>
                {user.email && <p className="text-gray-500 text-sm">{user.email}</p>}
              </div>
              <Link
                href="/profile/edit"
                className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
              >
                <Edit2 className="w-5 h-5 text-gray-600" />
              </Link>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3 mt-6">
              <div className="text-center p-3 bg-primary-50 rounded-xl">
                <p className="text-2xl font-bold text-primary-600">{loyaltyPoints}</p>
                <p className="text-xs text-gray-500">نقطة</p>
              </div>
              <Link href="/orders" className="text-center p-3 bg-amber-50 rounded-xl hover:bg-amber-100 transition-colors">
                <p className="text-2xl font-bold text-amber-600">{ordersCount}</p>
                <p className="text-xs text-gray-500">طلب</p>
              </Link>
              <Link href="/wishlist" className="text-center p-3 bg-red-50 rounded-xl hover:bg-red-100 transition-colors" data-testid="wishlist-count-tile">
                <p className="text-2xl font-bold text-red-500" data-testid="wishlist-count-value">{wishlistCount}</p>
                <p className="text-xs text-gray-500">مفضلة</p>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 -mt-10">
        <div className="max-w-4xl mx-auto space-y-4">
          {sections.map((section, index) => (
            <div key={section.title} className="bg-white rounded-2xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm">{section.title}</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {section.items.map((item) => {
                  const itemContent = (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600">
                        {item.icon}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{item.label}</p>
                        {item.value && (
                          <p className="text-sm text-gray-500">{item.value}</p>
                        )}
                      </div>
                      {item.badge && (
                        <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${item.badgeColor}`}>
                          {item.badge}
                        </span>
                      )}
                      <ChevronLeft className="w-5 h-5 text-gray-400" />
                    </>
                  );
                  const className = "flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors";
                  if (item.href === "/profile/addresses") {
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={openSheet}
                        className={`${className} w-full text-right`}
                      >
                        {itemContent}
                      </button>
                    );
                  }
                  return (
                    <Link key={item.label} href={item.href} className={className}>
                      {itemContent}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Sign Out */}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-4 p-4 bg-white rounded-2xl shadow-sm hover:bg-red-50 transition-colors text-red-600"
          >
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
              <LogOut className="w-5 h-5" />
            </div>
            <span className="font-medium">تسجيل الخروج</span>
          </button>

          {/* Delete Account */}
          <button
            onClick={() => setShowDeleteModal(true)}
            className="w-full flex items-center gap-4 p-4 bg-white rounded-2xl shadow-sm hover:bg-gray-50 transition-colors text-gray-500"
          >
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
              <Trash2 className="w-5 h-5" />
            </div>
            <div className="flex-1 text-right">
              <p className="font-medium">حذف الحساب</p>
              <p className="text-xs text-gray-400">حذف نهائي لجميع بياناتك</p>
            </div>
          </button>

          {/* App Version */}
          <p className="text-center text-xs text-gray-400 py-4">
            أسواق سيتي v1.0.0
          </p>
        </div>
      </div>

      {showDeleteModal && (
        <DeleteAccountModal
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => {
            setShowDeleteModal(false);
            router.push("/");
          }}
        />
      )}
    </div>
  );
}

// Address Management Component
export function AddressesNew() {
  const { user } = useAuthState();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    if (!user) return;
    const ac = new AbortController();
    fetch("/api/v1/delivery-addresses", { signal: ac.signal })
      .then((r) => r.json())
      .then((res) => {
        if (ac.signal.aborted) return;
        if (res.success) setAddresses(res.data || []);
        setLoading(false);
      })
      .catch(() => {});
    return () => ac.abort();
  }, [user]);

  const deleteAddress = async (id: string) => {
    if (!(await confirm({ title: "حذف عنوان", message: "هل أنت متأكد من حذف هذا العنوان؟", danger: true }))) return;
    try {
      const res = await fetch(`/api/v1/delivery-addresses/${id}`, { method: "DELETE" });
      if (res.ok) {
        setAddresses((prev) => prev.filter((a) => a.id !== id));
      }
    } catch (error) {
      // Audit I39: canonical logger.
      logError("Error deleting address", error);
    }
  };

  const setDefault = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/delivery-addresses/${id}/default`, { method: "POST" });
      if (res.ok) {
        setAddresses((prev) =>
          prev.map((a) => ({ ...a, is_default: a.id === id }))
        );
      }
    } catch (error) {
      // Audit I39: canonical logger.
      logError("Error setting default", error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary-600/30 border-t-primary-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">عناويني</h1>
          <Link
            href="/profile"
            className="p-2 -mr-2 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <ChevronRight className="w-6 h-6 text-gray-600" />
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-4 max-w-4xl mx-auto space-y-4">
        {addresses.length === 0 ? (
          <div className="bg-white rounded-2xl p-8 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MapPin className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="font-bold text-gray-900 mb-2">لا توجد عناوين</h3>
            <p className="text-gray-500 text-sm mb-4">أضف عنوانك الأول للتوصيل</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-xl font-semibold hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              إضافة عنوان
            </button>
          </div>
        ) : (
          <>
            {addresses.map((addr) => (
              <div
                key={addr.id}
                className={`bg-white rounded-2xl p-4 shadow-sm ${
                  addr.is_default ? "ring-2 ring-primary-500" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    addr.is_default ? "bg-primary-100 text-primary-600" : "bg-gray-100 text-gray-600"
                  }`}>
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{addr.label}</span>
                      {addr.is_default && (
                        <span className="px-2 py-0.5 bg-primary-100 text-primary-700 text-xs font-medium rounded-lg">
                          افتراضي
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{addr.address}</p>
                    {addr.building && (
                      <p className="text-sm text-gray-500">{addr.building}{addr.floor && ` - ${addr.floor}`}</p>
                    )}
                    {addr.instructions && (
                      <p className="text-sm text-gray-400 mt-1">{addr.instructions}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {!addr.is_default && (
                      <button
                        onClick={() => setDefault(addr.id)}
                        className="p-2 text-gray-400 hover:text-primary-600 transition-colors"
                        title="تحديد كافتراضي"
                      >
                        <Star className="w-5 h-5" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteAddress(addr.id)}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={() => setShowAddForm(true)}
              className="w-full flex items-center justify-center gap-2 p-4 bg-white rounded-2xl border-2 border-dashed border-gray-300 text-gray-600 font-medium hover:border-primary-500 hover:text-primary-600 transition-all"
            >
              <Plus className="w-5 h-5" />
              إضافة عنوان جديد
            </button>
          </>
        )}
      </div>

      {/* Add Address Modal */}
      {showAddForm && (
        <AddressFormModal onClose={() => setShowAddForm(false)} />
      )}
      {confirm.dialog}
    </div>
  );
}

function AddressFormModal({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [instructions, setInstructions] = useState("");
  // D13: lat/lng are required by /api/v1/delivery-addresses POST. We either
  // capture them via geolocation or fall back to Riyadh center so
  // the form submits even when permission is denied.
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const requestGeolocation = () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setLocationStatus("الموقع غير متاح في هذا المتصفح — استخدام موقع تقريبي");
      setCoords({ lat: 24.7136, lng: 46.6753 });
      return;
    }
    setLocating(true);
    setLocationStatus(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
        setLocationStatus("تم تحديد موقعك بنجاح");
      },
      () => {
        // Permission denied or position unavailable — fall back to
        // Riyadh center so the form still submits. The next
        // /api/v1/orders/direct will geocode address_text to refine.
        setCoords({ lat: 24.7136, lng: 46.6753 });
        setLocating(false);
        setLocationStatus("تعذّر الوصول إلى موقعك — استخدام موقع تقريبي (الرياض)");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !address) return;

    setSaving(true);
    try {
      // Merge the legacy building/floor/instructions fields into
      // `description` so the existing UI keeps working without DB
      // schema changes. The server has no `building` / `floor` /
      // `instructions` columns — verified against
      // migrations/001_full_schema.sql:72-81 + 004_addresses.sql.
      const descriptionParts = [
        building.trim() && `مبنى ${building.trim()}`,
        floor.trim() && `الطابق ${floor.trim()}`,
        instructions.trim(),
      ].filter(Boolean) as string[];
      const description = descriptionParts.join(" — ");

      const lat = coords?.lat ?? 24.7136;
      const lng = coords?.lng ?? 46.6753;

      const res = await fetch("/api/v1/delivery-addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          title: label,
          address_text: address,
          description: description || undefined,
          lat,
          lng,
          is_default: false,
        }),
      });

      if (res.ok) {
        window.location.reload();
      } else {
        const body = await res.json().catch(() => ({}));
        setLocationStatus(body?.error || "تعذّر حفظ العنوان");
      }
    } catch (error) {
      // Audit I39: canonical logger.
      logError("Error saving address", error);
      setLocationStatus("تعذّر حفظ العنوان — حاول مرة أخرى");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-white px-4 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-lg text-gray-900">إضافة عنوان جديد</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl">
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">عنوان مختصر</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="مثال: البيت، العمل"
              className="w-full h-12 px-4 border border-gray-200 rounded-xl focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">العنوان التفصيلي</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="الحي، الشارع، المبنى..."
              rows={3}
              className="w-full p-4 border border-gray-200 rounded-xl focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 resize-none"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">المبنى</label>
              <input
                type="text"
                value={building}
                onChange={(e) => setBuilding(e.target.value)}
                placeholder="رقم المبنى"
                className="w-full h-12 px-4 border border-gray-200 rounded-xl focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">الطابق</label>
              <input
                type="text"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                placeholder="رقم الطابق"
                className="w-full h-12 px-4 border border-gray-200 rounded-xl focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">تعليمات إضافية</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="مثال: بجوار مسجد، لون المبنى أحمر..."
              rows={2}
              className="w-full p-4 border border-gray-200 rounded-xl focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 resize-none"
            />
          </div>

          {/* D13 geolocation: lat/lng are required by /api/v1/delivery-addresses.
              We give the user a one-tap "Use my location" button and
              fall back to Riyadh center coords if the browser denies. */}
          <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700">الموقع</p>
              <p className="text-[11px] text-gray-500 truncate" data-testid="location-status">
                {locationStatus ?? (coords ? `(${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})` : "اضغط لتحديد موقعك")}
              </p>
            </div>
            <button
              type="button"
              onClick={requestGeolocation}
              disabled={locating}
              data-testid="use-my-location"
              className="text-xs font-semibold text-primary-700 hover:text-primary-800 disabled:opacity-50"
            >
              {locating ? "..." : "استخدم موقعي"}
            </button>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-4 bg-primary-600 text-white rounded-2xl font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Check className="w-5 h-5" />
                حفظ العنوان
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// Account deletion confirmation modal.
// Asks the user to type "DELETE" to confirm. Calls POST /api/v1/profile/delete
// and clears the session cookie via the API response. On success, redirects
// to home. Why require typing "DELETE": accidental taps on the trash icon
// must not destroy a real account.
function DeleteAccountModal({
  onClose,
  onDeleted,
}: {
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const handleDelete = async () => {
    if (confirmText.trim() !== "DELETE") {
      setError('اكتب "DELETE" للتأكيد');
      return;
    }
    const ok = await confirm({
      title: "حذف الحساب نهائياً",
      message:
        "هذا الإجراء لا يمكن التراجع عنه. سيتم حذف اسمك وبريدك وصورتك، وستفقد نقاط الولاء والمفضلة. هل أنت متأكد؟",
      danger: true,
    });
    if (!ok) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await csrfFetch("/api/v1/profile/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        onDeleted();
      } else {
        setError(data.error || "فشل حذف الحساب");
      }
    } catch {
      setError("تعذر الاتصال بالخادم");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-white px-4 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-bold text-lg text-gray-900">حذف الحساب</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl">
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-800">
            <p className="font-semibold mb-2">سيتم حذف:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>الاسم والبريد الإلكتروني والصورة</li>
              <li>المفضلة وقائمة الأمنيات</li>
              <li>نقاط الولاء والمكافآت</li>
              <li>إشعارات الجوال المرتبطة بحسابك</li>
            </ul>
            <p className="mt-3 text-xs text-red-700">
              * الطلبات السابقة تبقى محفوظة لأغراض الفوترة والمحاسبة.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              اكتب <span className="font-mono font-bold text-red-600">DELETE</span> للتأكيد
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => {
                setConfirmText(e.target.value);
                setError(null);
              }}
              placeholder="DELETE"
              dir="ltr"
              autoComplete="off"
              className="w-full h-12 px-4 border border-gray-200 rounded-xl focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/20 font-mono"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{error}</p>
          )}

          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting || confirmText.trim() !== "DELETE"}
            className="w-full py-4 bg-red-600 text-white rounded-2xl font-semibold hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {submitting ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Trash2 className="w-5 h-5" />
                حذف الحساب نهائياً
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-full py-3 text-gray-600 font-medium hover:bg-gray-50 rounded-2xl transition-colors"
          >
            إلغاء
          </button>
        </div>
      </div>
      {confirm.dialog}
    </div>
  );
}
