import SwiftUI

struct ProductDetailView: View {
    @EnvironmentObject private var store: AppStore
    let product: Product

    @State private var quantity = 1
    @State private var showLoginPrompt = false
    @State private var detailProduct: Product?
    @State private var relatedProducts: [Product] = []
    @State private var isLoadingDetail = false

    private var displayProduct: Product {
        detailProduct ?? product
    }

    private var ratingValue: Double {
        displayProduct.avgRating ?? product.avgRating ?? 0
    }

    private var reviewsCount: Int {
        displayProduct.reviewsCount ?? product.reviewsCount ?? 0
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ProductImage(url: displayProduct.absoluteImageURL, height: 260)

                productInfo
                purchaseControls
                RatingsSummarySection(rating: ratingValue, reviewsCount: reviewsCount)

                if isLoadingDetail && relatedProducts.isEmpty {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 24)
                } else if !relatedProducts.isEmpty {
                    RelatedProductsSection(products: relatedProducts)
                }
            }
            .padding(.bottom, 20)
        }
        .background(Color.cmBg)
        .navigationTitle("تفاصيل المنتج")
        .sheet(isPresented: $showLoginPrompt) {
            PhoneLoginSheet(isPresented: $showLoginPrompt)
        }
        .task(id: product.id) {
            await loadProductDetail()
        }
    }

    private var productInfo: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let vendorName = displayProduct.vendorName ?? product.vendorName {
                if let vendorSlug = displayProduct.vendorSlug ?? product.vendorSlug,
                   let vendor = store.vendors.first(where: { $0.slug == vendorSlug }) {
                    NavigationLink {
                        VendorStoreView(vendor: vendor)
                            .environmentObject(store)
                    } label: {
                        Label(vendorName, systemImage: "storefront.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.cmPrimary)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(vendorName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.cmPrimary)
                }
            }

            Text(displayProduct.nameAr)
                .font(.title2.bold())
                .foregroundStyle(Color.cmText)

            if let description = displayProduct.description, !description.isEmpty {
                Text(description)
                    .font(.body)
                    .foregroundStyle(Color.cmTextMuted)
            }

            PriceView(product: displayProduct)

            Text(displayProduct.trackStock == false || displayProduct.stockQty > 0 ? "متوفر" : "غير متوفر")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(displayProduct.trackStock == false || displayProduct.stockQty > 0 ? Color.cmPrimary : Color.cmSale)
        }
        .padding(.horizontal)
    }

    private var purchaseControls: some View {
        HStack {
            Stepper("الكمية: \(quantity)", value: $quantity, in: 1...99)
            Button {
                guard store.user != nil else { showLoginPrompt = true; return }
                Task { await store.addToCart(displayProduct, quantity: quantity) }
            } label: {
                Label("أضف للسلة", systemImage: "cart.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
        }
        .padding()
        .background(Color.white)
    }

    private func loadProductDetail() async {
        isLoadingDetail = true
        defer { isLoadingDetail = false }

        guard let response = await store.productDetail(id: product.id) else { return }
        detailProduct = response.data
        relatedProducts = (response.related ?? [])
            .filter { $0.id != product.id }
    }
}

private struct RatingsSummarySection: View {
    let rating: Double
    let reviewsCount: Int

    private var normalizedRating: Double {
        min(max(rating, 0), 5)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("التقييمات")
                    .font(.title3.bold())
                    .foregroundStyle(Color.cmText)
                Spacer()
                Text(reviewsCount > 0 ? "\(reviewsCount) تقييم" : "لا توجد تقييمات")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 12) {
                Text(String(format: "%.1f", normalizedRating))
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(Color.cmText)
                    .monospacedDigit()

                VStack(alignment: .leading, spacing: 6) {
                    StarRatingView(rating: normalizedRating)
                    Text(reviewsCount > 0 ? "متوسط تقييم العملاء" : "لم يتم تقييم هذا المنتج بعد")
                        .font(.subheadline)
                        .foregroundStyle(Color.cmTextMuted)
                }

                Spacer()
            }
            .padding(14)
            .background(Color.cmBg)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .padding()
        .background(Color.white)
    }
}

private struct StarRatingView: View {
    let rating: Double

    var body: some View {
        HStack(spacing: 3) {
            ForEach(1...5, id: \.self) { index in
                Image(systemName: starName(for: index))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color(hex: "F5A623"))
            }
        }
        .accessibilityLabel("\(rating, specifier: "%.1f") من 5")
    }

    private func starName(for index: Int) -> String {
        let value = Double(index)
        if rating >= value { return "star.fill" }
        if rating >= value - 0.5 { return "star.leadinghalf.filled" }
        return "star"
    }
}

private struct RelatedProductsSection: View {
    let products: [Product]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("منتجات مشابهة")
                .font(.title3.bold())
                .foregroundStyle(Color.cmText)
                .padding(.horizontal)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(products.prefix(10)) { product in
                        NavigationLink {
                            ProductDetailView(product: product)
                        } label: {
                            ProductCard(product: product)
                                .frame(width: 168)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}
