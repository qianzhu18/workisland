// Adapted from SkyLightWindow by Lakr Aream (MIT). See SkyLightWindow-LICENSE.
// https://github.com/Lakr233/SkyLightWindow/blob/main/Sources/SkyLightWindow/SkyLightOperator.swift
import AppKit

final class LockScreenHost {
    typealias Connection = @convention(c) () -> Int32
    typealias Create = @convention(c) (Int32, Int32, Int32) -> UInt64
    typealias Level = @convention(c) (Int32, UInt64, Int32) -> Void
    typealias Show = @convention(c) (Int32, CFArray) -> Void
    typealias Add = @convention(c) (Int32, UInt64, CFArray, Int32) -> Void
    typealias Destroy = @convention(c) (Int32, UInt64) -> Void
    let handle = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW)
    var error: String?
    var connection: Int32 = 0
    var space: UInt64 = 0
    var add: Add?
    var show: Show?
    var available: Bool { error == nil && add != nil }
    init() {
        guard let handle,
            let main = dlsym(handle, "SLSMainConnectionID"), let create = dlsym(handle, "SLSSpaceCreate"),
            let level = dlsym(handle, "SLSSpaceSetAbsoluteLevel"), let show = dlsym(handle, "SLSShowSpaces"),
            let add = dlsym(handle, "SLSSpaceAddWindowsAndRemoveFromSpaces") else {
            error = "Lock-screen hosting is unavailable on this macOS version"; return
        }
        connection = unsafeBitCast(main, to: Connection.self)()
        space = unsafeBitCast(create, to: Create.self)(connection, 1, 0)
        guard connection != 0, space != 0 else {
            error = "macOS refused the lock-screen space"; return
        }
        unsafeBitCast(level, to: Level.self)(connection, space, 400)
        self.add = unsafeBitCast(add, to: Add.self)
        self.show = unsafeBitCast(show, to: Show.self)
    }
    func delegate(_ window: NSWindow) {
        add?(connection, space, [window.windowNumber] as CFArray, 7)
        show?(connection, [space] as CFArray)
        if let handle, let get = dlsym(handle, "SLSSpaceGetAbsoluteLevel") {
            typealias GetLevel = @convention(c) (Int32, UInt64) -> Int32
            let actualLevel = unsafeBitCast(get, to: GetLevel.self)(connection, space)
            if actualLevel != 400 { error = "macOS refused the lock-screen space level" }
        }
    }
    deinit {
        if let handle {
            if space != 0, let destroy = dlsym(handle, "SLSSpaceDestroy") { unsafeBitCast(destroy, to: Destroy.self)(connection, space) }
            dlclose(handle)
        }
    }
}
