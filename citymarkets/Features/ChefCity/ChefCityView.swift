import AVFoundation
import Speech
import SwiftUI

struct ChefCityView: View {
    @EnvironmentObject private var store: AppStore
    @StateObject private var speechRecognizer = ChefSpeechRecognizer()
    @State private var draft = ""
    @State private var showLoginPrompt = false

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottomLeading) {
                VStack(spacing: 0) {
                    chefHeader

                    if store.chefMessages.isEmpty {
                        welcomeContent
                    } else {
                        messagesList
                    }

                    suggestionsBar
                    composer
                }

                if store.cartCount > 0 {
                    CompactFloatingCart(count: store.cartCount, subtotal: store.cartSubtotal)
                        .padding(.leading, 16)
                        .padding(.bottom, 10)
                }
            }
            .background(Color.cmBg)
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showLoginPrompt) {
                PhoneLoginSheet(isPresented: $showLoginPrompt)
            }
            .alert("تعذر التسجيل الصوتي", isPresented: Binding(
                get: { speechRecognizer.errorMessage != nil },
                set: { if !$0 { speechRecognizer.errorMessage = nil } }
            )) {
                Button("حسناً", role: .cancel) {
                    speechRecognizer.errorMessage = nil
                }
            } message: {
                Text(speechRecognizer.errorMessage ?? "")
            }
            .onChange(of: speechRecognizer.transcript) { _, transcript in
                guard speechRecognizer.isRecording else { return }
                draft = transcript
            }
            .onChange(of: speechRecognizer.finalTranscript) { _, transcript in
                let cleaned = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !cleaned.isEmpty else { return }
                draft = cleaned
                sendDraft()
            }
            .onDisappear {
                speechRecognizer.stopRecording()
            }
        }
    }

    // MARK: – Header

    private var chefHeader: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("شيف سيتي")
                        .font(.headline.bold())
                        .foregroundStyle(.white)
                    HStack(spacing: 4) {
                        Circle()
                            .fill(Color(hex: "4ADE80"))
                            .frame(width: 7, height: 7)
                        Text(speechRecognizer.isRecording ? "يستمع الآن" : "متصل بالمتجر")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.9))
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.white.opacity(0.18))
                    .clipShape(Capsule())
                }
                Text("اطلب بصوتك أو اسأل عن وجبة ومكوناتها")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.8))
            }
            Spacer()
            ZStack {
                Circle().fill(Color(hex: "F59E0B"))
                Text("👨‍🍳").font(.title3)
            }
            .frame(width: 50, height: 50)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.cmPrimary)
    }

    // MARK: – Welcome

    private var welcomeContent: some View {
        ScrollView {
            HStack(alignment: .top, spacing: 10) {
                ZStack {
                    Circle().fill(Color(hex: "F59E0B"))
                    Text("👨‍🍳").font(.body)
                }
                .frame(width: 36, height: 36)
                .padding(.top, 2)

                VStack(alignment: .leading, spacing: 10) {
                    Text("مرحباً في مطبخ ومتجر سيتي!")
                        .font(.subheadline.bold())
                        .foregroundStyle(Color.cmText)

                    bulletItem(
                        bold: "اسألني وش أطبخ العشا؟",
                        rest: " لأعرض أفكاراً مع مكونات تقدر تختار أي وجبة وتضيف مكوناتها المتوفرة في المتجر للسلة."
                    )
                    bulletItem(
                        bold: "أو قل لي: أبي أسوي كبسة",
                        rest: " وسأبحث عن أي منتجات مناسبة في أسواق سيتي"
                    )
                    bulletItem(
                        bold: "اضغط زر الميكروفون وتكلم مباشرة،",
                        rest: " وسيكتب شيف سيتي كلامك ثم يستخرج المنتجات المناسبة."
                    )
                }
                .padding(14)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                Spacer(minLength: 40)
            }
            .padding()
        }
    }

    private func bulletItem(bold: String, rest: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text("•")
                .font(.subheadline.bold())
                .foregroundStyle(Color.cmPrimary)
            (Text(bold).bold() + Text(rest))
                .font(.subheadline)
                .foregroundStyle(Color.cmText)
        }
    }

    // MARK: – Messages

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(store.chefMessages) { message in
                        ChefMessageBubble(message: message)
                            .id(message.id)
                    }
                }
                .padding()
            }
            .onChange(of: store.chefMessages) { _, messages in
                guard let last = messages.last else { return }
                proxy.scrollTo(last.id, anchor: .bottom)
            }
        }
    }

    // MARK: – Suggestions

    private var suggestionsBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("اقتراحات سريعة")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    suggestionChip("وش أطبخ العشا؟")
                    suggestionChip("أبي أسوي كبسة")
                    suggestionChip("فطور سريع للعائلة")
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 10)
        .background(Color.white)
    }

    private func suggestionChip(_ text: String) -> some View {
        Button {
            guard store.user != nil else { showLoginPrompt = true; return }
            speechRecognizer.stopRecording()
            draft = text
            sendDraft()
        } label: {
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Color.cmText)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Color.cmBg)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(Color.cmBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: – Composer

    private var composer: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 10) {
                Button {
                    guard store.user != nil else { showLoginPrompt = true; return }
                    speechRecognizer.stopRecording()
                    sendDraft()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 38, height: 38)
                        .background(
                            draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                ? Color.gray.opacity(0.35)
                                : Color.cmPrimary
                        )
                        .clipShape(Circle())
                }

                ZStack(alignment: .trailing) {
                    TextField(speechRecognizer.isRecording ? "تحدث الآن..." : "اكتب سؤالك لشيف سيتي...", text: $draft, axis: .vertical)
                        .lineLimit(1...4)
                        .padding(.vertical, 10)
                        .padding(.leading, 12)
                        .padding(.trailing, 46)
                        .background(Color.cmBg)
                        .clipShape(RoundedRectangle(cornerRadius: 22))
                        .overlay(
                            RoundedRectangle(cornerRadius: 22)
                                .stroke(speechRecognizer.isRecording ? Color(hex: "F59E0B") : Color.clear, lineWidth: 1.5)
                        )
                        .onChange(of: draft) { _, newValue in
                            if !newValue.isEmpty, store.user == nil {
                                draft = ""
                                showLoginPrompt = true
                            }
                        }

                    Button {
                        guard store.user != nil else { showLoginPrompt = true; return }
                        toggleVoiceInput()
                    } label: {
                        Image(systemName: speechRecognizer.isRecording ? "stop.fill" : "mic.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 32, height: 32)
                            .background(speechRecognizer.isRecording ? Color.cmSale : Color(hex: "F59E0B"))
                            .clipShape(Circle())
                    }
                    .padding(.trailing, 5)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.white)

            Text(speechRecognizer.isRecording ? "يتم تحويل صوتك إلى نص مباشرة... اضغط إيقاف للإرسال" : "مثال: وش أطبخ العشا؟  •  الاقتراحات بحسب توفر منتجات أسواق سيتي")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
                .background(Color.white)
        }
    }

    private func toggleVoiceInput() {
        if speechRecognizer.isRecording {
            speechRecognizer.finishRecording()
        } else {
            draft = ""
            Task { await speechRecognizer.startRecording() }
        }
    }

    private func sendDraft() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        Task { await store.sendChefMessage(text) }
    }
}

