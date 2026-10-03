"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, MapPin, CircleDot, ArrowLeft } from "lucide-react";
import { useDeliveryLocationActions, useDeliveryLocationState } from "@/contexts/delivery-location-context";

interface StoreStatus {
  is_open: boolean;
  message?: string | null;
}

export function HeroSection() {
  const router = useRouter();
  const { openSheet } = useDeliveryLocationActions();
  const { selectedAddress } = useDeliveryLocationState();
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/v1/store-status", { signal: ac.signal })
      .then((r) => r.json())
      .then((d) => {
        if (ac.signal.aborted) return;
        setStatus({ is_open: Boolean(d?.is_open), message: d?.message ?? null });
      })
      .catch(() => {});
    return () => ac.abort();
  }, []);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/catalog?q=${encodeURIComponent(q)}`);
  };

  const isClosed = status ? !status.is_open : false;

  return (
    <section
      className={`relative overflow-hidden transition-colors duration-500 ${
        isClosed
          ? "bg-gradient-to-b from-amber-50 to-slate-50"
          : "bg-gradient-to-b from-white to-slate-50"
      }`}
    >
      {/* decorative blobs */}
      <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-20 w-80 h-80 rounded-full bg-primary/5 blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-8 sm:pb-12">
        {/* store status pill */}
        {status && (
          <div className="flex justify-center mb-6">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-2xs font-medium ${
                isClosed
                  ? "bg-amber-100 text-amber-800"
                  : "bg-primary/10 text-primary"
              }`}
            >
              <CircleDot className={`w-3 h-3 ${isClosed ? "" : "animate-pulse"}`} />
              {isClosed ? (status.message || "المتجر مغلق حالياً") : "المتجر مفتوح الآن"}
            </span>
          </div>
        )}

        <h1 className="text-lg sm:text-2xl lg:text-3xl font-bold tracking-tight text-slate-900 text-center leading-tight">
          سوقك في جوالك
        </h1>
        <p className="mt-3 text-center text-slate-500 text-xs sm:text-sm max-w-md mx-auto">
          كل أسواقك المفضلة في مكان واحد. توصيل سريع لباب بيتك.
        </p>

        {/* search bar with location pill */}
        <form
          onSubmit={onSearch}
          className="mt-5 max-w-2xl mx-auto bg-white rounded-3xl shadow-lg border border-slate-100 p-1.5 flex items-center gap-2"
        >
          <button
            type="button"
            onClick={openSheet}
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-2xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs sm:text-sm font-medium transition-colors"
          >
            <MapPin className="w-4 h-4 text-primary" />
            <span className="hidden sm:inline max-w-[120px] truncate">
              {selectedAddress?.address_text || "حدد الموقع"}
            </span>
          </button>

          <div className="flex-1 flex items-center gap-2 px-2">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن منتج أو متجر..."
              className="flex-1 bg-transparent outline-none text-xs sm:text-sm text-slate-900 placeholder:text-slate-400"
            />
          </div>

          <button
            type="submit"
            disabled={!query.trim()}
            className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 sm:w-auto sm:px-5 sm:py-2.5 rounded-2xl bg-primary text-white font-semibold text-xs sm:text-sm hover:bg-primary-dark transition-colors disabled:opacity-40"
          >
            <span className="hidden sm:inline">ابحث</span>
            <ArrowLeft className="w-4 h-4 sm:hidden" />
          </button>
        </form>

        {/* quick links below search */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs sm:text-sm text-slate-500">
          <span className="font-medium text-slate-700">الأكثر بحثاً:</span>
          {["خضار وفواكه", "لحوم طازجة", "أرز وبقوليات", "حليب وأجبان"].map((term) => (
            <Link
              key={term}
              href={`/catalog?q=${encodeURIComponent(term)}`}
              className="hover:text-primary transition-colors"
            >
              {term}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}