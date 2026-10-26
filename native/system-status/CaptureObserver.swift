import Foundation

typealias CaptureCallback = @convention(c) (UInt32, UnsafeRawPointer?, UInt32, UnsafeMutableRawPointer?) -> Void
private let captureCallback: CaptureCallback = { _, _, _, context in
    guard let context else { return }
    // The service owns this observer until all callbacks are unregistered.
    let observer = Unmanaged<CaptureObserver>.fromOpaque(context).takeUnretainedValue()
    DispatchQueue.main.async { [weak observer] in observer?.changed?() }
}
final class CaptureObserver {
    typealias Query = @convention(c) () -> Bool
    typealias Register = @convention(c) (CaptureCallback?, UInt32, UnsafeMutableRawPointer?) -> Int32
    typealias Unregister = @convention(c) (CaptureCallback?, UInt32, UnsafeMutableRawPointer?) -> Int32
    let handle = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW)
    var query: Query?
    var register: Register?
    var unregister: Unregister?
    var events: [UInt32] = []
    var enabled = false
    var changed: (() -> Void)?
    init() {
        if let handle, let symbol = dlsym(handle, "CGSIsScreenWatcherPresent") { query = unsafeBitCast(symbol, to: Query.self) }
        if let handle, let symbol = dlsym(handle, "CGSRegisterNotifyProc"), let undo = dlsym(handle, "CGSRemoveNotifyProc") {
            register = unsafeBitCast(symbol, to: Register.self); unregister = unsafeBitCast(undo, to: Unregister.self)
        }
    }
    func start() {
        guard !enabled else { return }; enabled = true
        let context = Unmanaged.passUnretained(self).toOpaque()
        if let register, unregister != nil { for event: UInt32 in [1502, 1503] { if register(captureCallback, event, context) == 0 { events.append(event) } } }
    }
    func stop() {
        enabled = false
        let context = Unmanaged.passUnretained(self).toOpaque()
        if let unregister { for event in events { _ = unregister(captureCallback, event, context) } }; events.removeAll()
    }
    func snapshot() -> [String: Any] {
        guard enabled, let query else { return ["available": false, "active": NSNull()] }
        return ["available": true, "active": query()]
    }
    deinit { stop(); if let handle { dlclose(handle) } }
}
