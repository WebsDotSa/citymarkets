import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: AppStore
    @State private var isShowingLocation = false

    private var mainCategories: [Category] {
        store.categories
            .filter { $0.parentId == nil }
            .sorted { ($0.sortOrder ?? 99) < ($1.sortOrder ?? 99) }
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Color.cmBg.ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        CityMarketsHeader(cartCount: store.cartCount)
                            .environmentObject(store)

                        VStack(spacing: 20) {
                            // Vendors section
                            if !store.vendors.isEmpty {
                                vendorsSection
                            }

                            // Hero banner
                            if !store.banners.isEmpty {
                                BannerCarousel(banners: store.banners)
                                    .padding(.horizontal, 16)
                            }

                            // Quick action grid
                            quickActionsGrid
                                .padding(.horizontal, 16)

                            // Stats strip
                            statsStrip
                                .padding(.horizontal, 16)

                            // Location button
                            locationButton
                                .padding(.horizontal, 16)

                            // Featured products
                            if !store.featuredProducts.isEmpty {
                                featuredSection
                            }

                            // Category group sections
                            ForEach(mainCategories) { main in
                                CategoryGroupSection(mainCategory: main)
                                    .environmentObject(store)
                            }
                        }
                        .padding(.top, 16)
                        .padding(.bottom, store.cartCount > 0 ? 100 : 28)
                    }
                }

                if store.cartCount > 0 {
                    MiniCartBar(count: store.cartCount, subtotal: store.cartSubtotal)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .overlay { LoadingOverlay(isVisible: store.isLoading) }
            .sheet(isPresented: $isShowingLocation) {
                LocationSheet().environmentObject(store)
            }
            .alert("أسواق سيتي", isPresented: Binding(
                get: { store.message != nil },
                set: { if !$0 { store.message = nil } }
            )) {
                Button("حسناً", role: .cancel) { store.message = nil }
            } message: {
                Text(store.message ?? "")
            }
        }
    }

    // MARK: – Vendors Section

    private var vendorsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                NavigationLink {
                    AllVendorsView().environmentObject(store)
                } label: {
                    Text("عرض الكل")
                        .font(.subheadline)
                        .foregroundStyle(Color.cmPrimary)
                }
                Spacer()
                Text("تسوق من المتاجر")
                    .font(.title3.bold())
                    .foregroundStyle(Color.cmText)
            }
            .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(store.vendors) { vendor in
                        VendorCard(vendor: vendor)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
        }
    }

    // MARK: – Quick Actions (2×2 Grid)

    private var quickActionsGrid: some View {
        let actions: [(title: String, subtitle: String, colors: [Color], icon: String, dest: AnyView)] = [
            ("الأكثر مبيعاً", "المنتجات الأشهر", [Color(hex: "FF8C00"), Color(hex: "FF5722")], "flame.fill",
             AnyView(SubcategoryProductsListView(title: "الأكثر مبيعاً", products: store.products).environmentObject(store))),
            ("عروض اليوم", "خصومات حصرية", [Color(hex: "E53935"), Color(hex: "C62828")], "tag.fill",
             AnyView(SubcategoryProductsListView(title: "عروض اليوم", products: store.featuredProducts).environmentObject(store))),
            ("نقاط الولاء", "اكسب وافدِ", [Color(hex: "7B1FA2"), Color(hex: "4A148C")], "rosette",
             AnyView(EmptyState(title: "نقاط الولاء", subtitle: "سجل دخولك لعرض نقاطك", systemImage: "rosette"))),
            ("جديدنا", "وصل حديثاً", [Color(hex: "1B5E20"), Color(hex: "2E7D32")], "sparkles",
             AnyView(SubcategoryProductsListView(title: "جديدنا", products: store.featuredProducts).environmentObject(store)))
        ]

        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            ForEach(Array(actions.enumerated()), id: \.offset) { _, action in
                NavigationLink(destination: action.dest) {
                    ZStack(alignment: .bottomLeading) {
                        LinearGradient(colors: action.colors, startPoint: .topTrailing, endPoint: .bottomLeading)
                        VStack(alignment: .leading, spacing: 4) {
                            Spacer()
                            Image(systemName: action.icon)
                                .font(.system(size: 26, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.9))
                            Text(action.title)
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.white)
                            Text(action.subtitle)
                                .font(.caption)
                                .foregroundStyle(.white.opacity(0.8))
                        }
                        .padding(14)
                    }
                    .frame(height: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: – Stats Strip

    private var statsStrip: some View {
        let stats: [(icon: String, value: String, label: String)] = [
            ("checkmark.shield.fill", "100%", "أمان مضمون"),
            ("bolt.car.fill", "40 دقيقة", "توصيل سريع"),
            ("percent", "يومياً", "خصومات"),
            ("headphones", "24/7", "دعم متواصل")
        ]

        return ZStack {
            LinearGradient(colors: [Color(hex: "1B5E20"), Color(hex: "2E7D32")], startPoint: .topLeading, endPoint: .bottomTrailing)
                .clipShape(RoundedRectangle(cornerRadius: 18))

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 0) {
                ForEach(Array(stats.enumerated()), id: \.offset) { idx, stat in
                    VStack(spacing: 5) {
                        Image(systemName: stat.icon)
                            .font(.system(size: 22, weight: .medium))
                            .foregroundStyle(.white.opacity(0.85))
                        Text(stat.value)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(.white)
                        Text(stat.label)
                            .font(.caption)
                            .foregroundStyle(.white.opacity(0.75))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .overlay(alignment: .trailing) {
                        if idx % 2 == 0 {
                            Rectangle().fill(.white.opacity(0.2)).frame(width: 1)
                        }
                    }
                    .overlay(alignment: .bottom) {
                        if idx < 2 {
                            Rectangle().fill(.white.opacity(0.2)).frame(height: 1)
                        }
                    }
                }
            }
        }
    }

    // MARK: – Location Button

    private var locationButton: some View {
        Button { isShowingLocation = true } label: {
            HStack(spacing: 14) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(Color.cmPrimary)

                VStack(alignment: .leading, spacing: 3) {
                    Text("موقع التوصيل")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(store.deliveryLocationTitle)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.cmText)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "chevron.left")
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
            }
            .padding(14)
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.cmBorder, lineWidth: 1))
            .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
        }
        .buttonStyle(.plain)
        .environment(\.layoutDirection, .leftToRight)
    }

    // MARK: – Featured Products

    private var featuredSection: some View {
        VStack(alignment: .trailing, spacing: 10) {
            HStack {
                NavigationLink {
                    SubcategoryProductsListView(title: "منتجات مميزة", products: store.featuredProducts)
                        .environmentObject(store)
                } label: {
                    Text("عرض الكل")
                        .font(.subheadline)
                        .foregroundStyle(Color.cmPrimary)
                }
                Spacer()
                Text("منتجات مميزة")
                    .font(.title3.bold())
                    .foregroundStyle(Color.cmText)
            }
            .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(store.featuredProducts.prefix(10)) { product in
                        NavigationLink {
                            ProductDetailView(product: product)
                        } label: {
                            CompactProductCard(product: product)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
        }
    }
}

// MARK: – VendorCard

private struct VendorCard: View {
    let vendor: Vendor

    var body: some View {
        VStack(alignment: .center, spacing: 8) {
            ZStack(alignment: .topTrailing) {
                Group {
                    if let url = vendor.absoluteLogoURL {
                        AsyncImage(url: url) { phase in
                            if case .success(let img) = phase {
                                img.resizable().scaledToFill()
                            } else {
                                vendorFallback
                            }
                        }
                    } else {
                        vendorFallback
                    }
                }
                .frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 16))

                Text(vendor.isOpen ? "مفتوح" : "مغلق")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(vendor.isOpen ? Color.cmPrimary : Color.gray)
                    .clipShape(Capsule())
                    .offset(x: 4, y: -4)
            }

            Text(vendor.name)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.cmText)
                .lineLimit(1)
                .frame(width: 80)
        }
    }

    private var vendorFallback: some View {
        ZStack {
            Color(hex: vendor.primaryColor.isEmpty ? "1B5E20" : vendor.primaryColor).opacity(0.15)
            Text(String(vendor.name.prefix(1)))
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(Color(hex: vendor.primaryColor.isEmpty ? "1B5E20" : vendor.primaryColor))
        }
    }
}

