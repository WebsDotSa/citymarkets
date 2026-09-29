"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import { DEFAULT_MAP_CENTER } from '@/lib/delivery';
import { BRAND } from "@/lib/brand-theme";

type Props = {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  className?: string;
};

export function AddressMapPicker({ lat, lng, onChange, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;

      if (cancelled || !containerRef.current) return;

      const center = lat && lng ? { lat, lng } : DEFAULT_MAP_CENTER;
      const container = containerRef.current;

      // Pre-flight: if the container has not been laid out yet (0×0),
      // wait for the next frame so the flex parent has its final size.
      // Without this, L.map() caches an empty size and the tile layer
      // renders nothing.
      const rect0 = container.getBoundingClientRect();
      if (rect0.width === 0 || rect0.height === 0) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        if (cancelled || !containerRef.current) return;
      }

      const map = L.map(container, {
        center: [center.lat, center.lng],
        zoom: 16,
        zoomControl: false,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      map.on("moveend", () => {
        const c = map.getCenter();
        onChange(c.lat, c.lng);
      });

      mapRef.current = map;

      // BUGFIX: Leaflet caches the container size at init. When the
      // picker is mounted via next/dynamic (AddAddressFlow) the parent
      // flex container may report 0×0 for one frame, so the map renders
      // as a grey rectangle with no tiles. invalidateSize() forces a
      // re-read of the bounds so the tile layer can draw.
      const refresh = () => {
        if (mapRef.current) mapRef.current.invalidateSize();
      };
      // Double-rAF + a 250ms safety net so we win against any layout
      // pass that the browser defers (e.g. iOS Safari opening the
      // keyboard, font loading, or the BottomNavV2 sticky-bar swap).
      requestAnimationFrame(() => {
        requestAnimationFrame(refresh);
      });
      const safetyTimer = setTimeout(refresh, 250);
      const ro = new ResizeObserver(() => {
        requestAnimationFrame(refresh);
      });
      ro.observe(container);
      (mapRef.current as LeafletMap & {
        __ro?: ResizeObserver;
        __timer?: ReturnType<typeof setTimeout>;
      }).__ro = ro;
      (mapRef.current as LeafletMap & {
        __timer?: ReturnType<typeof setTimeout>;
      }).__timer = safetyTimer;
    })();

    return () => {
      cancelled = true;
      const m = mapRef.current as (LeafletMap & {
        __ro?: ResizeObserver;
        __timer?: ReturnType<typeof setTimeout>;
      }) | null;
      if (m) {
        m.__ro?.disconnect();
        if (m.__timer) clearTimeout(m.__timer);
        m.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, []);

  useEffect(() => {
    if (mapRef.current && lat && lng) {
      mapRef.current.setView([lat, lng], mapRef.current.getZoom());
    }
  }, [lat, lng]);

  return (
    <div className={`relative overflow-hidden rounded-2xl ${className}`}>
      <div ref={containerRef} className="w-full h-full min-h-[280px] z-0" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-[500]">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg border-2 border-white relative z-10"
          style={{ backgroundColor: BRAND.primary }}
        >
          <span className="text-white text-lg">📍</span>
        </div>
        <div
          className="absolute w-24 h-24 rounded-full opacity-20"
          style={{ backgroundColor: BRAND.primary }}
        />
      </div>
    </div>
  );
}
