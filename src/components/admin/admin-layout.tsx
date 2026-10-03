"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminHeader } from "@/components/admin/admin-header";
import { AdminBottomNav } from "@/components/admin/admin-bottom-nav";
import { AdminRole } from "@/lib/admin-types";
import { useAdminLogout } from "@/hooks/use-admin-logout";

interface AdminLayoutProps {
  children: React.ReactNode;
}

// Auto-generate breadcrumbs from path segments
function useBreadcrumbs(pathname: string | null) {
  return useMemo(() => {
    if (!pathname) return [];
    const segments = pathname.split("/").filter(Boolean);
    // Skip "admin" segment, show everything after it
    const adminIndex = segments.indexOf("admin");
    const relevantSegments =
      adminIndex >= 0 ? segments.slice(adminIndex + 1) : segments;

    if (relevantSegments.length === 0) {
      return [{ label: "لوحة التحكم", href: "/admin" }];
    }

    const crumbs = [{ label: "لوحة التحكم", href: "/admin" }];
    let currentPath = "/admin";

    relevantSegments.forEach((seg) => {
      // Skip UUIDs and IDs
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          seg
        ) ||
        /^\d+$/.test(seg)
      ) {
        return;
      }

      // Skip "new" and "edit" segments
      if (seg === "new" || seg === "edit") {
        currentPath += `/${seg}`;
        crumbs.push({
          label: seg === "new" ? "إضافة جديد" : "تعديل",
          href: currentPath,
        });
        return;
      }

      currentPath += `/${seg}`;
      crumbs.push({
        label: decodeURIComponent(seg).replace(/-/g, " "),
        href: currentPath,
      });
    });

    return crumbs;
  }, [pathname]);
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<{
    name: string;
    email: string;
    role: AdminRole;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const breadcrumbs = useBreadcrumbs(pathname);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/auth/me", {
          credentials: "include",
        });
        const json = await res.json();
        if (!res.ok || !json.authenticated || !json.user) {
          // Drop the cached profile too — otherwise a revoked/expired
          // session leaves `admin_user` readable by pages that render
          // from it (e.g. settings/profile) even after the redirect.
          localStorage.removeItem("admin_user");
          if (!cancelled) router.replace("/admin/login");
          return;
        }
        const u = json.user as { name: string; email: string; role: AdminRole };
        if (!cancelled) {
          setUser({ name: u.name, email: u.email, role: u.role });
          localStorage.setItem("admin_user", JSON.stringify(u));
        }
      } catch {
        localStorage.removeItem("admin_user");
        if (!cancelled) router.replace("/admin/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Auto-close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const handleLogout = useAdminLogout(() => router.push("/admin/login"));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
          <p className="text-sm text-gray-500">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Sidebar */}
      <AdminSidebar
        user={user}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={handleLogout}
      />

      {/* Main content */}
      <div className="lg:mr-[280px] transition-all duration-300">
        {/* Header */}
        <AdminHeader
          onMenuClick={() => setSidebarOpen(true)}
          breadcrumbs={breadcrumbs.slice(1)}
        />

        {/* Page content */}
        <main
          key={pathname ?? "admin"}
          className="p-4 lg:p-6 min-h-[calc(100vh-4rem)] pb-24 lg:pb-6 admin-page-enter"
        >
          {children}
        </main>
      </div>

      {/* Bottom Navigation (Mobile) */}
      <AdminBottomNav
        user={user}
        onMenuClick={() => setSidebarOpen(true)}
      />
    </div>
  );
}
