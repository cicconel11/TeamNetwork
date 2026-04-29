// TeamMeetWidgetBundle.swift
// TeamMeetWidget
//
// Entry point for the widget extension. The bundle exposes every widget the
// extension provides. Today that's only the EventLiveActivityWidget; if we
// add a Lock Screen complication or Home Screen widget later it goes in this
// list too.

import SwiftUI
import WidgetKit

@main
struct TeamMeetWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 17.0, *) {
            EventLiveActivityWidget()
        }
    }
}
