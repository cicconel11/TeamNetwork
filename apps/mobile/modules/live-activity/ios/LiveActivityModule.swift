// LiveActivityModule.swift
// TeamMeet
//
// Expo Modules bridge for iOS Live Activities (ActivityKit).
//
// Exposes four async functions to JS:
//   - isSupported() -> bool
//   - start(args)   -> { activityId, pushToken } | null
//   - update(activityId, contentState)
//   - end(activityId, contentState?, dismissalPolicy?)
//
// And one event:
//   - onPushTokenUpdate { activityId, pushToken }
//
// The widget extension target ships EventActivityAttributes; this module is in
// the host app target. Both reference the same Swift struct via the file
// being included in both targets at build time (Xcode shared compilation).

import ActivityKit
import ExpoModulesCore

public class LiveActivityModule: Module {
    private var pushTokenObservers: [String: Task<Void, Never>] = [:]

    public func definition() -> ModuleDefinition {
        Name("LiveActivityModule")

        Events("onPushTokenUpdate", "onActivityStateChange")

        AsyncFunction("isSupported") { () -> Bool in
            if #available(iOS 16.1, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
            return false
        }

        AsyncFunction("start") { (args: [String: Any]) async throws -> [String: String]? in
            guard #available(iOS 17.0, *) else {
                throw LiveActivityError.unsupportedOSVersion
            }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                throw LiveActivityError.notAuthorized
            }

            guard
                let eventId = args["eventId"] as? String,
                let orgSlug = args["orgSlug"] as? String,
                let orgName = args["orgName"] as? String,
                let eventTitle = args["eventTitle"] as? String,
                let stateRaw = args["contentState"] as? [String: Any]
            else {
                throw LiveActivityError.invalidArguments
            }

            let attributes = EventActivityAttributes(
                eventId: eventId,
                orgSlug: orgSlug,
                orgName: orgName,
                eventTitle: eventTitle
            )
            let state = try Self.parseContentState(stateRaw)
            let staleDateRaw = args["staleDate"] as? Double
            let staleDate = staleDateRaw.map { Date(timeIntervalSince1970: $0) }

            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: staleDate),
                pushType: .token
            )

            let activityId = activity.id
            self.observePushToken(for: activity)

            // Wait briefly for the first token so the host app can register
            // it with the server before returning. If APNs is slow we fall
            // back to nil and the JS side relies on the onPushTokenUpdate
            // event for late delivery.
            let initialToken = await Self.firstToken(activity, timeoutSeconds: 5)
            return [
                "activityId": activityId,
                "pushToken": initialToken ?? "",
            ]
        }

        AsyncFunction("update") { (activityId: String, stateRaw: [String: Any]) async throws -> Void in
            guard #available(iOS 16.2, *) else { return }
            let state = try Self.parseContentState(stateRaw)
            for activity in Activity<EventActivityAttributes>.activities where activity.id == activityId {
                await activity.update(.init(state: state, staleDate: nil))
            }
        }

        AsyncFunction("end") { (activityId: String, finalStateRaw: [String: Any]?, policyRaw: String?) async throws -> Void in
            guard #available(iOS 16.2, *) else { return }
            let policy: ActivityUIDismissalPolicy = {
                switch policyRaw {
                case "immediate": return .immediate
                case "default": return .default
                default: return .immediate
                }
            }()
            for activity in Activity<EventActivityAttributes>.activities where activity.id == activityId {
                let content: ActivityContent<EventActivityAttributes.ContentState>?
                if let finalStateRaw {
                    let state = try Self.parseContentState(finalStateRaw)
                    content = .init(state: state, staleDate: nil)
                } else {
                    content = nil
                }
                await activity.end(content, dismissalPolicy: policy)
                self.cancelTokenObserver(activityId: activityId)
            }
        }

        AsyncFunction("endAll") { (policyRaw: String?) async throws -> Void in
            guard #available(iOS 16.2, *) else { return }
            let policy: ActivityUIDismissalPolicy = policyRaw == "default" ? .default : .immediate
            for activity in Activity<EventActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: policy)
                self.cancelTokenObserver(activityId: activity.id)
            }
        }

        AsyncFunction("listActive") { () -> [[String: String]] in
            guard #available(iOS 16.1, *) else { return [] }
            return Activity<EventActivityAttributes>.activities.map { activity in
                [
                    "activityId": activity.id,
                    "eventId": activity.attributes.eventId,
                    "orgSlug": activity.attributes.orgSlug,
                ]
            }
        }
    }

    // MARK: - Helpers

    @available(iOS 17.0, *)
    private func observePushToken(for activity: Activity<EventActivityAttributes>) {
        let activityId = activity.id
        let task = Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                let hex = tokenData.map { String(format: "%02x", $0) }.joined()
                self?.sendEvent("onPushTokenUpdate", [
                    "activityId": activityId,
                    "pushToken": hex,
                ])
            }
        }
        pushTokenObservers[activityId] = task
    }

    private func cancelTokenObserver(activityId: String) {
        pushTokenObservers[activityId]?.cancel()
        pushTokenObservers.removeValue(forKey: activityId)
    }

    @available(iOS 17.0, *)
    private static func firstToken(_ activity: Activity<EventActivityAttributes>, timeoutSeconds: UInt64) async -> String? {
        let stream = activity.pushTokenUpdates
        return await withTaskGroup(of: String?.self) { group in
            group.addTask {
                for await data in stream {
                    return data.map { String(format: "%02x", $0) }.joined()
                }
                return nil
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: timeoutSeconds * 1_000_000_000)
                return nil
            }
            for await result in group {
                if result != nil {
                    group.cancelAll()
                    return result
                }
            }
            return nil
        }
    }

    private static func parseContentState(_ raw: [String: Any]) throws -> EventActivityAttributes.ContentState {
        guard
            let checkedInCount = raw["checkedInCount"] as? Int,
            let totalAttending = raw["totalAttending"] as? Int,
            let isCheckedIn = raw["isCheckedIn"] as? Bool,
            let status = raw["status"] as? String,
            let startsAtRaw = raw["startsAt"] as? Double,
            let endsAtRaw = raw["endsAt"] as? Double
        else {
            throw LiveActivityError.invalidArguments
        }
        return EventActivityAttributes.ContentState(
            checkedInCount: checkedInCount,
            totalAttending: totalAttending,
            isCheckedIn: isCheckedIn,
            status: status,
            startsAt: Date(timeIntervalSince1970: startsAtRaw),
            endsAt: Date(timeIntervalSince1970: endsAtRaw)
        )
    }
}

enum LiveActivityError: Error, CustomStringConvertible {
    case unsupportedOSVersion
    case notAuthorized
    case invalidArguments

    var description: String {
        switch self {
        case .unsupportedOSVersion: return "Live Activities require iOS 17+"
        case .notAuthorized: return "Live Activities are disabled in iOS Settings"
        case .invalidArguments: return "Invalid arguments passed to LiveActivityModule"
        }
    }
}
