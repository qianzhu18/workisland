import Foundation
import CoreBluetooth
func check(_ value: Bool, _ message: String) { if !value { fatalError(message) } }
check(PowerMetrics.chargingWatts(amperage: 2000, voltage: 12000, charging: true) == 24, "mA and mV convert to watts")
check(PowerMetrics.chargingWatts(amperage: -2000, voltage: 12000, charging: false) == nil, "discharge is not charging watts")
check(PowerMetrics.chargingWatts(amperage: nil, voltage: 12000, charging: true) == nil, "missing current is unknown")
check(PowerMetrics.chargingWatts(amperage: 0, voltage: 12000, charging: true) == 0, "zero is real telemetry")
check(PowerMetrics.chargingWatts(amperage: -2000, voltage: 12000, charging: true) == nil, "negative current must not be made positive")
check(PowerMetrics.chargingWatts(amperage: .infinity, voltage: 12000, charging: true) == nil, "nonfinite current is unknown")
check(PowerMetrics.chargingWatts(amperage: Double(UInt64.max), voltage: 12000, charging: true) == nil, "unsigned negative telemetry must not become huge watts")
print("Power telemetry tests passed")

var bluetoothReads = 0
for authorization: CBManagerAuthorization in [.notDetermined, .denied, .restricted] {
    let devices: [String] = authorizedBluetoothDevices(authorization: authorization) {
        bluetoothReads += 1
        return ["Headphones"]
    }
    check(devices.isEmpty, "unauthorized Bluetooth access returns no extra devices")
}
check(bluetoothReads == 0, "unauthorized states must never invoke the privacy-sensitive reader")
let devices = authorizedBluetoothDevices(authorization: .allowedAlways) {
    bluetoothReads += 1
    return ["Headphones"]
}
check(devices == ["Headphones"] && bluetoothReads == 1, "authorized access preserves connected devices")
print("Bluetooth privacy tests passed")
