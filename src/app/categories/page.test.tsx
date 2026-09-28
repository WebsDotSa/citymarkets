import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";

// Mock the next/link so jsdom doesn't try to resolve routes.
vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Mock lucide icons so jsdom renders nothing for them.
vi.mock("lucide-react", () => ({
  Search: (p: any) => <svg data-testid="i-search" {...p} />,
  MapPin: (p: any) => <svg data-testid="i-mappin" {...p} />,
  ChevronDown: (p: any) => <svg {...p} />,
  ChevronLeft: (p: any) => <svg {...p} />,
  Sparkles: (p: any) => <svg {...p} />,
  X: (p: any) => <svg {...p} />,
  Package: (p: any) => <svg {...p} />,
  ArrowRight: (p: any) => <svg {...p} />,
  Loader2: (p: any) => <svg {...p} />,
  RefreshCcw: (p: any) => <svg {...p} />,
}));

// Mock ProductCard so the inline products panel can render in jsdom
// without pulling in CartProvider/WishlistProvider. The cart + wishlist
// wiring is exercised on the dedicated /categories/[slug] page.
vi.mock("@/components/storefront/product-card", () => ({
  ProductCard: ({ product }: any) => (
    <a href={`/products/${product.id}`} data-testid="product-card">
      {product.name_ar}
    </a>
  ),
}));

// Mock the delivery-location context so the component can render without
// needing a real Supabase-backed auth context. The state values are mutated
// by individual tests via `mocks.selectedAddress`.
const mocks = vi.hoisted(() => ({
  openSheet: vi.fn(),
  selectedAddress: null as null | { address_text: string },
  productResponse: null as any,
  productFetchCount: 0,
}));

vi.mock("@/contexts/delivery-location-context", () => ({
  useDeliveryLocationState: () => ({ selectedAddress: mocks.selectedAddress }),
  useDeliveryLocationActions: () => ({ openSheet: mocks.openSheet }),
}));

// Mock safe-fetch so the product search effect can be tested deterministically
// without hitting the network. Tests set `mocks.productResponse` before typing
// to control what the panel shows.
vi.mock("@/lib/safe-fetch", () => ({
  safeFetchJson: vi.fn(async (url: string) => {
    mocks.productFetchCount += 1;
    return mocks.productResponse;
  }),
}));

import { CategoriesBrowserV2 } from "@/components/pages/categories/categories-browser-v2";
import type { CategoryTreeNode } from "@/lib/categories/tree";

function makeNode(over: Partial<CategoryTreeNode> & { id: any; name_ar: string; slug: string; product_count?: number; children?: CategoryTreeNode[] }): CategoryTreeNode {
  return {
    name_en: null,
    icon_url: null,
    parent_id: null,
    is_active: true,
    sort_order: 0,
    descendantCount: 0,
    children: over.children ?? [],
    ...over,
  } as CategoryTreeNode;
}

const tree: CategoryTreeNode[] = [
  makeNode({
    id: "r1",
    name_ar: "الخضروات والفواكه",
    slug: "الخضروات-والفواكه",
    product_count: 65,
    descendantCount: 65,
    children: [
      makeNode({ id: "c1", name_ar: "خضروات", slug: "خضروات", product_count: 40, descendantCount: 40 }),
      makeNode({ id: "c2", name_ar: "فواكه طازجة", slug: "fresh-fruits", product_count: 19, descendantCount: 19, children: [
        makeNode({ id: "g1", name_ar: "تفاح", slug: "apples", product_count: 8, descendantCount: 8 }),
      ] }),
    ],
  }),
  makeNode({
    id: "r2",
    name_ar: "المقاضي",
    slug: "المقاضي",
    product_count: 27,
    descendantCount: 27,
    children: [
      makeNode({ id: "c3", name_ar: "البهارات", slug: "البهارات", product_count: 291, descendantCount: 291 }),
      makeNode({ id: "c4", name_ar: "صوصات الطبخ", slug: "صوصات-الطبخ", product_count: 74, descendantCount: 74, children: [
        makeNode({ id: "g2", name_ar: "صوصات السلطة", slug: "صوصات-السلطة", product_count: 35, descendantCount: 35 }),
      ] }),
    ],
  }),
];

