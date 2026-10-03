import SwiftUI

#if canImport(MoyasarSdk)
import MoyasarSdk
import PassKit
#endif

struct MoyasarPaymentSheet: View {
    @Environment(\.dismiss) private var dismiss

    let paymentMethod: String
    let amount: Double
    let orderId: String
    let description: String
    var showsNavigationChrome = true
    let completion: (String) -> Void

    @State private var resultMessage: String?

    var body: some View {
        Group {
            if showsNavigationChrome {
                NavigationStack {
                    paymentContainer
                        .navigationTitle("الدفع الإلكتروني")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            Button("إغلاق") { dismiss() }
                        }
                }
            } else {
                paymentContainer
            }
        }
    }

    private var paymentContainer: some View {
        VStack(spacing: 16) {
            #if canImport(MoyasarSdk)
            paymentContent
            #else
            missingSDKContent
            #endif
        }
        .padding(showsNavigationChrome ? 16 : 0)
        .background {
            if showsNavigationChrome {
                Color.cmBg.ignoresSafeArea()
            }
        }
        .alert("أسواق سيتي", isPresented: Binding(
            get: { resultMessage != nil },
            set: { if !$0 { resultMessage = nil } }
        )) {
            Button("حسناً", role: .cancel) {
                let message = resultMessage ?? ""
                resultMessage = nil
                if showsNavigationChrome { dismiss() }
                completion(message)
            }
        } message: {
            Text(resultMessage ?? "")
        }
    }

    private var missingSDKContent: some View {
        PaymentUnavailableView(
            title: "حزمة Moyasar غير مضافة",
            subtitle: "أضف Swift Package من Xcode لتفعيل الدفع الأصلي داخل التطبيق."
        )
    }

    #if canImport(MoyasarSdk)
    @ViewBuilder
    private var paymentContent: some View {
        switch paymentMethod {
        case "apple_pay":
            ApplePayCheckoutButton(paymentRequest: paymentRequest, amount: amount, completion: finish)
                .frame(height: 48)
                .padding(.top, 12)
            Text("أكمل الدفع باستخدام Apple Pay")
                .font(.subheadline)
                .foregroundStyle(Color.cmTextMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
            if showsNavigationChrome {
                Spacer()
            }
        default:
            CreditCardView(request: paymentRequest) { result in
                handleCardResult(result)
            }
        }
    }

    private var paymentRequest: PaymentRequest {
        PaymentRequest(
            apiKey: MoyasarConfig.publishableKey,
            amount: MoyasarConfig.halalas(from: amount),
            currency: MoyasarConfig.currency,
            description: description,
            metadata: ["order_id": orderId],
            manual: false,
            saveCard: false,
            allowedNetworks: allowedNetworks
        )
    }

    private var allowedNetworks: [CreditCardNetwork] {
        switch paymentMethod {
        case "mada":
            return [.mada]
        case "visa":
            return [.visa]
        case "mastercard":
            return [.mastercard]
        default:
            return [.mada, .visa, .mastercard, .amex]
        }
    }

    private func handleCardResult(_ result: PaymentResult) {
        switch result {
        case .completed(let payment):
            finish(message(for: payment))
        case .saveOnlyToken:
            finish("تم حفظ البطاقة بنجاح")
        case .failed(let error):
            finish("تعذر إتمام الدفع: \(error.localizedDescription)")
        case .canceled:
            if showsNavigationChrome {
                dismiss()
            } else {
                finish("تم إلغاء الدفع")
            }
        }
    }

    private func finish(_ message: String) {
        resultMessage = message
    }

    private func message(for payment: ApiPayment) -> String {
        switch payment.status {
        case .paid:
            "تم الدفع بنجاح عبر ميسر"
        case .authorized:
            "تم تفويض الدفع عبر ميسر"
        case .failed:
            "فشل الدفع عبر ميسر"
        default:
            "حالة الدفع: \(payment.status)"
        }
    }
    #endif
}

