"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Package, ShoppingBag, BarChart3, Menu } from "lucide-react";
import { AdminRole } from "@/lib/admin-types";

// Bottom-nav display only needs the user identity; full `AdminUser`
// carries fields (id, created_at, phone, avatar) that aren't rendered
// in the bottom-nav. Use a minimal subset that matches the layout's
// already-displayed user state.
interface AdminUser {
  name: string;
  email: string;
  role: AdminRole;
}

interface AdminBottomNavProps {
  user: AdminUser;
  onMenuClick: () => void;
}

export function AdminBottomNav({ user, onMenuClick }: AdminBottomNavProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/admin") {
      return pathname === "/admin";
    }
    return pathname?.startsWith(href);
  };

  const navItems = [
    {
      label: "الرئيسية",
      href: "/admin",
      icon: Home,
    },
    {
      label: "المنتجات",
      href: "/admin/products",
      icon: Package,
    },
    {
      label: "الطلبات",
      href: "/admin/orders",
      icon: ShoppingBag,
    },
    {
      label: "الإحصائيات",
      href: "/admin/analytics",
      icon: BarChart3,
    },
  ];

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-200 z-40 pb-safe shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-around px-2 py-2">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center w-16 h-12 rounded-xl transition-all duration-300 ${
                active
                  ? "text-primary scale-110"
                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
              }`}
            >
              <div className={`relative flex items-center justify-center w-8 h-8 rounded-full ${active ? 'bg-primary/10' : ''}`}>
                <Icon className={`w-5 h-5 ${active ? "animate-pulse-slow" : ""}`} />
                {active && (
                   <span className="absolute -bottom-1 w-1 h-1 rounded-full bg-primary" />
                )}
              </div>
              <span className={`text-[10px] mt-1 font-medium ${active ? "text-primary" : ""}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
        
        {/* Menu Button */}
        <button
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center w-16 h-12 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all duration-300"
        >
          <div className="relative flex items-center justify-center w-8 h-8 rounded-full">
            <Menu className="w-5 h-5" />
          </div>
          <span className="text-[10px] mt-1 font-medium">
            المزيد
          </span>
        </button>
      </div>
    </div>
  );
}
