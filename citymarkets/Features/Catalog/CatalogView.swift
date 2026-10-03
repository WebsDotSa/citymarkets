import SwiftUI

// MARK: – CatalogView

struct CatalogView: View {
    @EnvironmentObject private var store: AppStore
    @State private var selectedMain: Category?
    @State private var selectedSub: Category?
    @State private var categoryProducts: [Product] = []
    @State private var isLoadingProducts = false

    private var mainCats: [Category] {
        store.categories
            .filter { $0.parentId == nil }
            .sorted { ($0.sortOrder ?? 99) < ($1.sortOrder ?? 99) }
    }

    private var subCats: [Category] {
        guard let main = selectedMain else { return [] }
        return store.categories
            .filter { $0.parentId == main.id }
            .sorted { ($0.sortOrder ?? 99) < ($1.sortOrder ?? 99) }
    }

    private var activeCategory: Category? {
        selectedSub ?? selectedMain
    }

    private var productsTitle: String {
        activeCategory?.nameAr ?? "المنتجات"
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomLeading) {
                VStack(spacing: 0) {
                    pageHeader
                    if store.searchText.isEmpty {
                        categoryContent
                    } else {
                        searchResultsGrid
                    }
                }

                if store.cartCount > 0 {
                    CompactFloatingCart(count: store.cartCount, subtotal: store.cartSubtotal)
                        .padding(.leading, 16)
                        .padding(.bottom, 10)
                }
            }
            .background(Color.cmBg)
            .toolbar(.hidden, for: .navigationBar)
            .onAppear { selectFirstIfNeeded() }
            .onChange(of: store.categories.count) { _, _ in selectFirstIfNeeded() }
            .task(id: activeCategory?.id) {
                await loadActiveCategoryProducts()
            }
            .task(id: store.searchText) {
                guard !store.searchText.isEmpty else { return }
                try? await Task.sleep(for: .milliseconds(450))
                guard !Task.isCancelled else { return }
                await store.loadProducts()
            }
        }
    }

    // MARK: – Page Header + Search

    private var pageHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text("تصفّح كل الأقسام")
                    .font(.title2.bold())
                    .foregroundStyle(Color.cmText)
                Text("اختر قسماً رئيسياً ثم خصّص النتائج بالأقسام الفرعية")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Color.cmPrimary)
                TextField("ابحث عن منتج أو قسم... مثل: تفاح، حليب، بهارات", text: $store.searchText)
                    .submitLabel(.search)
                    .onSubmit { Task { await store.loadProducts() } }
                if !store.searchText.isEmpty {
                    Button {
                        store.searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(12)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.cmBorder))
        }
        .padding(.horizontal)
        .padding(.top, 14)
        .padding(.bottom, 10)
    }

    // MARK: – Category Content

    private var categoryContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                mainCategoryRail

                if !subCats.isEmpty {
                    subcategoryFilterRail
                }

                productsSection
            }
            .padding(.bottom, store.cartCount > 0 ? 86 : 18)
        }
        .refreshable {
            await loadActiveCategoryProducts()
        }
    }

    private var mainCategoryRail: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("الأقسام الرئيسية")
                .font(.headline.bold())
                .foregroundStyle(Color.cmText)
                .padding(.horizontal)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(mainCats) { cat in
                        MainCategoryImageTab(
                            category: cat,
                            isSelected: selectedMain?.id == cat.id
                        ) {
                            selectMain(cat)
                        }
                    }
                }
                .padding(.horizontal)
            }
        }
        .padding(.top, 4)
    }

    private var subcategoryFilterRail: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                SubcategoryFilterChip(
                    title: "كل \(selectedMain?.nameAr ?? "القسم")",
                    isSelected: selectedSub == nil
                ) {
                    selectedSub = nil
                }

                ForEach(subCats) { sub in
                    SubcategoryFilterChip(
                        title: sub.nameAr,
                        isSelected: selectedSub?.id == sub.id
                    ) {
                        selectedSub = sub
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 4)
        }
    }

    private var productsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(productsTitle)
                        .font(.title3.bold())
                        .foregroundStyle(Color.cmText)
                    Text(isLoadingProducts ? "جاري تحميل المنتجات..." : "\(categoryProducts.count) منتج")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(.horizontal)

            if isLoadingProducts && categoryProducts.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 42)
            } else if categoryProducts.isEmpty {
                EmptyState(
                    title: "لا توجد منتجات",
                    subtitle: "لم نجد منتجات في هذا القسم حالياً",
                    systemImage: "tray"
                )
            } else {
                LazyVGrid(
                    columns: [GridItem(.flexible()), GridItem(.flexible())],
                    spacing: 12
                ) {
                    ForEach(categoryProducts) { product in
                        NavigationLink {
                            ProductDetailView(product: product)
                        } label: {
                            ProductCard(product: product)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
    }

    // MARK: – Search Results

    private var searchResultsGrid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(store.products) { product in
                    NavigationLink {
                        ProductDetailView(product: product)
                    } label: {
                        ProductCard(product: product)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding()
        }
    }

    private func selectMain(_ category: Category) {
        guard selectedMain?.id != category.id else { return }
        selectedMain = category
        selectedSub = nil
    }

    private func selectFirstIfNeeded() {
        if selectedMain == nil {
            selectedMain = mainCats.first
        } else if let selectedMain, !mainCats.contains(where: { $0.id == selectedMain.id }) {
            self.selectedMain = mainCats.first
            selectedSub = nil
        }
    }

    private func loadActiveCategoryProducts() async {
        guard store.searchText.isEmpty, let category = activeCategory else { return }
        isLoadingProducts = true
        let products = await store.categoryProducts(slug: category.slug)
        guard activeCategory?.id == category.id else { return }
        categoryProducts = products
        isLoadingProducts = false
    }
}

// MARK: – Category Controls

private struct MainCategoryImageTab: View {
    let category: Category
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                ProductImage(url: category.absoluteIconURL, height: 86)
                    .frame(width: 118)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(isSelected ? Color.cmPrimary : Color.clear, lineWidth: 2)
                    )

                Text(category.nameAr)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(isSelected ? Color.cmPrimary : Color.cmText)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(width: 118, height: 34, alignment: .top)
            }
            .frame(width: 126)
        }
        .buttonStyle(.plain)
    }
}

