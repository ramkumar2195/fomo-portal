"use client";

import React from "react";

export interface WeeklyCalendarDay {
  key: string;
  label: string;
}

export interface WeeklyCalendarEvent {
  id: string;
  dayKey: string;
  startTime: string;
  endTime?: string;
  title: string;
  subtitle?: string;
  meta?: string;
  tone?: "slate" | "emerald" | "amber" | "rose" | "violet" | "sky";
  onClick?: () => void;
  actions?: WeeklyCalendarAction[];
}

export interface WeeklyCalendarAction {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
}

export interface WeeklyCalendarFreeSlot {
  id: string;
  dayKey: string;
  startTime: string;
  endTime: string;
  label?: string;
  onClick: () => void;
}

const TONE_CLASS: Record<NonNullable<WeeklyCalendarEvent["tone"]>, string> = {
  slate: "border-white/10 bg-white/[0.05] text-slate-100",
  emerald: "border-l-2 border-l-emerald-400 border-emerald-400/20 bg-emerald-500/10 text-emerald-50",
  amber: "border-l-2 border-l-amber-400 border-amber-400/20 bg-amber-500/10 text-amber-50",
  rose: "border-l-2 border-l-rose-400 border-rose-400/20 bg-rose-500/10 text-rose-50",
  violet: "border-l-2 border-l-violet-400 border-violet-400/20 bg-violet-500/10 text-violet-50",
  sky: "border-l-2 border-l-sky-400 border-sky-400/20 bg-sky-500/10 text-sky-50",
};

const TONE_META_CLASS: Record<NonNullable<WeeklyCalendarEvent["tone"]>, string> = {
  slate: "text-slate-300 font-semibold",
  emerald: "text-emerald-300 font-semibold",
  amber: "text-amber-300 font-semibold",
  rose: "text-rose-300 font-semibold",
  violet: "text-violet-300 font-semibold",
  sky: "text-sky-300 font-semibold",
};

function normalizeTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  }

  if (/^\d{2}:\d{2}/.test(value)) {
    const [hourText, minuteText] = value.slice(0, 5).split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isNaN(hour) && !Number.isNaN(minute)) {
      const date = new Date();
      date.setHours(hour, minute, 0, 0);
      return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    }
  }

  return value;
}

