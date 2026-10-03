"use client";

import React from "react";
import { AuthProvider } from "@/contexts/auth-context";
import { CartProvider } from "@/contexts/cart-context";
import { WishlistProvider } from "@/contexts/wishlist-context";
import { DeliveryLocationProvider } from "@/contexts/delivery-location-context";
import { LocationOverlays } from "@/components/location/location-overlays";
import { ToastProvider } from "@/components/ui/toast";
import { SseProvider } from "@/components/realtime/SseProvider";
import { useWebVitals } from "@/hooks/use-web-vitals";

function WebVitalsInitializer() {
  useWebVitals();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DeliveryLocationProvider>
        <CartProvider>
          <WishlistProvider>
            <ToastProvider>
              <SseProvider>
                <WebVitalsInitializer />
                {children}
                <LocationOverlays />
              </SseProvider>
            </ToastProvider>
          </WishlistProvider>
        </CartProvider>
      </DeliveryLocationProvider>
    </AuthProvider>
  );
}