private struct SubcategoryFilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .foregroundStyle(isSelected ? .white : Color.cmText)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(isSelected ? Color.cmPrimary : Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(isSelected ? Color.clear : Color.cmBorder, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: – SubcategoryProductsView

struct SubcategoryProductsView: View {
    @EnvironmentObject private var store: AppStore
    let category: Category
    let parentCategory: Category

    @State private var products: [Product] = []
    @State private var isLoading = false
    @State private var sortOption: SortOption = .popular
    @State private var inStockOnly = false

    enum SortOption: String, CaseIterable {
        case popular  = "الأكثر طلباً"
        case newest   = "الأحدث"
        case priceAsc = "السعر ↑"
        case priceDesc = "السعر ↓"
    }

    private var siblings: [Category] {
        store.categories.filter { $0.parentId == category.parentId && $0.id != category.id }
    }

    private var displayProducts: [Product] {
        var list = inStockOnly
            ? products.filter { $0.trackStock == false || $0.stockQty > 0 }
            : products
        switch sortOption {
        case .popular:   break
        case .newest:    list.reverse()
        case .priceAsc:  list.sort { $0.effectivePrice < $1.effectivePrice }
        case .priceDesc: list.sort { $0.effectivePrice > $1.effectivePrice }
        }
        return list
    }

    var body: some View {
        VStack(spacing: 0) {
            categoryHeader
            if !siblings.isEmpty { siblingsBar }
            sortBar
            productGrid
        }
        .background(Color.cmBg)
        .navigationTitle(category.nameAr)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            isLoading = true
            products = await store.categoryProducts(slug: category.slug)
            isLoading = false
        }
        .overlay {
            if isLoading {
                ProgressView()
                    .padding(20)
                    .background(.regularMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    // MARK: – Category Header

    private var categoryHeader: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                // Breadcrumb
                Text("الأقسام / \(parentCategory.nameAr) / \(category.nameAr)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                // Badge
                Text("قسم فرعي")
                    .font(.caption.bold())
                    .foregroundStyle(Color.cmPrimary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.cmPrimaryLight)
                    .clipShape(Capsule())

                // Title
                Text(category.nameAr)
                    .font(.title2.bold())
                    .foregroundStyle(Color.cmText)

                // Parent info
                HStack(spacing: 4) {
                    Image(systemName: "folder.fill")
                        .font(.caption)
                        .foregroundStyle(Color.cmPrimary)
                    Text("ضمن \(parentCategory.nameAr)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Stats
                let productCount = isLoading ? (category.productCount ?? 0) : displayProducts.count
                let siblingLabel = siblings.isEmpty ? "" : " • \(siblings.count) قسم مشابه"
                Text("\(productCount) منتج\(siblingLabel)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            ProductImage(url: category.absoluteIconURL, height: 80)
                .frame(width: 88)
                .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .padding()
        .background(Color.white)
    }

    // MARK: – Siblings Bar

    private var siblingsBar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("أقسام أخرى في \(parentCategory.nameAr)")
                    .font(.caption.bold())
                    .foregroundStyle(Color.cmText)
                Spacer()
                Text("عرض الكل")
                    .font(.caption)
                    .foregroundStyle(Color.cmPrimary)
            }
            .padding(.horizontal)
            .padding(.top, 10)
            .padding(.bottom, 8)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(siblings) { sib in
                        NavigationLink {
                            SubcategoryProductsView(category: sib, parentCategory: parentCategory)
                        } label: {
                            Text(sib.nameAr)
                                .font(.subheadline)
                                .foregroundStyle(Color.cmText)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(Color.white)
                                .clipShape(Capsule())
                                .overlay(Capsule().stroke(Color.cmBorder, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 10)
            }
        }
        .background(Color.cmBg)
        .overlay(Rectangle().fill(Color.cmBorder).frame(height: 1), alignment: .bottom)
    }

    // MARK: – Sort Bar

    private var sortBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button { inStockOnly.toggle() } label: {
                    Text(inStockOnly ? "متوفر فقط ✓" : "\(displayProducts.count) منتج")
                        .font(.caption.bold())
                        .foregroundStyle(inStockOnly ? Color.cmPrimary : Color.cmText)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(inStockOnly ? Color.cmPrimaryLight : Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                        .overlay(
                            RoundedRectangle(cornerRadius: 7)
                                .stroke(inStockOnly ? Color.cmPrimary : Color.cmBorder, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)

                ForEach(SortOption.allCases, id: \.self) { option in
                    let selected = sortOption == option
                    Button { sortOption = option } label: {
                        Text(option.rawValue)
                            .font(.caption.bold())
                            .foregroundStyle(selected ? .white : Color.cmText)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(selected ? Color.cmPrimary : Color.white)
                            .clipShape(RoundedRectangle(cornerRadius: 7))
                            .overlay(
                                RoundedRectangle(cornerRadius: 7)
                                    .stroke(selected ? Color.clear : Color.cmBorder, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(Color.white)
        .overlay(Rectangle().fill(Color.cmBorder).frame(height: 1), alignment: .top)
        .overlay(Rectangle().fill(Color.cmBorder).frame(height: 1), alignment: .bottom)
    }

    // MARK: – Product Grid

    private var productGrid: some View {
        ScrollView {
            if displayProducts.isEmpty && !isLoading {
                EmptyState(
                    title: "لا توجد منتجات",
                    subtitle: "لم نجد منتجات في هذا القسم حالياً",
                    systemImage: "tray"
                )
            } else {
                LazyVGrid(
                    columns: [GridItem(.flexible()), GridItem(.flexible())],
                    spacing: 12
                ) {
                    ForEach(displayProducts) { product in
                        NavigationLink {
                            ProductDetailView(product: product)
                        } label: {
                            ProductCard(product: product)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
        }
    }
}