// MARK: – Speech Recognition

@MainActor
private final class ChefSpeechRecognizer: ObservableObject {
    @Published var transcript = ""
    @Published var finalTranscript = ""
    @Published var isRecording = false
    @Published var errorMessage: String?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ar-SA"))
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?

    func startRecording() async {
        guard Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") != nil,
              Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") != nil else {
            errorMessage = "يلزم إضافة صلاحيات الميكروفون والتعرف على الكلام في إعدادات التطبيق داخل Xcode قبل تشغيل التسجيل الصوتي."
            return
        }

        guard await requestPermissions() else { return }
        guard let recognizer, recognizer.isAvailable else {
            errorMessage = "التعرف على الكلام غير متاح حالياً على هذا الجهاز."
            return
        }

        stopRecording()
        transcript = ""
        finalTranscript = ""

        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            request.taskHint = .search
            request.contextualStrings = [
                "كبسة", "مندي", "مكرونة", "رز", "دجاج", "لحم", "حليب", "بيض", "خبز", "خضار", "فطور", "عشاء", "غداء"
            ]
            recognitionRequest = request

            let inputNode = audioEngine.inputNode
            let recordingFormat = inputNode.outputFormat(forBus: 0)
            inputNode.removeTap(onBus: 0)
            inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak request] buffer, _ in
                request?.append(buffer)
            }

            audioEngine.prepare()
            try audioEngine.start()
            isRecording = true

            recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let result {
                        let text = result.bestTranscription.formattedString
                        self.transcript = text
                        if result.isFinal {
                            self.completeRecognition(with: text)
                        }
                    }

                    if error != nil {
                        self.stopRecording()
                    }
                }
            }
        } catch {
            stopRecording()
            errorMessage = "تعذر بدء التسجيل الصوتي: \(error.localizedDescription)"
        }
    }

    func finishRecording() {
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        stopRecording()
        if !text.isEmpty {
            finalTranscript = text
        }
    }

    func stopRecording() {
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func completeRecognition(with text: String) {
        stopRecording()
        let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !cleaned.isEmpty {
            finalTranscript = cleaned
        }
    }

    private func requestPermissions() async -> Bool {
        async let speechAllowed = requestSpeechPermission()
        async let microphoneAllowed = requestMicrophonePermission()
        let allowed = await (speechAllowed, microphoneAllowed)

        guard allowed.0 else {
            errorMessage = "لم يتم السماح للتطبيق باستخدام التعرف على الكلام."
            return false
        }
        guard allowed.1 else {
            errorMessage = "لم يتم السماح للتطبيق باستخدام الميكروفون."
            return false
        }
        return true
    }

    private func requestSpeechPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}

