import AppKit
import IOKit
import IOKit.ps
import CoreAudio
import CoreWLAN
import Network
import IOBluetooth

let nilValue = NSNull()
func jsonValue(_ value: Any?) -> Any { value ?? nilValue }
func number(_ dictionary: [String: Any], _ key: String) -> Double? {
    guard let value = (dictionary[key] as? NSNumber)?.doubleValue, value.isFinite, abs(value) < 1_000_000_000 else { return nil }
    return value
}

func batterySnapshot() -> [String: Any] {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
          let sources = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else { return ["available": false] }
    let source = sources.compactMap { IOPSGetPowerSourceDescription(info, $0)?.takeUnretainedValue() as? [String: Any] }.first { ($0[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType }
    guard let source else { return ["available": true, "present": false] }
    let charging = source[kIOPSIsChargingKey] as? Bool ?? false
    let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSmartBattery"))
    var properties: [String: Any] = [:]
    if service != 0 {
        defer { IOObjectRelease(service) }
        var ref: Unmanaged<CFMutableDictionary>?
        if IORegistryEntryCreateCFProperties(service, &ref, kCFAllocatorDefault, 0) == KERN_SUCCESS { properties = ref?.takeRetainedValue() as? [String: Any] ?? [:] }
    }
    let adapter = properties["AdapterDetails"] as? [String: Any] ?? [:]
    let telemetry = properties["PowerTelemetryData"] as? [String: Any] ?? [:]
    // Adapter Watts is negotiated capacity. SystemPowerIn is independent live telemetry (mW).
    let input = number(telemetry, "SystemPowerIn").flatMap { $0 >= 0 ? $0 / 1000 : nil }
    let watts = PowerMetrics.chargingWatts(amperage: (properties["Amperage"] as? NSNumber).map { Double($0.int64Value) }, voltage: number(properties, "Voltage"), charging: charging)
    let maximum = number(source, kIOPSMaxCapacityKey) ?? 100
    let percent = number(source, kIOPSCurrentCapacityKey).map { maximum > 0 ? min(100, max(0, $0 / maximum * 100)) : 0 }
    return ["available": true, "present": true, "percent": jsonValue(percent), "charging": charging,
            "externalConnected": (source[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue,
            "chargingWatts": jsonValue(watts), "inputWatts": jsonValue(input), "adapterWatts": jsonValue(number(adapter, "Watts"))]
}

func audioString(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<CFString>.size)
    guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr else { return nil }
    return value?.takeUnretainedValue() as String?
}
// Read only existing IOHID telemetry; never connect to or discover a device.
func peripheralBatteries() -> [String: Double] {
    var result: [String: Double] = [:]
    var iterator: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOHIDDevice"), &iterator) == KERN_SUCCESS else { return result }
    defer { IOObjectRelease(iterator) }
    var entry = IOIteratorNext(iterator)
    while entry != 0 {
        var ref: Unmanaged<CFMutableDictionary>?
        if IORegistryEntryCreateCFProperties(entry, &ref, kCFAllocatorDefault, 0) == KERN_SUCCESS,
           let properties = ref?.takeRetainedValue() as? [String: Any],
           let percent = number(properties, "BatteryPercent"), (0...100).contains(percent),
           let name = properties["Product"] as? String { result[name.lowercased()] = percent }
        IOObjectRelease(entry); entry = IOIteratorNext(iterator)
    }
    return result
}
func audioSnapshot() -> [String: Any] {
    var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var active = AudioDeviceID(0)
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    let success = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &active) == noErr
    var devices: [[String: Any]] = []
    let batteries = peripheralBatteries()
    if success, active != 0 {
        var transportAddress = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyTransportType, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var transport: UInt32 = 0; size = 4
        AudioObjectGetPropertyData(active, &transportAddress, 0, nil, &size, &transport)
        let kind = (transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE) ? "bluetooth" : transport == kAudioDeviceTransportTypeBuiltIn ? "builtIn" : transport == kAudioDeviceTransportTypeUSB ? "usb" : "other"
        devices.append(["id": String(active), "name": audioString(active, kAudioObjectPropertyName) ?? "Audio", "transport": kind, "connected": true, "batteryPercent": jsonValue(batteries[(audioString(active, kAudioObjectPropertyName) ?? "").lowercased()])])
    }
    // pairedDevices is local cached metadata; do not initiate discovery or authentication.
    for device in (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? []) where device.isConnected() && ((device.classOfDevice >> 8) & 0x1f) == 4 {
        let name = device.name ?? "Bluetooth"
        if !devices.contains(where: { ($0["name"] as? String) == name }) {
            devices.append(["id": device.addressString ?? name, "name": name, "transport": "bluetooth", "connected": true, "batteryPercent": jsonValue(batteries[name.lowercased()])])
        }
    }
    return ["available": success, "devices": devices, "activeDeviceId": success && active != 0 ? String(active) as Any : nilValue]
}

final class StatusService: NSObject, CWEventDelegate {
    var enabled = ["battery": false, "audio": false, "network": false, "capture": false, "lockScreen": false]
    var monitor: NWPathMonitor?
    var network: [String: Any] = ["available": false, "connected": nilValue, "type": nilValue, "name": nilValue, "expensive": nilValue]
    var locked = false
    var locale = "en"
    var content = (title: "WorkIsland", subtitle: "")
    var lockObservers: [NSObjectProtocol] = []
    var panel: NSPanel?
    var summaryLabel: NSTextField?
    var powerSource: CFRunLoopSource?
    var audioListener: AudioObjectPropertyListenerBlock?
    var audioObservers: [NSObjectProtocol] = []
    var previewGeneration = 0
    var previous = Data()
    var timer: Timer?
    let capture = CaptureObserver()
    lazy var host = LockScreenHost()
    let parentPID = getppid()
    var stdinBuffer = Data()
    var once = false

    func start() {
        configure([:])
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            guard let self else { return }
            if getppid() != self.parentPID { self.stop(); exit(0) }
            if let session = CGSessionCopyCurrentDictionary() as? [String: Any] {
                let current = session["CGSSessionScreenIsLocked"] as? Bool ?? false
                if current != self.locked { self.locked = current; if current { self.showPanel(preview: false) } else { self.hidePanel() } }
            }
            self.emit()
        }
        capture.changed = { [weak self] in self?.emit() }
        FileHandle.standardInput.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData
            DispatchQueue.main.async {
                guard let self else { return }
                if bytes.isEmpty { self.stop(); exit(0) }
                self.stdinBuffer.append(bytes)
                if self.stdinBuffer.count > 65536 { self.stdinBuffer.removeAll(); return }
                while let end = self.stdinBuffer.firstIndex(of: 10) {
                    let line = self.stdinBuffer.prefix(upTo: end); self.stdinBuffer.removeSubrange(...end)
                    if let message = try? JSONSerialization.jsonObject(with: line) as? [String: Any] { self.receive(message) }
                }
            }
        }
        emit()
    }
    func configure(_ configuration: [String: Any]) {
        if let values = configuration["enabled"] as? [String: Bool] { for (key,value) in values where enabled[key] != nil { enabled[key] = value } }
        if let value = configuration["locale"] as? String { locale = String(value.prefix(16)) }
        if enabled["battery"] == true && powerSource == nil {
            powerSource = IOPSNotificationCreateRunLoopSource({ context in
                guard let context else { return }
                Unmanaged<StatusService>.fromOpaque(context).takeUnretainedValue().emit()
            }, Unmanaged.passUnretained(self).toOpaque())?.takeRetainedValue()
            if let powerSource { CFRunLoopAddSource(CFRunLoopGetMain(), powerSource, .defaultMode) }
        } else if enabled["battery"] != true, let source = powerSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .defaultMode); powerSource = nil
        }
        if enabled["audio"] == true && audioListener == nil {
            let listener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.emit() }
            audioListener = listener
            audioObservers = ["IOBluetoothDeviceConnectedNotification", "IOBluetoothDeviceDisconnectedNotification"].map { name in
                DistributedNotificationCenter.default().addObserver(forName: Notification.Name(name), object: nil, queue: .main) { [weak self] _ in self?.emit() }
            }
            for selector in [kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices] {
                var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
                AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, listener)
            }
        } else if enabled["audio"] != true { removeAudioListener() }
        if enabled["network"] == true && monitor == nil {
            CWWiFiClient.shared().delegate = self
            try? CWWiFiClient.shared().startMonitoringEvent(with: .ssidDidChange)
            try? CWWiFiClient.shared().startMonitoringEvent(with: .linkDidChange)
            let newMonitor = NWPathMonitor(); monitor = newMonitor
            newMonitor.pathUpdateHandler = { [weak self, weak newMonitor] path in
                DispatchQueue.main.async {
                    guard let self, self.monitor === newMonitor else { return }
                    let type = path.usesInterfaceType(.wifi) ? "wifi" : path.usesInterfaceType(.wiredEthernet) ? "ethernet" : path.usesInterfaceType(.cellular) ? "cellular" : "other"
                    self.network = ["available": true, "connected": path.status == .satisfied, "type": type,
                                    "name": jsonValue(type == "wifi" ? CWWiFiClient.shared().interface()?.ssid() : nil), "expensive": path.isExpensive]
                    self.emit()
                }
            }
            newMonitor.start(queue: DispatchQueue(label: "workisland.network"))
        } else if enabled["network"] != true { stopNetwork(); network = ["available": false] }
        if enabled["capture"] == true { capture.start() } else { capture.stop() }
        if lockObservers.isEmpty {
            let center = DistributedNotificationCenter.default()
            lockObservers = [("com.apple.screenIsLocked", true), ("com.apple.screenIsUnlocked", false)].map { name, value in
                center.addObserver(forName: Notification.Name(name), object: nil, queue: .main) { [weak self] _ in
                    self?.locked = value
                    if value { self?.showPanel(preview: false) } else { self?.hidePanel() }
                    self?.emit()
                }
            }
            if let state = CGSessionCopyCurrentDictionary() as? [String: Any] { locked = state["CGSSessionScreenIsLocked"] as? Bool ?? false }
        }
        if enabled["lockScreen"] != true { hidePanel() }
        else if locked { showPanel(preview: false) }
    }
    func refreshNetworkIdentity() {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.enabled["network"] == true, self.network["type"] as? String == "wifi" else { return }
            self.network["name"] = jsonValue(CWWiFiClient.shared().interface()?.ssid()); self.emit()
        }
    }
    func ssidDidChangeForWiFiInterface(withName interfaceName: String) { refreshNetworkIdentity() }
    func linkDidChangeForWiFiInterface(withName interfaceName: String) { refreshNetworkIdentity() }
    func stopNetwork() {
        monitor?.cancel(); monitor = nil
        try? CWWiFiClient.shared().stopMonitoringEvent(with: .ssidDidChange)
        try? CWWiFiClient.shared().stopMonitoringEvent(with: .linkDidChange)
        CWWiFiClient.shared().delegate = nil
    }
    func receive(_ message: [String: Any]) {
        switch message["type"] as? String {
        case "configure": configure(message); emit()
        case "lockContent":
            content = (clean(message["title"], limit: 120), clean(message["subtitle"], limit: 240))
            if locked && enabled["lockScreen"] == true { showPanel(preview: false) }
        case "previewLockScreen": showPanel(preview: true)
        case "stop": stop(); exit(0)
        default: break
        }
    }
    func clean(_ value: Any?, limit: Int) -> String { String((value as? String ?? "").filter { !$0.isNewline && !$0.isASCII || (!$0.isNewline && $0.asciiValue.map { $0 >= 32 } == true) }.prefix(limit)) }
    func emit(force: Bool = false) {
        var state: [String: Any] = [:]
        state["battery"] = enabled["battery"] == true ? batterySnapshot() : ["available": false]
        state["audio"] = enabled["audio"] == true ? audioSnapshot() : ["available": false]
        state["network"] = network
        state["capture"] = enabled["capture"] == true ? capture.snapshot() : ["available": false, "active": nilValue]
        state["locked"] = locked
        state["lockScreen"] = enabled["lockScreen"] == true ? ["available": host.available, "error": jsonValue(host.error)] as [String: Any] : ["available": false, "error": nilValue]
        summaryLabel?.stringValue = summary(state)
        guard let data = try? JSONSerialization.data(withJSONObject: ["type": "snapshot", "state": state], options: [.sortedKeys]), data.count < 65536 else { return }
        if once && !force { return }
        if force || data != previous { FileHandle.standardOutput.write(data + Data([10])); previous = data }
    }
    func summary(_ state: [String: Any]) -> String {
        let zh = locale.hasPrefix("zh")
        var parts: [String] = []
        if let battery = state["battery"] as? [String: Any], let percent = battery["percent"] as? Double {
            var value = String(format: "%.0f%%", percent)
            if let watts = battery["chargingWatts"] as? Double { value += String(format: " · %.1f W", watts) }
            parts.append(value)
        }
        if let network = state["network"] as? [String: Any], let connected = network["connected"] as? Bool {
            parts.append(connected ? (zh ? "网络已连接" : "Connected") : (zh ? "网络已断开" : "Offline"))
        }
        if let capture = state["capture"] as? [String: Any], capture["active"] as? Bool == true { parts.append(zh ? "屏幕捕获中" : "Screen capture active") }
        return parts.joined(separator: "   ·   ")
    }
    func showPanel(preview: Bool) {
        guard enabled["lockScreen"] == true else { return }
        previewGeneration += 1
        let generation = previewGeneration
        let frame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let window = panel ?? NSPanel(contentRect: NSRect(x: frame.midX - 210, y: frame.maxY - 270, width: 420, height: 136), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        window.canBecomeVisibleWithoutLogin = true
        window.isReleasedWhenClosed = false
        window.isOpaque = false; window.backgroundColor = .clear; window.hasShadow = true; window.ignoresMouseEvents = true
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]; window.level = .screenSaver
        let background = NSVisualEffectView(frame: NSRect(x: 0,y: 0,width: 420,height: 136)); background.material = .hudWindow; background.state = .active
        background.wantsLayer = true; background.layer?.cornerRadius = 22
        let title = NSTextField(labelWithString: preview ? (locale.hasPrefix("zh") ? "锁屏预览 · " : "Lock screen preview · ") + (content.title.isEmpty ? "WorkIsland" : content.title) : (content.title.isEmpty ? "WorkIsland" : content.title))
        title.font = .systemFont(ofSize: 17, weight: .semibold); title.textColor = .labelColor; title.lineBreakMode = .byTruncatingTail; title.frame = NSRect(x: 22,y: 89,width: 376,height: 25)
        let detail = NSTextField(labelWithString: content.subtitle.isEmpty ? (locale.hasPrefix("zh") ? "WorkIsland 状态" : "WorkIsland status") : content.subtitle)
        detail.font = .systemFont(ofSize: 13); detail.textColor = .secondaryLabelColor; detail.lineBreakMode = .byTruncatingTail; detail.frame = NSRect(x: 22,y: 57,width: 376,height: 23)
        let summaryField = NSTextField(labelWithString: "")
        summaryField.font = .systemFont(ofSize: 11, weight: .medium); summaryField.textColor = .secondaryLabelColor
        summaryField.frame = NSRect(x: 22, y: 25, width: 376, height: 20); summaryField.lineBreakMode = .byTruncatingTail
        background.addSubview(summaryField); summaryLabel = summaryField
        background.addSubview(title); background.addSubview(detail); window.contentView = background
        window.orderFrontRegardless()
        if panel == nil && host.available { host.delegate(window) }
        panel = window
        if preview { DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self, weak window] in if self?.panel === window && self?.previewGeneration == generation && self?.locked == false { self?.hidePanel() } } }
        emit()
    }
    func hidePanel() { previewGeneration += 1; panel?.orderOut(nil) }
    func removeAudioListener() {
        audioObservers.forEach { DistributedNotificationCenter.default().removeObserver($0) }; audioObservers.removeAll()
        guard let listener = audioListener else { return }
        for selector in [kAudioHardwarePropertyDefaultOutputDevice, kAudioHardwarePropertyDevices] {
            var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, listener)
        }
        audioListener = nil
    }
    func stop() {
        timer?.invalidate(); stopNetwork(); capture.stop(); hidePanel(); removeAudioListener()
        if let powerSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), powerSource, .defaultMode) }; powerSource = nil
        lockObservers.forEach { DistributedNotificationCenter.default().removeObserver($0) }; lockObservers.removeAll()
        FileHandle.standardInput.readabilityHandler = nil
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.finishLaunching()
let service = StatusService()
if CommandLine.arguments.contains("--once") {
    service.once = true; service.configure(["enabled": ["battery": true, "audio": true, "network": true, "capture": true, "lockScreen": true]])
    RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.6)); service.emit(force: true); service.stop()
} else {
    service.start()
    if CommandLine.arguments.contains("--preview-lock-screen") { service.configure(["enabled": ["lockScreen": true]]); service.showPanel(preview: true) }
    signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
    let termination = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    let interrupt = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    termination.setEventHandler { service.stop(); exit(0) }; interrupt.setEventHandler { service.stop(); exit(0) }
    termination.resume(); interrupt.resume()
    app.run()
}