// MARK: – CompactProductCard

private struct CompactProductCard: View {
    let product: Product

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            ProductImage(url: product.absoluteImageURL, height: 120)
                .frame(width: 130)
                .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .trailing, spacing: 4) {
                Text(product.nameAr)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.cmText)
                    .lineLimit(2)
                    .multilineTextAlignment(.trailing)

                Text(product.effectivePrice.currencyText)
                    .font(.subheadline.bold())
                    .foregroundStyle(Color.cmPrimary)
            }
            .frame(width: 130, alignment: .trailing)
        }
        .padding(10)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.cmBorder, lineWidth: 1))
        .shadow(color: .black.opacity(0.04), radius: 6, x: 0, y: 2)
    }
}

// MARK: – CategoryGroupSection

struct CategoryGroupSection: View {
    @EnvironmentObject private var store: AppStore
    let mainCategory: Category

    private var subCategories: [Category] {
        store.categories
            .filter { $0.parentId == mainCategory.id }
            .prefix(8)
            .map { $0 }
    }

    var body: some View {
        guard !subCategories.isEmpty else { return AnyView(EmptyView()) }

        return AnyView(
            VStack(alignment: .trailing, spacing: 10) {
                HStack {
                    NavigationLink {
                        CatalogView()
                    } label: {
                        Text("عرض الكل")
                            .font(.subheadline)
                            .foregroundStyle(Color.cmPrimary)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(mainCategory.nameAr)
                            .font(.title3.bold())
                            .foregroundStyle(Color.cmText)
                        if let count = mainCategory.descendantCount ?? mainCategory.productCount, count > 0 {
                            Text("\(count) منتج")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.horizontal, 16)

                LazyVGrid(
                    columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible()),
                        GridItem(.flexible()),
                        GridItem(.flexible())
                    ],
                    spacing: 10
                ) {
                    ForEach(subCategories) { sub in
                        NavigationLink {
                            SubcategoryProductsView(category: sub, parentCategory: mainCategory)
                        } label: {
                            MiniCategoryTile(category: sub)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
        )
    }
}

// MARK: – MiniCategoryTile (4-col)

private struct MiniCategoryTile: View {
    let category: Category

    var body: some View {
        VStack(spacing: 6) {
            ProductImage(url: category.absoluteIconURL, height: 64)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 10))

            Text(category.nameAr)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.cmText)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.cmBorder, lineWidth: 1))
        .shadow(color: .black.opacity(0.03), radius: 4, x: 0, y: 2)
    }
}