// MARK: – Message Bubble

struct ChefMessageBubble: View {
    @EnvironmentObject private var store: AppStore
    let message: ChefChatMessage

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 10) {
            Text(message.content)
                .font(.body)
                .foregroundStyle(message.role == .user ? .white : Color.cmText)
                .padding(12)
                .background(message.role == .user ? Color.cmPrimary : Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14))

            if !message.matches.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(message.matches) { match in
                        ChefMatchedProductRow(match: match)
                            .environmentObject(store)
                    }
                }
                .padding(10)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }

            if !message.suggestions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(message.suggestions) { suggestion in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(suggestion.title)
                                .font(.subheadline.weight(.bold))
                            Text(suggestion.description)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(10)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
    }
}

private struct ChefMatchedProductRow: View {
    @EnvironmentObject private var store: AppStore
    let match: AIMatchedProduct

    private var cartItem: CartItem? {
        store.cartItems.first { $0.productId == match.product.id }
    }

    private var displayedQuantity: Int {
        cartItem?.quantity ?? 0
    }

    var body: some View {
        HStack(spacing: 10) {
            ProductImage(url: match.product.absoluteImageURL, height: 48)
                .frame(width: 48)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                Text(match.product.nameAr)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.cmText)
                    .lineLimit(2)
                Text(displayedQuantity > 0 ? "في السلة: \(displayedQuantity)" : "الكمية المقترحة: \(match.quantity)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            if let cartItem {
                HStack(spacing: 8) {
                    chefQuantityButton(systemImage: "minus") {
                        Task { await store.updateCartItem(cartItem, quantity: max(cartItem.quantity - 1, 0)) }
                    }

                    Text("\(cartItem.quantity)")
                        .font(.subheadline.monospacedDigit().weight(.bold))
                        .foregroundStyle(Color.cmText)
                        .frame(width: 26)

                    chefQuantityButton(systemImage: "plus") {
                        Task { await store.updateCartItem(cartItem, quantity: cartItem.quantity + 1) }
                    }
                }
            } else {
                Button {
                    Task { await store.addToCart(match.product, quantity: max(match.quantity, 1)) }
                } label: {
                    Image(systemName: "cart.badge.plus")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 36)
                        .background(Color.cmPrimary)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
    }

    private func chefQuantityButton(systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.cmPrimary)
                .frame(width: 32, height: 32)
                .background(Color.cmPrimaryLight)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}
