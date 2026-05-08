// EventActivityAttributes.swift
// LiveActivity (RN module)
//
// IMPORTANT: This file MUST stay byte-identical to
// `apps/mobile/targets/widget/EventActivityAttributes.swift`.
// The widget target compiles its own copy so that the SwiftUI views can
// reference the type without importing the host module. The RN bridge
// compiles a second copy here so that `LiveActivityModule.swift` can
// instantiate `Activity<EventActivityAttributes>` without a cross-target
// header dependency that CocoaPods sandboxing forbids.
//
// If you change one, change the other. A drift between the two struct
// definitions corrupts ActivityKit payloads and crashes the widget at
// runtime. Consider extracting both into a shared Swift Package once
// `@bacons/apple-targets` adds first-class SPM support.

import ActivityKit
import Foundation

@available(iOS 16.1, *)
public struct EventActivityAttributes: ActivityAttributes {
    public typealias EventStatus = ContentState

    public struct ContentState: Codable, Hashable {
        public var checkedInCount: Int
        public var totalAttending: Int
        public var isCheckedIn: Bool
        public var status: String
        public var startsAt: Date
        public var endsAt: Date

        public init(
            checkedInCount: Int,
            totalAttending: Int,
            isCheckedIn: Bool,
            status: String,
            startsAt: Date,
            endsAt: Date
        ) {
            self.checkedInCount = checkedInCount
            self.totalAttending = totalAttending
            self.isCheckedIn = isCheckedIn
            self.status = status
            self.startsAt = startsAt
            self.endsAt = endsAt
        }
    }

    public var eventId: String
    public var orgSlug: String
    public var orgName: String
    public var eventTitle: String

    public init(
        eventId: String,
        orgSlug: String,
        orgName: String,
        eventTitle: String
    ) {
        self.eventId = eventId
        self.orgSlug = orgSlug
        self.orgName = orgName
        self.eventTitle = eventTitle
    }
}
