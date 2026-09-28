"use client";

import type { ReactNode } from "react";
import { useDeliveryLocationActions } from "@/contexts/delivery-location-context";

export function LocationSheetTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { openSheet } = useDeliveryLocationActions();

  return (
    <button type="button" onClick={openSheet} className={className}>
      {children}
    </button>
  );
}