private struct PaymentUnavailableView: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "creditcard.trianglebadge.exclamationmark")
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(Color.cmPrimary)
            Text(title)
                .font(.headline.bold())
                .foregroundStyle(Color.cmText)
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(Color.cmTextMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct MoyasarPreparedPayment {
    let amount: Double
    let orderId: String
    let description: String
    let idempotencyKey: String
}

#if canImport(MoyasarSdk)

// Extracts a human-readable Arabic error message from Moyasar API errors.
private extension Error {
    var applePayFailureMessage: String {
        guard let err = self as? MoyasarError else { return localizedDescription }
        switch err {
        case .apiError(let apiError):
            if let msg = apiError.message, !msg.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return msg
            }
            if case .single(let detail) = apiError.errors,
               let detail,
               !detail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return detail
            }
            return "خطأ في عملية الدفع"
        case .unexpectedError(let msg):
            return msg.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? localizedDescription : msg
        case .networkError(let underlying):
            return "خطأ في الشبكة: \(underlying.localizedDescription)"
        case .invalidApiKey:
            return "إعداد الدفع غير صحيح، تواصل مع الدعم"
        default:
            return localizedDescription
        }
    }
}

struct MoyasarDeferredApplePayButton: UIViewRepresentable {
    let preparePayment: () async -> MoyasarPreparedPayment?
    let completion: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(preparePayment: preparePayment, completion: completion)
    }

    func makeUIView(context: Context) -> PKPaymentButton {
        let button = PKPaymentButton(paymentButtonType: .buy, paymentButtonStyle: .black)
        button.addTarget(context.coordinator, action: #selector(Coordinator.pay), for: .touchUpInside)
        return button
    }

    func updateUIView(_ uiView: PKPaymentButton, context: Context) {}

    final class Coordinator: NSObject, PKPaymentAuthorizationControllerDelegate {
        private let preparePayment: () async -> MoyasarPreparedPayment?
        private let completion: (String) -> Void
        private let supportedNetworks: [PKPaymentNetwork] = [.mada, .visa, .masterCard, .amex]
        private var controller: PKPaymentAuthorizationController?
        private var paymentRequest: PaymentRequest?
        private var amount = 0.0
        private var didCompletePayment = false

        init(preparePayment: @escaping () async -> MoyasarPreparedPayment?, completion: @escaping (String) -> Void) {
            self.preparePayment = preparePayment
            self.completion = completion
        }

        @objc func pay() {
            prepareAndPresent()
        }

        func prepareAndPresent() {
            Task { @MainActor in
                guard let prepared = await preparePayment() else { return }
                didCompletePayment = false
                amount = prepared.amount
                paymentRequest = PaymentRequest(
                    apiKey: MoyasarConfig.publishableKey,
                    amount: MoyasarConfig.halalas(from: prepared.amount),
                    currency: MoyasarConfig.currency,
                    description: prepared.description,
                    metadata: ["order_id": prepared.orderId],
                    manual: false,
                    saveCard: false,
                    allowedNetworks: [.mada, .visa, .mastercard, .amex]
                )
                present()
            }
        }

        private func present() {
            guard PKPaymentAuthorizationController.canMakePayments(usingNetworks: supportedNetworks) else {
                completion("Apple Pay غير متاح أو لا توجد بطاقة مدعومة في المحفظة")
                return
            }

            let request = PKPaymentRequest()
            request.paymentSummaryItems = [
                PKPaymentSummaryItem(label: "أسواق سيتي", amount: NSDecimalNumber(value: amount), type: .final)
            ]
            request.merchantIdentifier = MoyasarConfig.merchantIdentifier
            request.countryCode = MoyasarConfig.countryCode
            request.currencyCode = MoyasarConfig.currency
            request.supportedNetworks = supportedNetworks
            request.merchantCapabilities = [.threeDSecure, .credit, .debit]

            controller = PKPaymentAuthorizationController(paymentRequest: request)
            controller?.delegate = self
            controller?.present { [weak self] presented in
                if !presented {
                    DispatchQueue.main.async {
                        self?.completion("تعذر فتح Apple Pay")
                    }
                }
            }
        }

        func paymentAuthorizationController(
            _ controller: PKPaymentAuthorizationController,
            didAuthorizePayment payment: PKPayment,
            handler completionHandler: @escaping (PKPaymentAuthorizationResult) -> Void
        ) {
            guard let paymentRequest else {
                completionHandler(PKPaymentAuthorizationResult(status: .failure, errors: []))
                didCompletePayment = true
                completion("تعذر تجهيز Apple Pay")
                return
            }

            do {
                try ApplePayService(apiKey: paymentRequest.apiKey).authorizePayment(
                    request: paymentRequest,
                    token: payment.token
                ) { result in
                    // URLSession callbacks run on a background thread — dispatch to main
                    // before touching any SwiftUI state or @MainActor properties.
                    DispatchQueue.main.async { [weak self] in
                        switch result {
                        case .success(let apiPayment):
                            if apiPayment.status == .paid || apiPayment.status == .authorized {
                                self?.didCompletePayment = true
                                completionHandler(PKPaymentAuthorizationResult(status: .success, errors: []))
                                self?.completion("تم الدفع بنجاح عبر Apple Pay")
                            } else {
                                self?.didCompletePayment = true
                                let err = NSError(
                                    domain: "MoyasarApplePay", code: -1,
                                    userInfo: [NSLocalizedDescriptionKey: "فشل الدفع عبر Apple Pay"]
                                )
                                completionHandler(PKPaymentAuthorizationResult(status: .failure, errors: [err]))
                                self?.completion("فشل الدفع عبر Apple Pay")
                            }
                        case .error(let error):
                            self?.didCompletePayment = true
                            completionHandler(PKPaymentAuthorizationResult(status: .failure, errors: [error]))
                            self?.completion("تعذر إتمام Apple Pay: \(error.applePayFailureMessage)")
                        @unknown default:
                            self?.didCompletePayment = true
                            let err = NSError(
                                domain: "MoyasarApplePay", code: -1,
                                userInfo: [NSLocalizedDescriptionKey: "حالة دفع غير متوقعة"]
                            )
                            completionHandler(PKPaymentAuthorizationResult(status: .failure, errors: [err]))
                            self?.completion("تعذر إتمام Apple Pay")
                        }
                    }
                }
            } catch {
                // authorizePayment throws synchronously (token encoding) — still on main thread here.
                didCompletePayment = true
                completionHandler(PKPaymentAuthorizationResult(status: .failure, errors: [error]))
                completion("تعذر تجهيز Apple Pay: \(error.applePayFailureMessage)")
            }
        }

        func paymentAuthorizationControllerDidFinish(_ controller: PKPaymentAuthorizationController) {
            if !didCompletePayment {
                didCompletePayment = true
                completion("تم إلغاء الدفع")
            }
            controller.dismiss(completion: nil)
        }
    }
}

