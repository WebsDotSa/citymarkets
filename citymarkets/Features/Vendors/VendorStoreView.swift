import SwiftUI

struct VendorStoreView: View {
    @EnvironmentObject private var store: AppStore
    let vendor: Vendor

    @State private var loadedVendor: Vendor?
    @State private var products: [Product] = []
    @State private var isLoading = true

    private var currentVendor: Vendor {
        loadedVendor ?? vendor
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 16) {
                vendorHero
                vendorInfoBar
                productsSection
            }
            .padding(.bottom, 24)
        }
        .background(Color.cmBg.ignoresSafeArea())
        .navigationTitle(currentVendor.name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: vendor.slug) { await loadVendorStore() }
        .refreshable { await loadVendorStore() }
    }

    private var vendorHero: some View {
        ZStack(alignment: .bottomLeading) {
            ProductImage(url: currentVendor.absoluteBannerURL ?? currentVendor.absoluteLogoURL, height: 190)
                .frame(maxWidth: .infinity)
                .background(vendorColor.opacity(0.12))

            LinearGradient(colors: [.clear, .black.opacity(0.62)], startPoint: .top, endPoint: .bottom)

            HStack(alignment: .bottom, spacing: 12) {
                VendorLogo(vendor: currentVendor, size: 74)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.white, lineWidth: 2))

                VStack(alignment: .leading, spacing: 5) {
                    Text(currentVendor.name)
                        .font(.title3.bold())
                        .foregroundStyle(.white)
                        .lineLimit(2)
                    if let nameEn = currentVendor.nameEn, !nameEn.isEmpty {
                        Text(nameEn)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.88))
                            .lineLimit(1)
                    }
                    Text(currentVendor.description ?? "منتجات مختارة من المتجر")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.86))
                        .lineLimit(2)
                }

                Spacer(minLength: 0)
            }
            .padding(16)
        }
        .frame(height: 190)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private var vendorInfoBar: some View {
        HStack(spacing: 10) {
            VendorInfoPill(title: currentVendor.isOpen ? "مفتوح" : "مغلق", subtitle: "حالة المتجر", systemImage: currentVendor.isOpen ? "checkmark.circle.fill" : "clock.fill", tint: currentVendor.isOpen ? Color.cmPrimary : Color(hex: "F59E0B"))
            VendorInfoPill(title: "\(products.count)", subtitle: "منتج", systemImage: "shippingbox.fill", tint: Color(hex: "2563EB"))
            VendorInfoPill(title: vendorTypeText, subtitle: "التصنيف", systemImage: "tag.fill", tint: vendorColor)
        }
        .padding(.horizontal, 16)
    }

    private var productsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("منتجات المتجر")
                        .font(.headline.bold())
                        .foregroundStyle(Color.cmText)
                    Text(currentVendor.slug)
                        .font(.caption)
                        .foregroundStyle(Color.cmTextMuted)
                }
                Spacer()
            }
            .padding(.horizontal, 16)

            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 44)
            } else if products.isEmpty {
                EmptyState(title: "لا توجد منتجات", subtitle: "لم يتم نشر منتجات لهذا المتجر بعد", systemImage: "shippingbox")
                    .padding(.horizontal, 16)
            } else {
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
                .padding(.horizontal, 16)
            }
        }
    }

    private var vendorColor: Color {
        Color(hex: currentVendor.primaryColor.replacingOccurrences(of: "#", with: ""))
    }

    private var vendorTypeText: String {
        switch currentVendor.type {
        case "food_beverage": "أطعمة ومشروبات"
        case "fashion": "أزياء"
        case "gifts": "هدايا"
        default: currentVendor.type
        }
    }

    private func loadVendorStore() async {
        isLoading = true
        async let vendorTask = store.vendor(slug: vendor.slug)
        async let productsTask = store.vendorProducts(slug: vendor.slug)
        loadedVendor = await vendorTask
        products = await productsTask
        isLoading = false
    }
}

struct VendorLogo: View {
    let vendor: Vendor
    let size: CGFloat

    var body: some View {
        Group {
            if let url = vendor.absoluteLogoURL {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill()
                    } else {
                        fallbackLogo
                    }
                }
            } else {
                fallbackLogo
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var fallbackLogo: some View {
        ZStack {
            Color(hex: vendor.primaryColor.replacingOccurrences(of: "#", with: "")).opacity(0.16)
            Text(String(vendor.name.prefix(1)))
                .font(.system(size: size * 0.38, weight: .bold))
                .foregroundStyle(Color(hex: vendor.primaryColor.replacingOccurrences(of: "#", with: "")))
        }
    }
}

private struct VendorInfoPill: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let tint: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.cmText)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(Color.cmTextMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.cmBorder, lineWidth: 1))
    }
}
