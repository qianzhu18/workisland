import CoreBluetooth

// Even reading paired-device metadata is protected by TCC. Never request
// authorization while polling; CoreAudio still reports the active output.
func authorizedBluetoothDevices<Device>(authorization: CBManagerAuthorization, read: () -> [Device]) -> [Device] {
    guard authorization == .allowedAlways else { return [] }
    return read()
}
