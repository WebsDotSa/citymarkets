import SwiftUI

struct ProductSection: View {
    let title: String
    let products: [Product]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.title3.bold())
                .padding(.horizontal)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(products.prefix(12)) { product in
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

struct ProductCard: View {
    @EnvironmentObject private var store: AppStore
    let product: Product

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ProductImage(url: product.absoluteImageURL, height: 130)
            VStack(alignment: .leading, spacing: 6) {
                Text(product.nameAr)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.cmText)
                    .lineLimit(2)
                    .frame(minHeight: 38, alignment: .topLeading)
                if let vendorName = product.vendorName {
                    Text(vendorName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                PriceView(product: product)
                Button {
                    Task { await store.addToCart(product) }
                } label: {
                    Label("إضافة", systemImage: "plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle(compact: true))
            }
            .padding([.horizontal, .bottom], 10)
        }
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.cmBorder, lineWidth: 1)
        )
    }
}

struct ProductImage: View {
    let url: URL?
    let height: CGFloat

    var body: some View {
        ZStack {
            Color.cmPrimaryLight
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:
                        ProgressView()
                    case .success(let image):
                        image.resizable().scaledToFit().padding(10)
                    case .failure:
                        Image(systemName: "photo")
                            .font(.largeTitle)
                            .foregroundStyle(Color.cmPrimary)
                    @unknown default:
                        EmptyView()
                    }
                }
            } else {
                Image(systemName: "basket")
                    .font(.largeTitle)
                    .foregroundStyle(Color.cmPrimary)
            }
        }
        .frame(height: height)
    }
}

struct PriceView: View {
    let product: Product

    var body: some View {
        HStack(spacing: 6) {
            Text(product.effectivePrice.currencyText)
                .font(.headline.bold())
                .foregroundStyle(Color.cmPrimary)
            if let discount = product.discountPrice, discount < product.price {
                Text(product.price.currencyText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .strikethrough()
            }
        }
    }
}

struct CategoryTile: View {
    let category: Category

    var body: some View {
        VStack(spacing: 8) {
            ProductImage(url: category.absoluteIconURL, height: 72)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            Text(category.nameAr)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.cmText)
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .frame(width: 92, height: 34)
        }
        .frame(width: 104)
    }
}

struct FilterChip: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(isSelected ? Color.white : Color.cmText)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(isSelected ? Color.cmPrimary : Color.white)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(Color.cmBorder, lineWidth: isSelected ? 0 : 1))
        }
        .buttonStyle(.plain)
    }
}

struct MiniCartBar: View {
    let count: Int
    let subtotal: Double

    var body: some View {
        NavigationLink {
            CartView()
        } label: {
            HStack {
                Label("\(count) منتجات", systemImage: "cart.fill")
                Spacer()
                Text(subtotal.currencyText)
                    .font(.headline)
            }
            .foregroundStyle(.white)
            .padding()
            .background(Color.cmCartBar)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding()
        }
    }
}

struct CartItemRow: View {
    @EnvironmentObject private var store: AppStore
    let item: CartItem

    var body: some View {
        HStack(spacing: 12) {
            ProductImage(url: item.absoluteImageURL, height: 64)
                .frame(width: 64)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 5) {
                Text(item.nameAr)
                    .font(.subheadline.weight(.semibold))
                if let vendorName = item.vendorName {
                    Text(vendorName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(item.total.currencyText)
                    .font(.subheadline.bold())
                    .foregroundStyle(Color.cmPrimary)
            }
            Spacer()
            Stepper("\(item.quantity)", value: Binding(
                get: { item.quantity },
                set: { newValue in Task { await store.updateCartItem(item, quantity: newValue) } }
            ), in: 0...99)
            .labelsHidden()
        }
        .padding(.vertical, 4)
    }
}

struct EmptyState: View {
    let title: String
    let subtitle: String
    let systemImage: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 42))
                .foregroundStyle(Color.cmPrimary)
            Text(title)
                .font(.headline)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }
}

struct LoadingOverlay: View {
    let isVisible: Bool

    var body: some View {
        if isVisible {
            ProgressView()
                .padding(18)
                .background(.regularMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(compact ? .subheadline.weight(.semibold) : .headline)
            .foregroundStyle(.white)
            .padding(.vertical, compact ? 8 : 12)
            .padding(.horizontal, 12)
            .background(configuration.isPressed ? Color.cmPrimaryDark : Color.cmPrimary)
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
