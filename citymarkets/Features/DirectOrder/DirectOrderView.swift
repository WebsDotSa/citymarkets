import SwiftUI
import AVFoundation

struct DirectOrderView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.dismiss) var dismiss
    @State private var selectedPaymentMethod = "mada"
    @State private var selectedAddress: Address?
    @State private var notes = ""
    @State private var items: [DirectOrderItem] = []
    @State private var isRecording = false
    @State private var voiceNoteUrl: String?
    @State private var voiceNoteDuration: Int?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var feeAcknowledged = false
    @State private var audioRecorder: AVAudioRecorder?
    @State private var audioUrl: URL?
    @State private var recordingTimer: Timer?
    @State private var recordingDuration = 0
    @State private var showAddressPicker = false
    @State private var showAddItemSheet = false
    @State private var newItemText = ""
    @State private var newItemQty = 1

    let paymentMethods = ["mada", "visa", "mastercard", "amex", "apple_pay", "wallet", "bank_transfer"]
    let paymentLabels: [String: String] = [
        "mada": "بطاقة مدى",
        "visa": "فيزا",
        "mastercard": "ماستركارد",
        "amex": "أمريكان إكسبريس",
        "apple_pay": "Apple Pay",
        "wallet": "المحفظة الرقمية",
        "bank_transfer": "تحويل بنكي"
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                Color.cmBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        if let error = errorMessage {
                            HStack(spacing: 12) {
                                Image(systemName: "exclamationmark.circle.fill")
                                    .foregroundStyle(Color.cmError)
                                Text(error)
                                    .font(.subheadline)
                                    .foregroundStyle(Color.cmError)
                                Spacer()
                            }
                            .padding(12)
                            .background(Color.cmError.opacity(0.1))
                            .cornerRadius(8)
                        }

                        // Delivery Address
                        VStack(alignment: .leading, spacing: 12) {
                            Label("عنوان التوصيل", systemImage: "mappin.circle.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.cmPrimary)

                            if let address = selectedAddress {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(address.title ?? address.label)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(Color.cmText)
                                    Text(address.addressText ?? "")
                                        .font(.caption)
                                        .foregroundStyle(Color.cmTextMuted)
                                        .lineLimit(2)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12)
                                .background(Color.cmCardBg)
                                .cornerRadius(8)
                            } else {
                                Text("اختر عنوان التوصيل")
                                    .foregroundStyle(Color.cmTextMuted)
                                    .padding(12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color.cmCardBg)
                                    .cornerRadius(8)
                            }

                            Button(action: { showAddressPicker = true }) {
                                HStack {
                                    Image(systemName: "location.fill")
                                        .font(.subheadline)
                                    Text(selectedAddress != nil ? "تغيير العنوان" : "اختر العنوان")
                                        .font(.subheadline.weight(.semibold))
                                }
                                .frame(maxWidth: .infinity)
                                .padding(12)
                                .background(Color.cmPrimary.opacity(0.1))
                                .foregroundStyle(Color.cmPrimary)
                                .cornerRadius(8)
                            }
                        }

                        Divider()

                        // Payment Method
                        VStack(alignment: .leading, spacing: 12) {
                            Label("طريقة الدفع", systemImage: "creditcard.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.cmPrimary)

                            Picker("طريقة الدفع", selection: $selectedPaymentMethod) {
                                ForEach(paymentMethods, id: \.self) { method in
                                    Text(paymentLabels[method] ?? method)
                                        .tag(method)
                                }
                            }
                            .pickerStyle(.segmented)
                        }

                        Divider()

                        // Voice Note
                        VStack(alignment: .leading, spacing: 12) {
                            Label("ملاحظة صوتية (اختياري)", systemImage: "mic.circle.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.cmPrimary)

                            HStack(spacing: 12) {
                                if isRecording {
                                    Image(systemName: "waveform.circle.fill")
                                        .font(.title2)
                                        .foregroundStyle(Color.cmError)
                                        .symbolEffect(.pulse)

                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("جاري التسجيل")
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(Color.cmError)
                                        Text(formatDuration(recordingDuration))
                                            .font(.caption)
                                            .foregroundStyle(Color.cmTextMuted)
                                    }

                                    Spacer()

                                    Button(action: stopRecording) {
                                        Image(systemName: "stop.circle.fill")
                                            .font(.title2)
                                            .foregroundStyle(Color.cmError)
                                    }
                                } else if voiceNoteUrl != nil {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.title2)
                                        .foregroundStyle(Color.cmSuccess)

                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("تم التسجيل")
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(Color.cmSuccess)
                                        Text("\(voiceNoteDuration ?? 0) ثانية")
                                            .font(.caption)
                                            .foregroundStyle(Color.cmTextMuted)
                                    }

                                    Spacer()

                                    Button(action: resetVoiceNote) {
                                        Image(systemName: "xmark.circle.fill")
                                            .font(.title2)
                                            .foregroundStyle(Color.cmError)
                                    }
                                } else {
                                    Button(action: startRecording) {
                                        Image(systemName: "mic.fill")
                                            .font(.title2)
                                            .foregroundStyle(Color.cmPrimary)

                                        Text("ابدأ التسجيل")
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(Color.cmPrimary)

                                        Spacer()
                                    }
                                }
                            }
                            .padding(12)
                            .background(Color.cmCardBg)
                            .cornerRadius(8)
                        }

                        Divider()

                        // Text Notes
                        VStack(alignment: .leading, spacing: 12) {
                            Label("ملاحظات إضافية", systemImage: "note.text")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.cmPrimary)

                            TextEditor(text: $notes)
                                .font(.subheadline)
                                .frame(height: 100)
                                .padding(8)
                                .background(Color.cmCardBg)
                                .cornerRadius(8)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Color.cmBorder, lineWidth: 1)
                                )
                        }

                        Divider()

                        // Items
                        VStack(alignment: .leading, spacing: 12) {
                            HStack {
                                Label("المنتجات", systemImage: "bag.fill")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Color.cmPrimary)

                                Spacer()

                                Button(action: { showAddItemSheet = true }) {
                                    Image(systemName: "plus.circle.fill")
                                        .font(.subheadline)
                                        .foregroundStyle(Color.cmPrimary)
                                }
                            }

                            if items.isEmpty {
                                Text("لم تضف أي منتجات")
                                    .font(.caption)
                                    .foregroundStyle(Color.cmTextMuted)
                                    .padding(12)
                                    .frame(maxWidth: .infinity, alignment: .center)
                                    .background(Color.cmCardBg)
                                    .cornerRadius(8)
                            } else {
                                ForEach(items.indices, id: \.self) { index in
                                    HStack(spacing: 12) {
                                        VStack(alignment: .leading, spacing: 4) {
                                            Text(items[index].free_text ?? items[index].product_id ?? "منتج")
                                                .font(.subheadline.weight(.semibold))
                                                .foregroundStyle(Color.cmText)

                                            Text("الكمية: \(items[index].quantity)")
                                                .font(.caption)
                                                .foregroundStyle(Color.cmTextMuted)
                                        }

                                        Spacer()

                                        Button(action: {
                                            items.remove(at: index)
                                        }) {
                                            Image(systemName: "xmark.circle.fill")
                                                .foregroundStyle(Color.cmError)
                                        }
                                    }
                                    .padding(12)
                                    .background(Color.cmCardBg)
                                    .cornerRadius(8)
                                }
                            }
                        }

                        Divider()

                        // Fee Acknowledgment
                        HStack(spacing: 12) {
                            Toggle("", isOn: $feeAcknowledged)
                                .tint(Color.cmPrimary)

                            VStack(alignment: .leading, spacing: 4) {
                                Text("أوافق على رسوم الخدمة")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Color.cmText)

                                Text("رسوم الخدمة: 4 ر.س")
                                    .font(.caption)
                                    .foregroundStyle(Color.cmTextMuted)
                            }

                            Spacer()
                        }
                        .padding(12)
                        .background(Color.cmPrimaryLight)
                        .cornerRadius(8)

                        // Submit Button
                        Button {
                            Task { await submitOrder() }
                        } label: {
                            if isLoading {
                                ProgressView()
                                    .tint(.white)
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("تأكيد الطلب المباشر")
                                    .font(.headline.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .frame(height: 52)
                        .background(Color.cmPrimary)
                        .cornerRadius(12)
                        .disabled(
                            isLoading ||
                            selectedAddress == nil ||
                            !feeAcknowledged
                        )
                        .opacity((selectedAddress != nil && feeAcknowledged) ? 1 : 0.5)
                    }
                    .padding(16)
                }
            }
            .navigationTitle("طلب مباشر")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("إلغاء") { dismiss() }
                        .disabled(isLoading)
                }
            }
            .sheet(isPresented: $showAddressPicker) {
                AddressPickerSheet(selectedAddress: $selectedAddress)
            }
            .sheet(isPresented: $showAddItemSheet) {
                AddDirectOrderItemSheet(
                    itemText: $newItemText,
                    quantity: $newItemQty,
                    onAdd: {
                        let item = DirectOrderItem(
                            product_id: nil,
                            free_text: newItemText,
                            quantity: newItemQty,
                            notes: nil
                        )
                        items.append(item)
                        newItemText = ""
                        newItemQty = 1
                        showAddItemSheet = false
                    },
                    onCancel: { showAddItemSheet = false }
                )
            }
        }
    }

    private func startRecording() {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .default)
            try audioSession.setActive(true)

            let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let audioUrl = documentsPath.appendingPathComponent("voice_note_\(UUID().uuidString).m4a")

            let settings = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 12000,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]

            audioRecorder = try AVAudioRecorder(url: audioUrl, settings: settings)
            audioRecorder?.record()
            self.audioUrl = audioUrl
            isRecording = true
            recordingDuration = 0

            recordingTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
                recordingDuration += 1
                if recordingDuration >= 600 {
                    stopRecording()
                }
            }
        } catch {
            errorMessage = "فشل بدء التسجيل"
        }
    }

    private func stopRecording() {
        recordingTimer?.invalidate()
        audioRecorder?.stop()
        isRecording = false
        voiceNoteDuration = recordingDuration

        if let url = audioUrl {
            do {
                let data = try Data(contentsOf: url)
                let boundary = UUID().uuidString
                var body = Data()
                body.append(Data("--\(boundary)\r\n".utf8))
                body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"voice.m4a\"\r\n".utf8))
                body.append(Data("Content-Type: audio/mp4\r\n\r\n".utf8))
                body.append(data)
                body.append(Data("\r\n--\(boundary)--\r\n".utf8))

                voiceNoteUrl = url.absoluteString
            } catch {
                errorMessage = "فشل حفظ الملف الصوتي"
            }
        }
    }

    private func resetVoiceNote() {
        voiceNoteUrl = nil
        voiceNoteDuration = nil
        if let url = audioUrl {
            try? FileManager.default.removeItem(at: url)
            audioUrl = nil
        }
    }

    private func submitOrder() async {
        guard let address = selectedAddress, feeAcknowledged else {
            errorMessage = "تأكد من ملء جميع الحقول المطلوبة"
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            let directAddress = DirectOrderAddress(
                label: address.label,
                address_text: address.addressText ?? address.title ?? "",
                lat: address.lat ?? 0,
                lng: address.lng ?? 0,
                plus_code: nil,
                city: nil,
                district: nil,
                description: address.notes,
                place_images: address.placeImages.isEmpty ? nil : address.placeImages
            )

            let response = try await APIClient.shared.createDirectOrder(
                paymentMethod: selectedPaymentMethod,
                notes: notes.isEmpty ? nil : notes,
                voiceNoteUrl: voiceNoteUrl,
                voiceNoteDuration: voiceNoteDuration,
                customerPhone: nil,
                deliveryAddress: directAddress,
                items: items.isEmpty ? nil : items
            )

            await store.loadOrders()

            await MainActor.run {
                // Close the sheet and navigate to chat page
                dismiss()

                // Wait a bit for dismiss animation to complete
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    // Store the order ID for navigation
                    store.selectedOrderId = response.orderId
                }
            }
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? "فشل إنشاء الطلب"
        }

        isLoading = false
    }

    private func formatDuration(_ seconds: Int) -> String {
        let mins = seconds / 60
        let secs = seconds % 60
        return String(format: "%02d:%02d", mins, secs)
    }
}