export function WeeklyCalendar({
  days,
  events,
  freeSlots = [],
  timeSlots: explicitTimeSlots,
  emptyLabel = "No scheduled items in this window.",
  showEventTime = true,
  showFreeSlotTime = true,
}: {
  days: WeeklyCalendarDay[];
  events: WeeklyCalendarEvent[];
  freeSlots?: WeeklyCalendarFreeSlot[];
  timeSlots?: string[];
  emptyLabel?: string;
  showEventTime?: boolean;
  showFreeSlotTime?: boolean;
}) {
  const [openMenuId, setOpenMenuId] = React.useState<string | null>(null);
  React.useEffect(() => {
    const handleDocumentMouseDown = () => setOpenMenuId(null);
    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, []);

  const timeSlots = Array.from(
    new Set([...(explicitTimeSlots ?? []), ...events.map((event) => event.startTime), ...freeSlots.map((slot) => slot.startTime)]),
  ).sort((left, right) => left.localeCompare(right));

  if (events.length === 0 && freeSlots.length === 0 && timeSlots.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[24px] border border-white/8 bg-[#111821]">
      <div
        className="grid min-w-[980px]"
        style={{ gridTemplateColumns: `120px repeat(${days.length}, minmax(160px, 1fr))` }}
      >
        <div className="border-b border-r border-white/8 bg-white/[0.03] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Time
        </div>
        {days.map((day) => (
          <div
            key={day.key}
            className="border-b border-r border-white/8 bg-white/[0.03] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 last:border-r-0"
          >
            {day.label}
          </div>
        ))}

        {timeSlots.map((time) => (
          <React.Fragment key={time}>
            <div className="border-r border-white/8 px-4 py-4 text-sm font-semibold text-slate-300">
              {normalizeTime(time)}
            </div>
            {days.map((day) => {
              const cellEvents = events.filter((event) => event.dayKey === day.key && event.startTime === time);
              const cellFreeSlots = freeSlots.filter((slot) => slot.dayKey === day.key && slot.startTime === time);
              return (
                <div key={`${day.key}-${time}`} className="min-h-[112px] border-r border-white/8 px-3 py-3 last:border-r-0">
                  <div className="space-y-2">
                    {cellEvents.length > 0 ? (
                      cellEvents.map((event) => (
                        <EventCard
                          key={event.id}
                          event={event}
                          showEventTime={showEventTime}
                          openMenuId={openMenuId}
                          setOpenMenuId={setOpenMenuId}
                        />
                      ))
                    ) : cellFreeSlots.length > 0 ? (
                      cellFreeSlots.map((slot) => (
                        <button
                          key={slot.id}
                          type="button"
                          onClick={slot.onClick}
                          className="w-full rounded-2xl border border-dashed border-emerald-400/25 bg-emerald-500/5 px-3 py-4 text-left text-xs text-emerald-100 transition hover:border-emerald-300/60 hover:bg-emerald-500/10"
                        >
                          <span className="block font-semibold">{slot.label || "Free PT Slot"}</span>
                          {showFreeSlotTime ? (
                            <span className="mt-1 block uppercase tracking-[0.18em] text-emerald-200/80">
                              {normalizeTime(slot.startTime)} to {normalizeTime(slot.endTime)}
                            </span>
                          ) : null}
                        </button>
                      ))
                    ) : (
                      <div className="min-h-[72px]" />
                    )}
                  </div>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function EventCard({
  event,
  showEventTime,
  openMenuId,
  setOpenMenuId,
}: {
  event: WeeklyCalendarEvent;
  showEventTime: boolean;
  openMenuId: string | null;
  setOpenMenuId: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const classes = `relative rounded-2xl border px-3 py-3 text-left shadow-sm ${TONE_CLASS[event.tone || "slate"]} ${
    event.onClick ? "cursor-pointer transition hover:border-white/25 hover:bg-white/[0.08]" : ""
  }`;
  const content = (
    <>
      {event.actions && event.actions.length > 0 && !event.onClick ? (
        <div className="absolute right-2 top-2">
          <button
            type="button"
            onMouseDown={(clickEvent) => clickEvent.stopPropagation()}
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              setOpenMenuId((current) => (current === event.id ? null : event.id));
            }}
            className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-xs font-bold text-slate-200 hover:bg-black/30"
            aria-haspopup="menu"
            aria-expanded={openMenuId === event.id}
          >
            ...
          </button>
          {openMenuId === event.id ? (
            <div
              className="absolute right-0 z-20 mt-2 min-w-[150px] overflow-hidden rounded-xl border border-slate-700 bg-[#111821] shadow-xl"
              onMouseDown={(clickEvent) => clickEvent.stopPropagation()}
              onClick={(clickEvent) => clickEvent.stopPropagation()}
              role="menu"
            >
              {event.actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    setOpenMenuId(null);
                    action.onClick();
                  }}
                  className={`block w-full px-3 py-2 text-left text-xs font-semibold hover:bg-white/10 ${
                    action.tone === "danger" ? "text-rose-200" : "text-slate-100"
                  }`}
                  role="menuitem"
                >
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="text-sm font-semibold">{event.title}</p>
      {event.subtitle ? <p className="mt-1 text-xs text-slate-300">{event.subtitle}</p> : null}
      {showEventTime ? (
        <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
          {normalizeTime(event.startTime)}
          {event.endTime ? ` to ${normalizeTime(event.endTime)}` : ""}
        </p>
      ) : null}
      {event.meta ? <p className={`mt-1 text-xs ${TONE_META_CLASS[event.tone || "slate"]}`}>{event.meta}</p> : null}
    </>
  );

  if (event.onClick) {
    return (
      <button type="button" onClick={event.onClick} className={classes}>
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}