describe("CategoriesBrowserV2", () => {
  it("renders all roots in the order they were passed", () => {
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    // The desktop sidebar lists the 2 root names
    const sidebar = screen.getByRole("navigation", { name: /الأقسام الرئيسية/i });
    const items = within(sidebar)
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("data-root-id"));
    expect(items[0]).toHaveTextContent("الخضروات والفواكه");
    expect(items[1]).toHaveTextContent("المقاضي");
  });

  it("shows the first root's children in the main grid by default", () => {
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    expect(screen.getByRole("heading", { name: /الخضروات والفواكه/i })).toBeInTheDocument();
    // Sub-category names now render in both the RootGrid cards AND the
    // ProductsPanel filter pills, so we expect at least one occurrence.
    expect(screen.getAllByText("خضروات").length).toBeGreaterThan(0);
    expect(screen.getAllByText("فواكه طازجة").length).toBeGreaterThan(0);
  });

  it("switches active root when sidebar is clicked", () => {
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    const sidebar = screen.getByRole("navigation", { name: /الأقسام الرئيسية/i });
    fireEvent.click(within(sidebar).getByText("المقاضي"));
    expect(screen.getByRole("heading", { name: /المقاضي/i })).toBeInTheDocument();
    // Sub-category names render in both RootGrid cards and the products
    // panel pills, so we expect at least one occurrence of البهارات
    // (which is a child of المقاضي).
    expect(screen.getAllByText("البهارات").length).toBeGreaterThan(0);
    expect(screen.queryByText("خضروات")).not.toBeInTheDocument();
  });

  it("renders grandchild pills inside a card that has children", () => {
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    // c2 (فواكه طازجة) has a grandchild تفاح — pill should be visible.
    const pill = screen.getByRole("list", { name: /أقسام فواكه طازجة/i });
    expect(within(pill).getByText("تفاح")).toBeInTheDocument();
  });

  it("filters sidebar and grid when typing in the search box", () => {
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "صوص" } });
    // Both roots contain "صوص" only via المقاضي, so the other root
    // should drop out of the sidebar and the main grid.
    const sidebar = screen.getByRole("navigation", { name: /الأقسام الرئيسية/i });
    expect(within(sidebar).queryByText("الخضروات والفواكه")).not.toBeInTheDocument();
    expect(within(sidebar).getByText("المقاضي")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", () => {
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "xyz123notreal" } });
    // The empty state is the only h3 in the main grid.
    expect(screen.getByRole("heading", { name: /لا توجد نتائج/i })).toBeInTheDocument();
  });

  it("passes total counts to the hero", () => {
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    const hero = screen.getByRole("region", { name: /بحث الأقسام/i });
    expect(within(hero).getByText(/2 قسم رئيسي/i)).toBeInTheDocument();
    expect(within(hero).getByText(/4 قسم فرعي/i)).toBeInTheDocument();
    expect(within(hero).getByText(/92/)).toBeInTheDocument();
  });

  it("shows the selected address in the hero location pill and opens the sheet on click", () => {
    mocks.selectedAddress = { address_text: "حي النخيل، الرياض" };
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    const pill = screen.getByRole("button", { name: /تغيير موقع التوصيل/i });
    expect(pill).toHaveTextContent("حي النخيل، الرياض");
    fireEvent.click(pill);
    expect(mocks.openSheet).toHaveBeenCalledTimes(1);
    mocks.selectedAddress = null;
  });

  it("falls back to the default location label when no address is selected", () => {
    mocks.selectedAddress = null;
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    expect(screen.getByRole("button", { name: /تغيير موقع التوصيل/i })).toHaveTextContent("تحديد الموقع");
  });

  it("renders matching categories instantly in the hybrid results panel", () => {
    mocks.productResponse = { data: [] };
    mocks.productFetchCount = 0;
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "صوص" } });
    // Instant category match — c4 (صوصات الطبخ) should appear in the
    // hero's hybrid panel under "الأقسام". The text is split across a
    // <mark> so we look for the underlying <a> link by href instead.
    const links = screen.getAllByRole("link", { name: /صوصات الطبخ/ });
    expect(links.length).toBeGreaterThan(0);
  });

  it("fetches product matches from /api/v1/products and renders the results", async () => {
    mocks.productResponse = {
      data: [
        {
          id: "p1",
          name_ar: "صوص طماطم عضوي",
          image_url: null,
          price: 12.5,
          discount_price: 9.99,
          stock_qty: 25,
          category_name: "صوصات الطبخ",
          category_slug: "صوصات-الطبخ",
        },
      ],
    };
    mocks.productFetchCount = 0;
    render(
      <CategoriesBrowserV2
        initialTree={tree}
        totalRoots={2}
        totalChildren={4}
        totalProducts={92}
      />
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "صوص" } });
    await waitFor(() => expect(mocks.productFetchCount).toBeGreaterThan(0));
    // The product row link navigates to /products/<id>.
    expect(
      await screen.findByRole("link", { name: /صوص طماطم عضوي/ })
    ).toBeInTheDocument();
    expect(screen.getByText(/عرض كل النتائج/)).toBeInTheDocument();
  });
});
