import Foundation

enum PowerMetrics {
    static func chargingWatts(amperage: Double?, voltage: Double?, charging: Bool) -> Double? {
        guard charging, let amperage, let voltage, amperage >= 0, amperage <= 100_000, voltage > 0, voltage <= 100_000,
              amperage.isFinite, voltage.isFinite else { return nil }
        return amperage * voltage / 1_000_000
    }
}
