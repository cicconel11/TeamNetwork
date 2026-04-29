// EventActivityAttributes.swift
// TeamMeetWidget
//
// Defines the ActivityAttributes payload that the host app passes to
// `Activity.request(...)` and that APNs Live Activity pushes mutate via the
// `content-state` field.
//
// Static fields (ActivityAttributes): set once at start, never change.
// Dynamic fields (ContentState): pushed by the dispatcher whenever an
// event_rsvps row mutates (check-in, status change) or the event itself
// changes (cancellation, end_date shift).

import ActivityKit
import Foundation

@available(iOS 16.1, *)
public struct EventActivityAttributes: ActivityAttributes {
    public typealias EventStatus = ContentState

    public struct ContentState: Codable, Hashable {
        /// How many attendees have been checked in so far. Source of truth:
        /// `event_rsvps.checked_in_at IS NOT NULL` rows for this event.
        public var checkedInCount: Int

        /// How many people RSVP'd `attending`. Recomputed by the dispatcher
        /// trigger so we don't have to track it from the device.
        public var totalAttending: Int

        /// Whether *this* user has been checked in. Lets the lock-screen card
        /// flip from "Heading in" to "Checked in ✓".
        public var isCheckedIn: Bool

        /// Coarse status string mirroring the event row: 'live' | 'starting'
        /// | 'ended' | 'cancelled'. The widget switches its visual theme on
        /// this so cancellations look distinct from a live event ending.
        public var status: String

        /// Activity end timestamp (Unix seconds). The widget uses this for
        /// the on-card progress bar; APNs uses `apns-expiration` separately.
        public var endsAt: Date

        public init(
            checkedInCount: Int,
            totalAttending: Int,
            isCheckedIn: Bool,
            status: String,
            endsAt: Date
        ) {
            self.checkedInCount = checkedInCount
            self.totalAttending = totalAttending
            self.isCheckedIn = isCheckedIn
            self.status = status
            self.endsAt = endsAt
        }
    }

    /// Stable across the lifetime of the activity. Used for deep-linking the
    /// "Open in TeamMeet" tap target back to `teammeet://events/<id>`.
    public var eventId: String

    /// Org slug — used in the deep link path so the host app can resolve the
    /// right org context immediately.
    public var orgSlug: String

    /// Display strings cached at activity start so the widget renders
    /// correctly even when the watch is offline / the host app is suspended.
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
