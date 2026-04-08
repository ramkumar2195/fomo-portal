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
}

const TONE_CLASS: Record<NonNullable<WeeklyCalendarEvent["tone"]>, string> = {
  slate: "border-white/10 bg-white/[0.05] text-slate-100",
  emerald: "border-emerald-400/20 bg-emerald-500/10 text-emerald-50",
  amber: "border-amber-400/20 bg-amber-500/10 text-amber-50",
  rose: "border-rose-400/20 bg-rose-500/10 text-rose-50",
  violet: "border-violet-400/20 bg-violet-500/10 text-violet-50",
  sky: "border-sky-400/20 bg-sky-500/10 text-sky-50",
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
  emptyLabel = "No scheduled items in this window.",
}: {
  days: WeeklyCalendarDay[];
  events: WeeklyCalendarEvent[];
  emptyLabel?: string;
}) {
  const timeSlots = Array.from(new Set(events.map((event) => event.startTime))).sort((left, right) =>
    left.localeCompare(right),
  );

  if (events.length === 0 || timeSlots.length === 0) {
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
              return (
                <div key={`${day.key}-${time}`} className="min-h-[112px] border-r border-white/8 px-3 py-3 last:border-r-0">
                  <div className="space-y-2">
                    {cellEvents.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/8 px-3 py-5 text-center text-xs text-slate-500">
                        Free
                      </div>
                    ) : (
                      cellEvents.map((event) => (
                        <div
                          key={event.id}
                          className={`rounded-2xl border px-3 py-3 shadow-sm ${TONE_CLASS[event.tone || "slate"]}`}
                        >
                          <p className="text-sm font-semibold">{event.title}</p>
                          {event.subtitle ? <p className="mt-1 text-xs text-slate-300">{event.subtitle}</p> : null}
                          <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                            {normalizeTime(event.startTime)}
                            {event.endTime ? ` to ${normalizeTime(event.endTime)}` : ""}
                          </p>
                          {event.meta ? <p className="mt-1 text-xs text-slate-400">{event.meta}</p> : null}
                        </div>
                      ))
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
