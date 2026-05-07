/**
 * useUnifiedCalendar Hook Helper Functions Tests
 *
 * Only tests the pure helper functions exported from the module.
 * The hook itself requires a React Native environment.
 */

describe("useUnifiedCalendar helpers", () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  let normalizeEvent: typeof import("../../src/hooks/useUnifiedCalendar").normalizeEvent;
  let expandScheduleOccurrences: typeof import("../../src/hooks/useUnifiedCalendar").expandScheduleOccurrences;
  let sortByStartAt: typeof import("../../src/hooks/useUnifiedCalendar").sortByStartAt;
  let filterBySource: typeof import("../../src/hooks/useUnifiedCalendar").filterBySource;
  let groupByDate: typeof import("../../src/hooks/useUnifiedCalendar").groupByDate;
  let toDateKey: typeof import("../../src/hooks/useUnifiedCalendar").toDateKey;
  type UnifiedCalendarItem = import("../../src/hooks/useUnifiedCalendar").UnifiedCalendarItem;
  type EventRow = import("../../src/hooks/useUnifiedCalendar").EventRow;
  type AcademicSchedule = import("@teammeet/types").AcademicSchedule;

  beforeAll(() => {
    jest.mock("@/lib/supabase", () => ({
      supabase: {
        from: jest.fn(),
        rpc: jest.fn(),
        auth: { getUser: jest.fn() },
        channel: jest.fn(() => ({
          on: jest.fn().mockReturnThis(),
          subscribe: jest.fn(),
        })),
        removeChannel: jest.fn(),
      },
    }));

    jest.mock("@/hooks/useAuth", () => ({
      useAuth: jest.fn(() => ({ user: null })),
    }));

    jest.mock("@/hooks/useRequestTracker", () => ({
      useRequestTracker: jest.fn(() => ({
        beginRequest: jest.fn(() => 1),
        invalidateRequests: jest.fn(),
        isCurrentRequest: jest.fn(() => true),
      })),
    }));

    jest.mock("@/components/ui/Toast", () => ({
      showToast: jest.fn(),
    }));

    jest.mock("@/lib/analytics/sentry", () => ({
      captureException: jest.fn(),
    }));

    jest.mock("react", () => ({
      useEffect: jest.fn(),
      useState: jest.fn((initial: unknown) => [initial, jest.fn()]),
      useRef: jest.fn((initial: unknown) => ({ current: initial })),
      useCallback: jest.fn((fn: unknown) => fn),
      useMemo: jest.fn((fn: () => unknown) => fn()),
    }));

    const mod = require("../../src/hooks/useUnifiedCalendar");
    normalizeEvent = mod.normalizeEvent;
    expandScheduleOccurrences = mod.expandScheduleOccurrences;
    sortByStartAt = mod.sortByStartAt;
    filterBySource = mod.filterBySource;
    groupByDate = mod.groupByDate;
    toDateKey = mod.toDateKey;
  });

  afterAll(() => {
    jest.unmock("@/lib/supabase");
    jest.unmock("@/hooks/useAuth");
    jest.unmock("@/hooks/useRequestTracker");
    jest.unmock("@/components/ui/Toast");
    jest.unmock("@/lib/analytics/sentry");
    jest.unmock("react");
  });

  // -------------------------------------------------------------------------
  // Test fixtures
  // -------------------------------------------------------------------------

  function makeSchedule(overrides: Partial<AcademicSchedule> = {}): AcademicSchedule {
    return {
      id: "sched-1",
      organization_id: "org-1",
      user_id: "user-1",
      title: "Algorithms 101",
      occurrence_type: "weekly",
      day_of_week: [1, 3], // Mon, Wed
      day_of_month: null,
      start_date: "2026-04-06", // Monday
      end_date: null,
      start_time: "09:00",
      end_time: "10:30",
      notes: null,
      created_at: null,
      updated_at: null,
      deleted_at: null,
      ...overrides,
    } as AcademicSchedule;
  }

  function makeEvent(overrides: Partial<EventRow> = {}): EventRow {
    return {
      id: "evt-1",
      title: "Team Practice",
      start_date: "2026-04-08T18:00:00.000Z",
      end_date: "2026-04-08T19:30:00.000Z",
      location: "Field A",
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // expandScheduleOccurrences
  // -------------------------------------------------------------------------

  describe("expandScheduleOccurrences", () => {
    it("expands a weekly schedule across the visible window", () => {
      const schedule = makeSchedule({
        day_of_week: [1, 3], // Mon, Wed
        start_date: "2026-04-06",
      });
      const windowStart = new Date(2026, 3, 6); // Mon Apr 6
      const windowEnd = new Date(2026, 4, 5, 23, 59, 59); // Tue May 5

      const items = expandScheduleOccurrences(schedule, windowStart, windowEnd);

      // Mon Apr 6, Wed Apr 8, Mon Apr 13, Wed Apr 15, Mon Apr 20, Wed Apr 22,
      // Mon Apr 27, Wed Apr 29, Mon May 4 = 9 occurrences
      expect(items).toHaveLength(9);
      items.forEach((item) => {
        const dayOfWeek = new Date(item.startAt).getDay();
        expect([1, 3]).toContain(dayOfWeek);
        expect(item.sourceType).toBe("schedule");
        expect(item.sourceName).toBe("My Schedule");
        expect(item.scheduleId).toBe("sched-1");
      });
    });

    it("returns empty array for weekly with no day_of_week", () => {
      const schedule = makeSchedule({ day_of_week: null });
      const windowStart = new Date(2026, 3, 6);
      const windowEnd = new Date(2026, 4, 6);

      expect(expandScheduleOccurrences(schedule, windowStart, windowEnd)).toEqual([]);
    });

    it("returns empty array for weekly with empty day_of_week", () => {
      const schedule = makeSchedule({ day_of_week: [] });
      const windowStart = new Date(2026, 3, 6);
      const windowEnd = new Date(2026, 4, 6);

      expect(expandScheduleOccurrences(schedule, windowStart, windowEnd)).toEqual([]);
    });

    it("emits exactly one occurrence for a single schedule in window", () => {
      const schedule = makeSchedule({
        occurrence_type: "single",
        start_date: "2026-04-10",
        day_of_week: null,
      });
      const windowStart = new Date(2026, 3, 1);
      const windowEnd = new Date(2026, 3, 30);

      const items = expandScheduleOccurrences(schedule, windowStart, windowEnd);
      expect(items).toHaveLength(1);
    });

    it("emits no occurrence for a single schedule outside the window", () => {
      const schedule = makeSchedule({
        occurrence_type: "single",
        start_date: "2026-01-01",
        day_of_week: null,
      });
      const windowStart = new Date(2026, 3, 1);
      const windowEnd = new Date(2026, 3, 30);

      const items = expandScheduleOccurrences(schedule, windowStart, windowEnd);
      expect(items).toHaveLength(0);
    });

    it("respects schedule.end_date when expanding daily occurrences", () => {
      const schedule = makeSchedule({
        occurrence_type: "daily",
        start_date: "2026-04-06",
        end_date: "2026-04-10", // 5 days inclusive
        day_of_week: null,
      });
      const windowStart = new Date(2026, 3, 1);
      const windowEnd = new Date(2026, 4, 30);

      const items = expandScheduleOccurrences(schedule, windowStart, windowEnd);
      expect(items).toHaveLength(5);
    });

    it("respects schedule.start_date as the lower bound", () => {
      const schedule = makeSchedule({
        occurrence_type: "daily",
        start_date: "2026-04-15",
        day_of_week: null,
      });
      const windowStart = new Date(2026, 3, 1);
      const windowEnd = new Date(2026, 3, 20);

      const items = expandScheduleOccurrences(schedule, windowStart, windowEnd);
      // Apr 15, 16, 17, 18, 19, 20 = 6 days
      expect(items).toHaveLength(6);
      items.forEach((item) => {
        expect(new Date(item.startAt).getDate()).toBeGreaterThanOrEqual(15);
      });
    });

    it("expands a monthly schedule on the matching day_of_month", () => {
      const schedule = makeSchedule({
        occurrence_type: "monthly",
        day_of_month: 15,
        day_of_week: null,
        start_date: "2026-01-01",
      });
      const windowStart = new Date(2026, 3, 1); // Apr 1
      const windowEnd = new Date(2026, 5, 30); // Jun 30

      const items = expandScheduleOccurrences(schedule, windowStart, windowEnd);
      // Apr 15, May 15, Jun 15 = 3 occurrences
      expect(items).toHaveLength(3);
      items.forEach((item) => {
        expect(new Date(item.startAt).getDate()).toBe(15);
      });
    });

    it("uses stable ID format schedule:<id>:<YYYY-MM-DD>", () => {
      const schedule = makeSchedule({
        occurrence_type: "single",
        start_date: "2026-04-10",
        day_of_week: null,
      });
      const windowStart = new Date(2026, 3, 1);
      const windowEnd = new Date(2026, 3, 30);

      const items = expandScheduleOccurrences(schedule, windowStart, windowEnd);
      expect(items[0].id).toBe("schedule:sched-1:2026-04-10");
    });

    it("combines start_date with start_time to produce a local timestamp", () => {
      const schedule = makeSchedule({
        occurrence_type: "single",
        start_date: "2026-04-10",
        start_time: "14:30",
        end_time: "16:00",
        day_of_week: null,
      });
      const windowStart = new Date(2026, 3, 1);
      const windowEnd = new Date(2026, 3, 30);

      const [item] = expandScheduleOccurrences(schedule, windowStart, windowEnd);
      const start = new Date(item.startAt);
      expect(start.getHours()).toBe(14);
      expect(start.getMinutes()).toBe(30);
      const end = new Date(item.endAt as string);
      expect(end.getHours()).toBe(16);
      expect(end.getMinutes()).toBe(0);
    });

    it("returns empty for unknown occurrence_type", () => {
      const schedule = makeSchedule({
        occurrence_type: "yearly", // unsupported
      });
      const windowStart = new Date(2026, 3, 1);
      const windowEnd = new Date(2026, 4, 1);

      expect(expandScheduleOccurrences(schedule, windowStart, windowEnd)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // normalizeEvent
  // -------------------------------------------------------------------------

  describe("normalizeEvent", () => {
    it("maps an event row to UnifiedCalendarItem with sourceType=event", () => {
      const event = makeEvent();
      const item = normalizeEvent(event);
      expect(item.sourceType).toBe("event");
      expect(item.sourceName).toBe("Team Event");
      expect(item.title).toBe("Team Practice");
      expect(item.eventId).toBe("evt-1");
    });

    it("preserves location and end_date", () => {
      const event = makeEvent({
        location: "Gym B",
        end_date: "2026-04-08T20:00:00.000Z",
      });
      const item = normalizeEvent(event);
      expect(item.location).toBe("Gym B");
      expect(item.endAt).toBe("2026-04-08T20:00:00.000Z");
    });

    it("uses ID format event:<uuid>", () => {
      const item = normalizeEvent(makeEvent({ id: "abc-123" }));
      expect(item.id).toBe("event:abc-123");
    });

    it("handles null location and null end_date", () => {
      const item = normalizeEvent(
        makeEvent({ location: null, end_date: null })
      );
      expect(item.location).toBeNull();
      expect(item.endAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // sortByStartAt
  // -------------------------------------------------------------------------

  describe("sortByStartAt", () => {
    it("sorts items chronologically ascending", () => {
      const items: UnifiedCalendarItem[] = [
        normalizeEvent(makeEvent({ id: "c", start_date: "2026-04-10T09:00:00Z" })),
        normalizeEvent(makeEvent({ id: "a", start_date: "2026-04-05T09:00:00Z" })),
        normalizeEvent(makeEvent({ id: "b", start_date: "2026-04-07T09:00:00Z" })),
      ];
      const sorted = sortByStartAt(items);
      expect(sorted.map((i) => i.eventId)).toEqual(["a", "b", "c"]);
    });

    it("does not mutate the input array", () => {
      const items: UnifiedCalendarItem[] = [
        normalizeEvent(makeEvent({ id: "c", start_date: "2026-04-10T09:00:00Z" })),
        normalizeEvent(makeEvent({ id: "a", start_date: "2026-04-05T09:00:00Z" })),
      ];
      const original = items.map((i) => i.eventId);
      sortByStartAt(items);
      expect(items.map((i) => i.eventId)).toEqual(original);
    });
  });

  // -------------------------------------------------------------------------
  // filterBySource
  // -------------------------------------------------------------------------

  describe("filterBySource", () => {
    function makePair() {
      const eventItem = normalizeEvent(makeEvent({ id: "evt-1" }));
      const [scheduleItem] = expandScheduleOccurrences(
        makeSchedule({
          occurrence_type: "single",
          start_date: "2026-04-10",
          day_of_week: null,
        }),
        new Date(2026, 3, 1),
        new Date(2026, 3, 30)
      );
      return { eventItem, scheduleItem };
    }

    it("returns all items when source is 'all'", () => {
      const { eventItem, scheduleItem } = makePair();
      const items = [eventItem, scheduleItem];
      expect(filterBySource(items, "all")).toEqual(items);
    });

    it("filters to only events when source is 'event'", () => {
      const { eventItem, scheduleItem } = makePair();
      const items = [eventItem, scheduleItem];
      expect(filterBySource(items, "event")).toEqual([eventItem]);
    });

    it("filters to only schedules when source is 'schedule'", () => {
      const { eventItem, scheduleItem } = makePair();
      const items = [eventItem, scheduleItem];
      expect(filterBySource(items, "schedule")).toEqual([scheduleItem]);
    });
  });

  // -------------------------------------------------------------------------
  // groupByDate
  // -------------------------------------------------------------------------

  describe("groupByDate", () => {
    it("returns empty array for empty input", () => {
      expect(groupByDate([])).toEqual([]);
    });

    it("groups merged events and schedules by local date", () => {
      const now = new Date(2026, 3, 6, 10, 0, 0); // Mon Apr 6, 10:00 local
      const items = sortByStartAt([
        normalizeEvent(
          makeEvent({
            id: "evt-tue",
            start_date: new Date(2026, 3, 7, 18, 0, 0).toISOString(),
          })
        ),
        normalizeEvent(
          makeEvent({
            id: "evt-mon",
            start_date: new Date(2026, 3, 6, 14, 0, 0).toISOString(),
          })
        ),
        normalizeEvent(
          makeEvent({
            id: "evt-wed",
            start_date: new Date(2026, 3, 8, 9, 0, 0).toISOString(),
          })
        ),
      ]);

      const groups = groupByDate(items, now);
      expect(groups).toHaveLength(3);
      expect(groups[0].dateKey).toBe(toDateKey(new Date(2026, 3, 6)));
      expect(groups[1].dateKey).toBe(toDateKey(new Date(2026, 3, 7)));
      expect(groups[2].dateKey).toBe(toDateKey(new Date(2026, 3, 8)));
    });

    it("labels today and tomorrow specifically", () => {
      const now = new Date(2026, 3, 6, 10, 0, 0); // Mon Apr 6
      const items = [
        normalizeEvent(
          makeEvent({
            id: "today",
            start_date: new Date(2026, 3, 6, 14, 0, 0).toISOString(),
          })
        ),
        normalizeEvent(
          makeEvent({
            id: "tomorrow",
            start_date: new Date(2026, 3, 7, 14, 0, 0).toISOString(),
          })
        ),
        normalizeEvent(
          makeEvent({
            id: "later",
            start_date: new Date(2026, 3, 12, 14, 0, 0).toISOString(),
          })
        ),
      ];

      const groups = groupByDate(items, now);
      expect(groups[0].label).toBe("Today");
      expect(groups[1].label).toBe("Tomorrow");
      expect(groups[2].label).not.toBe("Today");
      expect(groups[2].label).not.toBe("Tomorrow");
    });
  });

  // -------------------------------------------------------------------------
  // End-to-end pipeline
  // -------------------------------------------------------------------------

  describe("end-to-end pipeline", () => {
    it("returns empty list when org has neither events nor schedules", () => {
      const merged = sortByStartAt([
        ...[].map(normalizeEvent),
        ...[].flatMap((schedule: AcademicSchedule) =>
          expandScheduleOccurrences(
            schedule,
            new Date(2026, 3, 1),
            new Date(2026, 3, 30)
          )
        ),
      ]);
      expect(merged).toEqual([]);
      expect(groupByDate(merged)).toEqual([]);
    });

    it("merges events + schedules into chronological order", () => {
      const events: EventRow[] = [
        makeEvent({
          id: "e1",
          start_date: new Date(2026, 3, 7, 18, 0, 0).toISOString(),
        }),
        makeEvent({
          id: "e2",
          start_date: new Date(2026, 3, 9, 12, 0, 0).toISOString(),
        }),
      ];
      const schedule = makeSchedule({
        occurrence_type: "weekly",
        day_of_week: [1, 3], // Mon, Wed
        start_date: "2026-04-06",
      });
      const windowStart = new Date(2026, 3, 6);
      const windowEnd = new Date(2026, 3, 12, 23, 59, 59);

      const normalizedEvents = events.map(normalizeEvent);
      const expandedSchedules = expandScheduleOccurrences(
        schedule,
        windowStart,
        windowEnd
      );

      // Schedule should produce 2 occurrences: Mon Apr 6, Wed Apr 8
      expect(expandedSchedules).toHaveLength(2);

      const merged = sortByStartAt([...normalizedEvents, ...expandedSchedules]);
      expect(merged).toHaveLength(4);

      // Verify chronological order
      for (let i = 1; i < merged.length; i++) {
        expect(merged[i - 1].startAt <= merged[i].startAt).toBe(true);
      }

      // Mix of source types
      const sources = merged.map((i) => i.sourceType);
      expect(sources).toContain("event");
      expect(sources).toContain("schedule");
    });
  });
});
