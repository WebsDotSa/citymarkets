"use client";

import { DeliveryAddressSheet } from "./delivery-address-sheet";
import { AddAddressFlow } from "./add-address-flow";

/** Global location UI mounted once in the app shell */
export function LocationOverlays() {
  return (
    <>
      <DeliveryAddressSheet />
      <AddAddressFlow />
    </>
  );
}
