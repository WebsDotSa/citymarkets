import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  state: {
    addresses: [] as any[],
    selectedAddress: null as any,
    loading: false,
  },
  closeSheet: vi.fn(),
  openAddFlow: vi.fn(),
  selectAddress: vi.fn(),
  addAddress: vi.fn().mockResolvedValue(undefined),
  showToast: vi.fn(),
  reverseGeocode: vi.fn().mockResolvedValue("شارع الاختبار، الرياض"),
}));

vi.mock("next/dynamic", () => ({
  default: () => (props: { className?: string }) => (
    <div data-testid="address-map-picker" className={props.className} />
  ),
}));

vi.mock("@/contexts/delivery-location-context", () => ({
  useDeliveryLocationState: () => mocks.state,
  useDeliveryLocationUi: () => ({ sheetOpen: true, addFlowOpen: false }),
  useDeliveryLocationActions: () => ({
    closeSheet: mocks.closeSheet,
    openAddFlow: mocks.openAddFlow,
    selectAddress: mocks.selectAddress,
    addAddress: mocks.addAddress,
  }),
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

vi.mock("@/lib/geocode", () => ({
  reverseGeocode: mocks.reverseGeocode,
}));

import { DeliveryAddressSheet } from "./delivery-address-sheet";

describe("DeliveryAddressSheet", () => {
  beforeEach(() => {
    mocks.state.addresses = [];
    mocks.state.selectedAddress = null;
    mocks.state.loading = false;
    mocks.closeSheet.mockClear();
    mocks.openAddFlow.mockClear();
    mocks.selectAddress.mockClear();
    mocks.addAddress.mockClear();
    mocks.showToast.mockClear();
    mocks.reverseGeocode.mockClear();
    mocks.reverseGeocode.mockResolvedValue("شارع الاختبار، الرياض");
  });

  it("shows saved addresses and selects one without navigating", () => {
    mocks.state.addresses = [
      {
        id: "address-1",
        label: "المنزل",
        labelType: "home",
        lat: 24.7,
        lng: 46.6,
        address_text: "حي الاختبار، الرياض",
        is_default: true,
      },
    ];
    mocks.state.selectedAddress = mocks.state.addresses[0];

    render(<DeliveryAddressSheet />);

    expect(screen.getByText("حي الاختبار، الرياض")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /حي الاختبار/ }));
    expect(mocks.selectAddress).toHaveBeenCalledWith("address-1");
  });

  it("opens the map on demand and saves a minimal address", async () => {
    render(<DeliveryAddressSheet />);

    expect(screen.queryByTestId("address-map-picker")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /تحديد على الخريطة/ }));
    expect(screen.getByTestId("address-map-picker")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /تحديث العنوان/ }));
    await waitFor(() =>
      expect(mocks.reverseGeocode).toHaveBeenCalledWith(24.7136, 46.6753),
    );

    fireEvent.change(screen.getByPlaceholderText(/وصف مختصر/), {
      target: { value: "الباب الأخضر" },
    });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الموقع" }));

    await waitFor(() =>
      expect(mocks.addAddress).toHaveBeenCalledWith({
        label: "المنزل",
        labelType: "home",
        lat: 24.7136,
        lng: 46.6753,
        address_text: "شارع الاختبار، الرياض",
        description: "الباب الأخضر",
        place_images: [],
      }),
    );
  });

  it("keeps the full address flow as a separate action", () => {
    render(<DeliveryAddressSheet />);

    fireEvent.click(screen.getByRole("button", { name: /إضافة عنوان كامل/ }));
    expect(mocks.openAddFlow).toHaveBeenCalledTimes(1);
  });
});