private struct ApplePayCheckoutButton: UIViewRepresentable {
    let paymentRequest: PaymentRequest
    let amount: Double
    let completion: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(paymentRequest: paymentRequest, amount: amount, completion: completion)
    }

    func makeUIView(context: Context) -> PKPaymentButton {
        let button = PKPaymentButton(paymentButtonType: .buy, paymentButtonStyle: .black)
        button.addTarget(context.coordinator, action: #selector(Coordinator.pay), for: .touchUpInside)
        return button
    }

    func updateUIView(_ uiView: PKPaymentButton, context: Context) {}

    final class Coordinator: NSObject, PKPaymentAuthorizationControllerDelegate {
        private let paymentRequest: PaymentRequest
        private let amount: Double
        private let completion: (String) -> Void
        private let applePayService: ApplePayService
        private let supportedNetworks: [PKPaymentNetwork] = [.mada, .visa, .masterCard, .amex]
        private var controller: PKPaymentAuthorizationController?
        private var didCompletePayment = false

        init(paymentRequest: PaymentRequest, amount: Double, completion: @escaping (String) -> Void) {
            self.paymentRequest = paymentRequest
            self.amount = amount
            self.completion = completion
            self.applePayService = ApplePayService(apiKey: paymentRequest.apiKey)
        }

        @objc func pay() {
            present()
        }

        func present() {
            guard PKPaymentAuthorizationController.canMakePayments(usingNetworks: supportedNetworks) else {
                completion("Apple Pay غير متاح أو لا توجد بطاقة مدعومة في المحفظة")
                return
            }

            didCompletePayment = false
            let request = PKPaymentRequest()
            request.paymentSummaryItems = [
                PKPaymentSummaryItem(label: "أسواق سيتي", amount: NSDecimalNumber(value: amount), type: .final)
            ]
            request.merchantIdentifier = MoyasarConfig.merchantIdentifier
            request.countryCode = MoyasarConfig.countryCode
            request.currencyCode = MoyasarConfig.currency
            request.supportedNetworks = supportedNetworks
            request.merchantCapabilities = [.threeDSecure, .credit, .debit]

            controller = PKPaymentAuthorizationController(paymentRequest: request)
            controller?.delegate = self
            controller?.present { [weak self] presented in
                if !presented {
                    DispatchQueue.main.async {
                        self?.completion("تعذر فتح Apple Pay")
                    }
                }
            }
        }

        func paymentAuthorizationController(
            _ controller: PKPaymentAuthorizationController,
            didAuthorizePayment payment: PKPayment,
            handler completionHandler: @escaping (PKPaymentAuthorizationResult) -> Void
        ) {
            do {
                try applePayService.authorizePayment(
                    request: paymentRequest,
                    token: payment.token
                ) { result in
                    // URLSession callbacks run on a background thread — dispatch to main
                    // before touching any SwiftUI state or @MainActor properties.
                    DispatchQueue.main.async { [weak self] in
                        switch result {
                        case .success(let apiPayment):
                            if apiPayment.status == .paid || apiPayment.status == .authorized {
                                self?.didCompletePayment = true
                                completionHandler(PKPaymentAuthorizationResult(status: .success, errors: []))
                                self?.completion("تم الدفع بنجاح عبر Apple Pay")
                            } else {
                                self?.didCompletePayment = true
                                let err = NSError(
                                    domain: "MoyasarApplePay", code: -1,
                                    userInfo: [NSLocalizedDescriptionKey: "فشل الدفع عبر Apple Pay"]
                                )
                                completionHandler(PKPaymentAuthorizationResult(status: .failure, errors: [err]))
                                self?.completion("فشل الدفع عبر Apple Pay")
                            }
                        case .error(let error):
                            self?.didCompletePayment = true
                            completionHandler(PKPaymentAuthorizationResult(status: .failure, errors: [error]))
                            self?.completion("تعذر إتمام Apple Pay: \(error.applePayFailureMessage)")
                        @unknown default:
                            self?.didCompletePayment = true
                            let err = NSError(
                                domain: "MoyasarApplePay", code: -1,
                                userInfo: [NSLocalizedDescriptionKey: "حالة دفع غير متوقعة"]
                            )
                            completionHandler(PKPaymentAuthorizationResult(status: .failure, errors: [err]))
                            self?.completion("تعذر إتمام Apple Pay")
                        }
                    }
                }
            } catch {
                // authorizePayment throws synchronously (token encoding) — still on main thread here.
                didCompletePayment = true
                completionHandler(PKPaymentAuthorizationResult(status: .failure, errors: [error]))
                completion("تعذر تجهيز Apple Pay: \(error.applePayFailureMessage)")
            }
        }

        func paymentAuthorizationControllerDidFinish(_ controller: PKPaymentAuthorizationController) {
            if !didCompletePayment {
                didCompletePayment = true
                completion("تم إلغاء الدفع")
            }
            controller.dismiss(completion: nil)
        }
    }
}
#endif
