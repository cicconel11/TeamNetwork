// EventLiveActivityWidget.swift
// TeamMeetWidget
//
// SwiftUI rendering for the event Live Activity:
//   - Lock Screen card (full size).
//   - Dynamic Island compact / minimal / expanded leading + trailing + center.
//
// Interactive iOS 17 button "Open in TeamMeet" deep-links to
// `teammeet://events/<id>` so a single tap takes the user from the Lock Screen
// to the event detail screen in the host app.
//
// We intentionally keep typography and palette inline rather than depending on
// a shared design-tokens module — the widget extension cannot import host-app
// JS bundles, and Swift has no access to our `design-tokens.ts`. The chosen
// values mirror the dark-blue accent (`#2563eb`) used for primary actions in
// the host app.

import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@available(iOS 17.0, *)
struct EventLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: EventActivityAttributes.self) { context in
            EventLockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.65))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.orgName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(context.attributes.eventTitle)
                            .font(.headline)
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    AttendingCounter(
                        checkedInCount: context.state.checkedInCount,
                        totalAttending: context.state.totalAttending
                    )
                }
                DynamicIslandExpandedRegion(.bottom) {
                    OpenInAppButton(
                        eventId: context.attributes.eventId,
                        orgSlug: context.attributes.orgSlug
                    )
                }
            } compactLeading: {
                Image(systemName: "person.2.fill")
                    .foregroundStyle(.tint)
            } compactTrailing: {
                Text("\(context.state.checkedInCount)/\(context.state.totalAttending)")
                    .monospacedDigit()
                    .font(.caption)
                    .fontWeight(.semibold)
            } minimal: {
                Image(systemName: context.state.isCheckedIn ? "checkmark.seal.fill" : "person.2.fill")
                    .foregroundStyle(.tint)
            }
            .widgetURL(URL(string: "teammeet://events/\(context.attributes.eventId)"))
            .keylineTint(Color(red: 0.145, green: 0.388, blue: 0.922))
        }
    }
}

// MARK: - Lock Screen card

@available(iOS 17.0, *)
private struct EventLockScreenView: View {
    let context: ActivityViewContext<EventActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.orgName.uppercased())
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .tracking(1.0)
                        .foregroundStyle(.white.opacity(0.7))
                    Text(context.attributes.eventTitle)
                        .font(.headline)
                        .foregroundStyle(.white)
                        .lineLimit(2)
                }
                Spacer(minLength: 12)
                StatusBadge(status: context.state.status, isCheckedIn: context.state.isCheckedIn)
            }

            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(context.state.checkedInCount)")
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                Text("/ \(context.state.totalAttending) checked in")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
            }

            ProgressView(
                value: Double(context.state.checkedInCount),
                total: Double(max(context.state.totalAttending, 1))
            )
            .progressViewStyle(.linear)
            .tint(Color(red: 0.145, green: 0.388, blue: 0.922))

            OpenInAppButton(
                eventId: context.attributes.eventId,
                orgSlug: context.attributes.orgSlug
            )
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 16)
    }
}

// MARK: - Sub-views

@available(iOS 17.0, *)
private struct AttendingCounter: View {
    let checkedInCount: Int
    let totalAttending: Int

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text("\(checkedInCount)/\(totalAttending)")
                .font(.title2)
                .fontWeight(.bold)
                .monospacedDigit()
            Text("checked in")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

@available(iOS 17.0, *)
private struct StatusBadge: View {
    let status: String
    let isCheckedIn: Bool

    var label: String {
        switch status {
        case "live": return isCheckedIn ? "You're in" : "Live"
        case "starting": return "Starting"
        case "ended": return "Ended"
        case "cancelled": return "Cancelled"
        default: return status.capitalized
        }
    }

    var color: Color {
        switch status {
        case "live": return Color(red: 0.145, green: 0.388, blue: 0.922)
        case "starting": return .orange
        case "ended": return .gray
        case "cancelled": return .red
        default: return .gray
        }
    }

    var body: some View {
        Text(label)
            .font(.caption2)
            .fontWeight(.semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.25))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }
}

@available(iOS 17.0, *)
private struct OpenInAppButton: View {
    let eventId: String
    let orgSlug: String

    var body: some View {
        Link(destination: URL(string: "teammeet://events/\(eventId)")!) {
            HStack(spacing: 6) {
                Image(systemName: "arrow.up.forward.app")
                Text("Open in TeamMeet")
                    .fontWeight(.semibold)
            }
            .font(.footnote)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(red: 0.145, green: 0.388, blue: 0.922))
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}