struct AddressPickerSheet: View {
    @Binding var selectedAddress: Address?
    @Environment(\.dismiss) var dismiss
    @State private var addresses: [Address] = []
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.cmBg.ignoresSafeArea()

                if isLoading {
                    ProgressView()
                } else if addresses.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "location.slash.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(Color.cmTextMuted)
                        Text("لا توجد عناوين")
                            .font(.headline)
                            .foregroundStyle(Color.cmText)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                } else {
                    List(addresses) { address in
                        Button(action: {
                            selectedAddress = address
                            dismiss()
                        }) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(address.title ?? address.label)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Color.cmText)
                                Text(address.addressText ?? "")
                                    .font(.caption)
                                    .foregroundStyle(Color.cmTextMuted)
                            }
                        }
                    }
                }
            }
            .navigationTitle("اختر العنوان")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("إلغاء") { dismiss() }
                }
            }
            .onAppear {
                Task {
                    isLoading = true
                    do {
                        addresses = try await APIClient.shared.getAddresses()
                    } catch {
                        addresses = []
                    }
                    isLoading = false
                }
            }
        }
    }
}

struct AddDirectOrderItemSheet: View {
    @Binding var itemText: String
    @Binding var quantity: Int
    let onAdd: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            ZStack {
                Color.cmBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("اسم المنتج", systemImage: "tag.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.cmPrimary)

                            TextField("مثال: دجاج مشوي بالعسل", text: $itemText)
                                .font(.subheadline)
                                .padding(12)
                                .background(Color.cmCardBg)
                                .cornerRadius(8)
                        }

                        VStack(alignment: .leading, spacing: 12) {
                            Label("الكمية", systemImage: "number.circle.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.cmPrimary)

                            HStack(spacing: 12) {
                                Button(action: { if quantity > 1 { quantity -= 1 } }) {
                                    Image(systemName: "minus.circle.fill")
                                        .font(.title2)
                                        .foregroundStyle(Color.cmPrimary)
                                }

                                Stepper("", value: $quantity, in: 1...999)
                                    .labelsHidden()

                                Button(action: { quantity += 1 }) {
                                    Image(systemName: "plus.circle.fill")
                                        .font(.title2)
                                        .foregroundStyle(Color.cmPrimary)
                                }

                                Spacer()

                                Text("\(quantity)")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Color.cmText)
                            }
                            .padding(12)
                            .background(Color.cmCardBg)
                            .cornerRadius(8)
                        }

                        Spacer()

                        Button(action: onAdd) {
                            Text("إضافة المنتج")
                                .font(.headline.weight(.semibold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .frame(height: 52)
                                .background(Color.cmPrimary)
                                .cornerRadius(12)
                        }
                        .disabled(itemText.trimmingCharacters(in: .whitespaces).isEmpty)
                        .opacity(itemText.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)
                    }
                    .padding(16)
                }
            }
            .navigationTitle("إضافة منتج")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("إلغاء") { onCancel() }
                }
            }
        }
    }
}

#Preview {
    DirectOrderView()
        .environmentObject(AppStore())
}