// MARK: – AllVendorsView

struct AllVendorsView: View {
    @EnvironmentObject private var store: AppStore

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                ForEach(store.vendors) { vendor in
                    VStack(spacing: 8) {
                        Group {
                            if let url = vendor.absoluteLogoURL {
                                AsyncImage(url: url) { phase in
                                    if case .success(let img) = phase {
                                        img.resizable().scaledToFill()
                                    } else {
                                        fallbackLogo(vendor: vendor)
                                    }
                                }
                            } else {
                                fallbackLogo(vendor: vendor)
                            }
                        }
                        .frame(width: 90, height: 90)
                        .clipShape(RoundedRectangle(cornerRadius: 18))

                        Text(vendor.name)
                            .font(.caption.bold())
                            .foregroundStyle(Color.cmText)
                            .lineLimit(1)
                    }
                }
            }
            .padding()
        }
        .background(Color.cmBg)
        .navigationTitle("المتاجر")
    }

    private func fallbackLogo(vendor: Vendor) -> some View {
        ZStack {
            Color(hex: vendor.primaryColor.isEmpty ? "1B5E20" : vendor.primaryColor).opacity(0.15)
            Text(String(vendor.name.prefix(1)))
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(Color(hex: vendor.primaryColor.isEmpty ? "1B5E20" : vendor.primaryColor))
        }
    }
}

// MARK: – SubcategoryProductsListView (simple list for quick actions)

struct SubcategoryProductsListView: View {
    @EnvironmentObject private var store: AppStore
    let title: String
    let products: [Product]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(products) { product in
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
        .background(Color.cmBg)
        .navigationTitle(title)
    }
}

// MARK: – LocationSheet

struct LocationSheet: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) private var dismiss
    @State private var city = ""
    @State private var district = ""
    @State private var street = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("موقع التوصيل") {
                    TextField("المدينة", text: $city)
                    TextField("الحي", text: $district)
                    TextField("الشارع أو الوصف", text: $street)
                }
                Section {
                    Button {
                        store.updateDeliveryLocation(city: city, district: district, street: street)
                        dismiss()
                    } label: {
                        Label("حفظ الموقع", systemImage: "location.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
            }
            .navigationTitle("تحديد الموقع")
        }
    }
}
