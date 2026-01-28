import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";

type TargetMode = "self" | "all" | "student" | "enemy";
type EffectKind = "buff" | "debuff" | "attack";
type BuffStat = "atk" | "crit" | "critDmg";
type SkillType = "ex" | "ns";

type Buff = {
  id: string;
  name: string;
  kind: EffectKind;
  stat: BuffStat;
  value: number;
  duration: number;
  stackGroup: string;
  target?: TargetMode;
  targetStudentIds?: string[];
};

type ExSkill = {
  id: string;
  name: string;
  buffs: Buff[];
};

type NormalAttack = {
  hitRate: number;
  multiplier: number;
};

type NSkill = {
  id: string;
  name: string;
  buffs: Buff[];
  stackGroup: string;
};

type Student = {
  id: string;
  name: string;
  stats: {
    atk: number;
    crit: number;
    critDmg: number;
  };
  normal: NormalAttack;
  ns?: NSkill;
  ex: ExSkill[];
};

type ExEvent = {
  id: string;
  studentId: string;
  skillType: SkillType;
  skillId: string;
  start: number;
  duration: number;
  target: TargetMode;
  targetStudentIds?: string[];
  buffTargets?: Record<string, { target: TargetMode; targetStudentIds?: string[] }>;
};

type BuffInstance = {
  id: string;
  studentId: string;
  sourceStudentId: string;
  name: string;
  kind: EffectKind;
  stat: BuffStat;
  value: number;
  start: number;
  end: number;
  stackGroup: string;
  source: "ex" | "ns";
  sourceId: string;
  sourceEventId?: string;
  sourceBuffId: string;
};

const DEFAULT_TIMELINE_SECONDS = 60;
const DEFAULT_TIME_STEP = 0.1;
const ENEMY_ID = "enemy";
const DEFAULT_EX_EVENT_DURATION = 1;
const TIMELINE_SCALE = 20;
const EX_ROW_TOP = 6;
const EX_HEIGHT = 28;
const SKILL_ROW_GAP = 6;
const NS_ROW_TOP = EX_ROW_TOP + EX_HEIGHT + SKILL_ROW_GAP;
const BUFF_HEIGHT = 18;
const BUFF_GAP = 4;
const BUFF_TOP_OFFSET = NS_ROW_TOP + EX_HEIGHT + 8;
const TRACK_PADDING_BOTTOM = 8;

const defaultStudents: Student[] = [
  {
    id: "s.student_a",
    name: "生徒A",
    stats: {
      atk: 1050,
      crit: 200,
      critDmg: 200,
    },
    normal: { hitRate: 1.0, multiplier: 1.0 },
    ns: {
      id: "ns_student_a",
      name: "NS-1",
      stackGroup: "ns",
      buffs: [
        {
          id: "ns_student_a_atk",
          name: "効果1",
          kind: "buff",
          stat: "atk",
          value: 0.15,
          duration: 10,
          stackGroup: "ns",
        },
      ],
    },
    ex: [
      {
        id: "ex_student_a_1",
        name: "EX-1",
        buffs: [
          {
            id: "ex_student_a_atk",
            name: "効果1",
            kind: "buff",
            stat: "atk",
            value: 0.3,
            duration: 6,
            stackGroup: "field",
          },
          {
            id: "ex_student_a_crit",
            name: "効果2",
            kind: "buff",
            stat: "crit",
            value: 0.2,
            duration: 6,
            stackGroup: "field",
          },
        ],
      },
    ],
  },
  {
    id: "s.student_b",
    name: "生徒B",
    stats: {
      atk: 820,
      crit: 150,
      critDmg: 175,
    },
    normal: { hitRate: 1.0, multiplier: 1.0 },
    ns: {
      id: "ns_student_b",
      name: "NS-1",
      stackGroup: "ns",
      buffs: [
        {
          id: "ns_student_b_atk",
          name: "効果1",
          kind: "buff",
          stat: "atk",
          value: 0.12,
          duration: 12,
          stackGroup: "ns",
        },
      ],
    },
    ex: [
      {
        id: "ex_student_b_1",
        name: "EX-1",
        buffs: [
          {
            id: "ex_student_b_atk",
            name: "効果1",
            kind: "buff",
            stat: "atk",
            value: 0.2,
            duration: 8,
            stackGroup: "field",
          },
        ],
      },
    ],
  },
];

const statLabels: Record<BuffStat, string> = {
  atk: "攻撃力",
  crit: "会心",
  critDmg: "会心ダメージ",
};
const kindLabels: Record<EffectKind, string> = {
  buff: "バフ",
  debuff: "デバフ",
  attack: "攻撃",
};
const getBuffName = (kind: EffectKind, stat: BuffStat) => {
  if (kind === "attack") return "攻撃";
  const sign = kind === "debuff" ? "-" : "+";
  return `${statLabels[stat]}${sign}`;
};

const formatTime = (value: number) =>
  `${value.toFixed(2).replace(/\.?0+$/, "")}s`;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const toggleId = (list: string[] | undefined, id: string) => {
  const next = new Set(list ?? []);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return Array.from(next);
};

const base64UrlEncode = (input: string) => {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const base64UrlDecode = (input: string) => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
};

const getSkillDuration = (buffs: Buff[], fallback: number) => {
  const max = buffs.reduce(
    (current, buff) => Math.max(current, buff.duration || 0),
    0
  );
  return max > 0 ? max : fallback;
};

const buildBuffInstances = (
  students: Student[],
  events: ExEvent[],
  nsEnabled: Record<string, boolean>,
  nsTargets: Record<string, { target: TargetMode; targetStudentIds?: string[] }>,
  timelineSeconds: number,
  timeStep: number
) => {
  const instances: BuffInstance[] = [];
  const allStudentIds = students.map((student) => student.id);
  const allTargetIds = [...allStudentIds, ENEMY_ID];

  events.forEach((event) => {
    const student = students.find((item) => item.id === event.studentId);
    if (!student) return;
    const skill =
      event.skillType === "ex"
        ? student.ex.find((item) => item.id === event.skillId)
        : student.ns && student.ns.id === event.skillId
          ? student.ns
          : null;
    if (!skill) return;
    skill.buffs.forEach((buff) => {
      const kind = buff.kind ?? "buff";
      const override = event.buffTargets?.[buff.id];
      const targetMode = override?.target ?? buff.target ?? event.target;
      const rawTargets =
        targetMode === "enemy"
          ? [ENEMY_ID]
          : targetMode === "student"
            ? override?.targetStudentIds?.length
              ? override.targetStudentIds
              : buff.target
                ? buff.targetStudentIds?.length
                  ? buff.targetStudentIds
                  : [event.studentId]
                : event.targetStudentIds?.length
                  ? event.targetStudentIds
                  : [event.studentId]
            : targetMode === "all"
              ? allStudentIds
              : [event.studentId];
      const target = rawTargets.filter((id) => allTargetIds.includes(id));
      const finalTargets =
        targetMode === "enemy"
          ? [ENEMY_ID]
          : target.length
            ? target
            : [event.studentId];
      const duration =
        kind === "attack"
          ? Math.max(timeStep, buff.duration ?? timeStep)
          : event.duration ?? buff.duration ?? timeStep;
      const end = Math.min(event.start + duration, timelineSeconds);
      finalTargets.forEach((targetStudentId) => {
        instances.push({
          id: `${event.id}:${buff.id}:${targetStudentId}`,
          studentId: targetStudentId,
          sourceStudentId: student.id,
          name: buff.name,
          kind,
          stat: buff.stat,
          value: buff.value,
          start: event.start,
          end,
          stackGroup: buff.stackGroup,
          source: event.skillType,
          sourceId: skill.id,
          sourceEventId: event.id,
          sourceBuffId: buff.id,
        });
      });
    });
  });

  // NSはタイムライン配置のみ（自動発動は扱わない）

  return instances;
};

const applyOverwriteRules = (instances: BuffInstance[]) => {
  const grouped = new Map<string, BuffInstance[]>();
  instances.forEach((buff) => {
    const key = `${buff.studentId}:${buff.stat}:${buff.stackGroup}:${buff.kind}`;
    const list = grouped.get(key);
    if (list) {
      list.push({ ...buff });
    } else {
      grouped.set(key, [{ ...buff }]);
    }
  });

  const result: BuffInstance[] = [];
  grouped.forEach((list) => {
    const sorted = list.sort(
      (a, b) => a.start - b.start || a.id.localeCompare(b.id)
    );
    const trimmed: BuffInstance[] = [];
    sorted.forEach((buff) => {
      const last = trimmed[trimmed.length - 1];
      if (last && buff.start < last.end) {
        last.end = Math.min(last.end, buff.start);
        if (last.end <= last.start) {
          trimmed.pop();
        }
      }
      trimmed.push(buff);
    });
    trimmed.forEach((buff) => {
      if (buff.end > buff.start) {
        result.push(buff);
      }
    });
  });

  return result;
};

const buildBuffLanes = (buffs: BuffInstance[]) => {
  const sorted = [...buffs].sort((a, b) => a.start - b.start);
  const laneEnds: number[] = [];
  const laneMap: Record<string, number> = {};

  sorted.forEach((buff) => {
    let laneIndex = laneEnds.findIndex((end) => buff.start >= end);
    if (laneIndex === -1) {
      laneIndex = laneEnds.length;
      laneEnds.push(buff.end);
    } else {
      laneEnds[laneIndex] = buff.end;
    }
    laneMap[buff.id] = laneIndex;
  });

  return { laneMap, laneCount: Math.max(1, laneEnds.length) };
};

type StatTarget = {
  id: string;
  stats: Student["stats"];
};

const computeStatsAtTime = (
  target: StatTarget,
  time: number,
  instances: BuffInstance[]
) => {
  const active = instances.filter(
    (item) =>
      item.studentId === target.id && item.start <= time && time < item.end
  );

  const stacked = new Map<string, BuffInstance>();
  active.forEach((buff) => {
    const key = `${buff.stat}:${buff.stackGroup}:${buff.kind}`;
    const current = stacked.get(key);
    if (!current || buff.start > current.start) {
      stacked.set(key, buff);
    }
  });

  const totals = {
    atk: 0,
    crit: 0,
    critDmg: 0,
  };

  Array.from(stacked.values()).forEach((buff) => {
    if (buff.kind === "attack") return;
    const sign = buff.kind === "debuff" ? -1 : 1;
    totals[buff.stat] += buff.value * sign;
  });

  const computed = {
    atk: target.stats.atk * (1 + totals.atk),
    crit: target.stats.crit * (1 + totals.crit),
    critDmg: target.stats.critDmg * (1 + totals.critDmg),
  };

  return { active, totals, computed };
};

const createId = () => `evt_${Date.now().toString(36)}_${Math.random()}`;
const createLocalId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const selectAllOnFocus = (event: React.FocusEvent<HTMLInputElement>) => {
  event.currentTarget.select();
};
const findTrackRect = (element: HTMLElement | null) => {
  if (!element) return null;
  const track = element.closest(".timeline-track");
  if (!(track instanceof HTMLElement)) return null;
  return track.getBoundingClientRect();
};

type DragState = {
  type: "move" | "resize";
  eventId: string;
  studentId: string;
  offset: number;
  rect: DOMRect;
};

const serializeState = (
  students: Student[],
  events: ExEvent[],
  nsEnabled: Record<string, boolean>,
  nsTargets: Record<string, { target: TargetMode; targetStudentIds?: string[] }>,
  timelineSeconds: number,
  timeStep: number,
  enemy: { id: string; name: string; stats: Student["stats"] }
) =>
  base64UrlEncode(
    JSON.stringify({
      version: 1,
      students,
      events,
      nsEnabled,
      nsTargets,
      timelineSeconds,
      timeStep,
      enemy,
    })
  );

const parseState = (value: string) => {
  try {
    const decoded = base64UrlDecode(value);
    const parsed = JSON.parse(decoded) as {
      students: Student[];
      events: Array<
        Partial<ExEvent> &
          Pick<ExEvent, "id" | "studentId" | "start"> & {
            exId?: string;
          }
      >;
      nsEnabled: Record<string, boolean>;
      nsTargets?: Record<string, { target: TargetMode; targetStudentIds?: string[] }>;
      timelineSeconds?: number;
      timeStep?: number;
      enemy?: { id: string; name: string; stats: Student["stats"] };
    };
    if (!parsed?.students) return null;
    return parsed;
  } catch {
    return null;
  }
};

const normalizeEvents = (
  students: Student[],
  events: Array<Partial<ExEvent> & { exId?: string }>,
  timeStep: number
) =>
  events.flatMap((evt) => {
    if (!evt || !evt.id || !evt.studentId || evt.start === undefined) {
      return [];
    }
    const student = students.find((item) => item.id === evt.studentId);
    if (!student) return [];
    const skillType: SkillType =
      evt.skillType ?? (evt.exId ? "ex" : "ex");
    const skillId = evt.skillId ?? evt.exId;
    if (!skillId) return [];
    const skill =
      skillType === "ex"
        ? student.ex.find((item) => item.id === skillId)
        : student.ns && student.ns.id === skillId
          ? student.ns
          : null;
    if (!skill) return [];
    const target =
      evt.target === "all" || evt.target === "student" || evt.target === "enemy"
        ? evt.target
        : "self";
    const targetStudentIds =
      target === "student"
        ? evt.targetStudentIds?.length
          ? evt.targetStudentIds
          : [evt.studentId]
        : undefined;
    return [
      {
        id: evt.id,
        studentId: evt.studentId,
        skillType,
        skillId,
        start: evt.start,
        duration:
          evt.duration ??
          getSkillDuration(skill.buffs, Math.max(timeStep, DEFAULT_EX_EVENT_DURATION)),
        target,
        targetStudentIds,
        buffTargets: evt.buffTargets,
      },
    ];
  });

const clampEventsToTimeline = (
  events: ExEvent[],
  timelineSeconds: number,
  timeStep: number
) =>
  events.map((evt) => {
    const maxStart = Math.max(0, timelineSeconds - evt.duration);
    const nextStart = clamp(evt.start, 0, maxStart);
    const nextDuration = clamp(
      evt.duration,
      timeStep,
      timelineSeconds - nextStart
    );
    return { ...evt, start: nextStart, duration: nextDuration };
  });

export default function App() {
  const [students, setStudents] = useState<Student[]>(defaultStudents);
  const [events, setEvents] = useState<ExEvent[]>([]);
  const [timelineSeconds, setTimelineSeconds] = useState<number>(
    DEFAULT_TIMELINE_SECONDS
  );
  const [timelineSecondsInput, setTimelineSecondsInput] = useState<string>(
    String(DEFAULT_TIMELINE_SECONDS)
  );
  const [timeStep, setTimeStep] = useState<number>(DEFAULT_TIME_STEP);
  const [timeStepInput, setTimeStepInput] = useState<string>(
    String(DEFAULT_TIME_STEP)
  );
  const [nsEnabled, setNsEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(defaultStudents.map((student) => [student.id, false]))
  );
  const [nsTargets, setNsTargets] = useState<
    Record<string, { target: TargetMode; targetStudentIds?: string[] }>
  >(() =>
    Object.fromEntries(
      defaultStudents.map((student) => [student.id, { target: "self" }])
    )
  );
  const [enemy, setEnemy] = useState({
    id: ENEMY_ID,
    name: "敵",
    stats: {
      atk: 1000,
      crit: 200,
      critDmg: 200,
    },
  });
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    defaultStudents[0]?.id ?? ""
  );
  const [inspectTime, setInspectTime] = useState<number>(10);
  const [shareMessage, setShareMessage] = useState<string>("");
  const [selectedBuffRef, setSelectedBuffRef] = useState<{
    eventId: string;
    buffId: string;
  } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragMovedRef = useRef(false);
  const nextStudentRef = useRef(1);

  const buffInstances = useMemo(() => {
    const raw = buildBuffInstances(
      students,
      events,
      nsEnabled,
      nsTargets,
      timelineSeconds,
      timeStep
    );
    return applyOverwriteRules(raw);
  }, [students, events, nsEnabled, nsTargets, timelineSeconds, timeStep]);
  const buffLanesByStudent = useMemo(() => {
    const result: Record<
      string,
      { laneMap: Record<string, number>; laneCount: number }
    > = {};
    [...students, enemy].forEach((student) => {
      const buffs = buffInstances.filter((item) => item.studentId === student.id);
      result[student.id] = buildBuffLanes(buffs);
    });
    return result;
  }, [students, enemy, buffInstances]);

  const selectedStudent = students.find((student) => student.id === selectedStudentId);
  const selectedTarget =
    selectedStudentId === ENEMY_ID ? enemy : selectedStudent ?? null;
  const allTargets = useMemo(() => [...students, enemy], [students, enemy]);
  const allTargetIds = useMemo(
    () => allTargets.map((item) => item.id),
    [allTargets]
  );

  const inspectStats = selectedTarget
    ? computeStatsAtTime(selectedTarget, inspectTime, buffInstances)
    : null;

  const handleDragStart = (
    event: DragEvent<HTMLButtonElement>,
    studentId: string,
    skillType: SkillType,
    skillId: string
  ) => {
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ studentId, skillType, skillId })
    );
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, studentId: string) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData("text/plain");
    if (!payload) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const offset = event.clientX - rect.left;
    const ratio = clamp(offset / rect.width, 0, 1);
    const time =
      Math.round((ratio * timelineSeconds) / timeStep) * timeStep;

    try {
      const parsed = JSON.parse(payload) as {
        studentId: string;
        skillType: SkillType;
        skillId: string;
      };
      const student = students.find((item) => item.id === studentId);
      if (!student) return;
      const skill =
        parsed.skillType === "ex"
          ? student.ex.find((item) => item.id === parsed.skillId)
          : student.ns && student.ns.id === parsed.skillId
            ? student.ns
            : null;
      if (!skill) return;

      setEvents((current) => [
        ...current,
        {
          id: createId(),
          studentId,
          skillType: parsed.skillType,
          skillId: parsed.skillId,
          start: time,
          duration: getSkillDuration(
            skill.buffs,
            Math.max(timeStep, DEFAULT_EX_EVENT_DURATION)
          ),
          target: "self",
          targetStudentIds: [studentId],
        },
      ]);
      setSelectedEventId(null);
      setSelectedBuffRef(null);
      setSelectedStudentId(studentId);
    } catch {
      return;
    }
  };

  const handleBlockMouseDown = (
    event: React.MouseEvent<HTMLButtonElement>,
    evt: ExEvent
  ) => {
    if (event.button !== 0) return;
    const rect = findTrackRect(event.currentTarget);
    if (!rect) return;
    const clickOffset = event.clientX - rect.left;
    const ratio = clamp(clickOffset / rect.width, 0, 1);
    const clickTime = ratio * timelineSeconds;
    dragRef.current = {
      type: "move",
      eventId: evt.id,
      studentId: evt.studentId,
      offset: clickTime - evt.start,
      rect,
    };
    dragMovedRef.current = false;
    document.body.style.userSelect = "none";
  };

  const handleResizeMouseDown = (
    event: React.MouseEvent<HTMLSpanElement>,
    evt: ExEvent
  ) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    const rect = findTrackRect(event.currentTarget);
    if (!rect) return;
    dragRef.current = {
      type: "resize",
      eventId: evt.id,
      studentId: evt.studentId,
      offset: 0,
      rect,
    };
    dragMovedRef.current = false;
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragMovedRef.current = true;

      const ratio = clamp((event.clientX - drag.rect.left) / drag.rect.width, 0, 1);
      const time = ratio * timelineSeconds;

      setEvents((current) =>
        current.map((item) => {
          if (item.id !== drag.eventId) return item;
          if (drag.type === "move") {
            const nextStart = clamp(
              Math.round((time - drag.offset) / timeStep) * timeStep,
              0,
              timelineSeconds - item.duration
            );
            return { ...item, start: nextStart };
          }

          const nextDuration = clamp(
            Math.round((time - item.start) / timeStep) * timeStep,
            timeStep,
            timelineSeconds - item.start
          );
          return { ...item, duration: nextDuration };
        })
      );
    };

    const handleUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.userSelect = "";
        dragMovedRef.current = false;
      }
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  const applyStudents = (nextStudents: Student[]) => {
    setStudents(nextStudents);
    setEvents([]);
    setNsEnabled(
      Object.fromEntries(nextStudents.map((student) => [student.id, false]))
    );
    setNsTargets(
      Object.fromEntries(
        nextStudents.map((student) => [student.id, { target: "self" }])
      )
    );
    setSelectedStudentId(nextStudents[0]?.id ?? "");
    setSelectedEventId(null);
    setSelectedBuffRef(null);
  };

  const handleShare = async () => {
    const encoded = serializeState(
      students,
      events,
      nsEnabled,
      nsTargets,
      timelineSeconds,
      timeStep,
      enemy
    );
    const url = `${window.location.origin}${window.location.pathname}?s=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage("共有URLをコピーしました");
    } catch {
      setShareMessage("共有URL: " + url);
    }
  };

  const handleLoadFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("s");
    if (!encoded) return;
    const parsed = parseState(encoded);
    if (!parsed) return;

    applyStudents(parsed.students);
    const normalized = normalizeEvents(
      parsed.students,
      parsed.events ?? [],
      parsed.timeStep ?? DEFAULT_TIME_STEP
    );
    const nextTimeline = parsed.timelineSeconds ?? DEFAULT_TIMELINE_SECONDS;
    const nextTimeStep = parsed.timeStep ?? DEFAULT_TIME_STEP;
    setTimelineSeconds(nextTimeline);
    setTimeStep(nextTimeStep);
    setInspectTime((current) =>
      Math.round(Math.min(current, nextTimeline) / nextTimeStep) * nextTimeStep
    );
    setEvents(clampEventsToTimeline(normalized, nextTimeline, nextTimeStep));
    if (parsed.enemy) {
      setEnemy(parsed.enemy);
    }
    setNsEnabled(parsed.nsEnabled ?? {});
    setNsTargets(
      parsed.nsTargets ??
        Object.fromEntries(
          parsed.students.map((student) => [student.id, { target: "self" }])
        )
    );
  };

  const updateStudent = (studentId: string, updater: (current: Student) => Student) => {
    setStudents((current) =>
      current.map((student) =>
        student.id === studentId ? updater(student) : student
      )
    );
  };

  const handleTimelineClear = () => {
    setEvents([]);
    setSelectedBuffRef(null);
  };

  const updateEvent = (eventId: string, patch: Partial<ExEvent>) => {
    setEvents((current) =>
      current.map((item) => (item.id === eventId ? { ...item, ...patch } : item))
    );
  };

  const updateEventBuffTarget = (
    eventId: string,
    buffId: string,
    nextTarget: TargetMode,
    nextTargetStudentIds?: string[]
  ) => {
    setEvents((current) =>
      current.map((item) => {
        if (item.id !== eventId) return item;
        const nextTargets = {
          ...(item.buffTargets ?? {}),
          [buffId]: {
            target: nextTarget,
            targetStudentIds:
              nextTarget === "student" ? nextTargetStudentIds ?? [] : undefined,
          },
        };
        return { ...item, buffTargets: nextTargets };
      })
    );
  };

  const updateTimelineSeconds = (value: number) => {
    const nextSeconds = clamp(Math.round(value), 10, 600);
    setTimelineSeconds(nextSeconds);
    setInspectTime((current) => Math.min(current, nextSeconds));
    setEvents((current) => clampEventsToTimeline(current, nextSeconds, timeStep));
  };

  useEffect(() => {
    setTimelineSecondsInput(String(timelineSeconds));
  }, [timelineSeconds]);

  useEffect(() => {
    setTimeStepInput(String(timeStep));
  }, [timeStep]);

  const updateTimeStep = (value: number) => {
    const nextStep = clamp(Math.round(value * 100) / 100, 0.05, 1);
    setTimeStep(nextStep);
    setInspectTime((current) => Math.round(current / nextStep) * nextStep);
    setEvents((current) =>
      current.map((evt) => {
        const nextStart = clamp(
          Math.round(evt.start / nextStep) * nextStep,
          0,
          timelineSeconds
        );
        const nextDuration = clamp(
          Math.round(evt.duration / nextStep) * nextStep,
          nextStep,
          Math.max(nextStep, timelineSeconds - nextStart)
        );
        return { ...evt, start: nextStart, duration: nextDuration };
      })
    );
  };

  const addStudent = () => {
    const id = `s.custom_${nextStudentRef.current}`;
    nextStudentRef.current += 1;
    const newStudent: Student = {
      id,
      name: "新規生徒",
      stats: { atk: 1000, crit: 200, critDmg: 200 },
      normal: { hitRate: 1.0, multiplier: 1.0 },
      ns: {
        id: `ns_${id}`,
        name: "NS",
        stackGroup: "ns",
        buffs: [],
      },
      ex: [
        {
          id: `ex_${id}_1`,
          name: "EX",
          duration: 6,
          buffs: [],
        },
      ],
    };
    setStudents((current) => [...current, newStudent]);
    setNsEnabled((current) => ({ ...current, [id]: false }));
    setNsTargets((current) => ({ ...current, [id]: { target: "self" } }));
    setSelectedStudentId(id);
  };

  const removeStudent = (studentId: string) => {
    setStudents((current) => {
      const next = current.filter((student) => student.id !== studentId);
      setSelectedStudentId((selected) => {
        if (selected !== studentId) return selected;
        return next[0]?.id ?? "";
      });
      return next;
    });
    setEvents((current) => current.filter((evt) => evt.studentId !== studentId));
    setNsEnabled((current) => {
      const next = { ...current };
      delete next[studentId];
      return next;
    });
    setNsTargets((current) => {
      const next = { ...current };
      delete next[studentId];
      return next;
    });
  };

  const addExSkill = (studentId: string) => {
    updateStudent(studentId, (current) => ({
      ...current,
      ex: [
        ...current.ex,
        {
          id: createLocalId(`ex_${studentId}`),
          name: "EX",
          buffs: [],
        },
      ],
    }));
  };

  const removeExSkill = (studentId: string, exId: string) => {
    updateStudent(studentId, (current) => ({
      ...current,
      ex: current.ex.filter((ex) => ex.id !== exId),
    }));
    setEvents((current) =>
      current.filter(
        (evt) =>
          !(
            evt.studentId === studentId &&
            evt.skillType === "ex" &&
            evt.skillId === exId
          )
      )
    );
  };

  const updateExSkill = (
    studentId: string,
    exId: string,
    updater: (ex: ExSkill) => ExSkill
  ) => {
    updateStudent(studentId, (current) => ({
      ...current,
      ex: current.ex.map((ex) => (ex.id === exId ? updater(ex) : ex)),
    }));
  };

  const addExBuff = (studentId: string, exId: string) => {
    updateExSkill(studentId, exId, (ex) => ({
      ...ex,
      buffs: [
        ...ex.buffs,
        {
          id: createLocalId(`buff_${exId}`),
          name: getBuffName("buff", "atk"),
          kind: "buff",
          stat: "atk",
          value: 0.1,
          duration: 6,
          stackGroup: "ex",
          target: "self",
        },
      ],
    }));
  };

  const updateExBuff = (
    studentId: string,
    exId: string,
    buffId: string,
    updater: (buff: Buff) => Buff
  ) => {
    updateExSkill(studentId, exId, (ex) => ({
      ...ex,
      buffs: ex.buffs.map((buff) => (buff.id === buffId ? updater(buff) : buff)),
    }));
  };

  const removeExBuff = (studentId: string, exId: string, buffId: string) => {
    updateExSkill(studentId, exId, (ex) => ({
      ...ex,
      buffs: ex.buffs.filter((buff) => buff.id !== buffId),
    }));
  };

  const updateNsSkill = (studentId: string, updater: (ns: NSkill) => NSkill) => {
    updateStudent(studentId, (current) => ({
      ...current,
      ns: current.ns ? updater(current.ns) : current.ns,
    }));
  };

  const addNsBuff = (studentId: string) => {
    updateNsSkill(studentId, (ns) => ({
      ...ns,
      buffs: [
        ...ns.buffs,
        {
          id: createLocalId(`buff_${ns.id}`),
          name: getBuffName("buff", "atk"),
          kind: "buff",
          stat: "atk",
          value: 0.1,
          duration: 10,
          stackGroup: "ns",
          target: "self",
        },
      ],
    }));
  };

  const updateNsBuff = (
    studentId: string,
    buffId: string,
    updater: (buff: Buff) => Buff
  ) => {
    updateNsSkill(studentId, (ns) => ({
      ...ns,
      buffs: ns.buffs.map((buff) => (buff.id === buffId ? updater(buff) : buff)),
    }));
  };

  const removeNsBuff = (studentId: string, buffId: string) => {
    updateNsSkill(studentId, (ns) => ({
      ...ns,
      buffs: ns.buffs.filter((buff) => buff.id !== buffId),
    }));
  };

  const selectedEvent = selectedEventId
    ? events.find((item) => item.id === selectedEventId) ?? null
    : null;
  const selectedBuff =
    selectedBuffRef && selectedEventId === selectedBuffRef.eventId
      ? (() => {
          const event = events.find((item) => item.id === selectedBuffRef.eventId);
          const student = students.find((s) => s.id === event?.studentId);
          const skill =
            event?.skillType === "ex"
              ? student?.ex.find((item) => item.id === event?.skillId)
              : student?.ns && student.ns.id === event?.skillId
                ? student.ns
                : null;
          const buff = skill?.buffs.find(
            (item) => item.id === selectedBuffRef.buffId
          );
          return event && student && skill && buff
            ? { event, student, skill, buff }
            : null;
        })()
      : null;
  const studentNameById = useMemo(
    () =>
      Object.fromEntries(
        [...students, enemy].map((student) => [student.id, student.name])
      ),
    [students, enemy]
  );
  const tickInterval = 10;
  const tickCount = Math.max(2, Math.floor(timelineSeconds / tickInterval) + 1);

  useEffect(() => {
    handleLoadFromUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">TL Puzzle</p>
          <h1>タイムラインパズル（超ヒマリ論）</h1>
          <p className="subtitle">タイムラインを可視化します。TBD。</p>
        </div>
        <div className="hero-card">
          <div className="stat">
            <span>時間解像度</span>
            <strong>{timeStep.toFixed(2)}s</strong>
          </div>
          <div className="stat">
            <span>タイムレンジ</span>
            <strong>{timelineSeconds}s</strong>
          </div>
        </div>
      </header>

      <main className="layout">
        <div className="layout-row">
          <section className="panel timeline">
          <div className="panel-head">
            <h2>EXタイムライン</h2>
            <p className="hint">
              バフはEXスキル配置とNS自動発動で追加されます。EXは生徒カードの
              ボタンをドラッグしてタイムラインにドロップしてください。配置後は
              ブロックをドラッグで移動、右端のハンドルで長さを調整できます。対象は
              ブロック選択後のフォームで変更できます。
            </p>
          <div className="timeline-controls">
            <label>
              観測時刻: {formatTime(inspectTime)}
              <input
                type="range"
                min={0}
                max={timelineSeconds}
                step={timeStep}
                value={inspectTime}
                onChange={(event) => setInspectTime(Number(event.target.value))}
              />
            </label>
              <button type="button" className="ghost" onClick={handleTimelineClear}>
                すべて削除
              </button>
            </div>
          </div>

          <div className="timeline-scroll">
            <div
              className="timeline-grid timeline-canvas"
              style={{ minWidth: `${timelineSeconds * TIMELINE_SCALE}px` }}
            >
            <div
              className="timeline-ruler"
              style={{ gridTemplateColumns: `repeat(${tickCount}, 1fr)` }}
            >
              {Array.from({ length: tickCount }).map((_, index) => (
                <span key={index}>{index * tickInterval}s</span>
              ))}
            </div>
            {[...students, enemy].map((student) => {
              const isEnemy = student.id === ENEMY_ID;
              return (
                <div key={student.id} className="timeline-row">
                  <div className="row-label">{student.name}</div>
                  <div
                    className="timeline-track"
                    style={{
                      height: `${
                        BUFF_TOP_OFFSET +
                        buffLanesByStudent[student.id].laneCount *
                          (BUFF_HEIGHT + BUFF_GAP) +
                        TRACK_PADDING_BOTTOM
                      }px`,
                    }}
                    onDragOver={(event) => !isEnemy && event.preventDefault()}
                    onDrop={(event) => !isEnemy && handleDrop(event, student.id)}
                  >
                    {!isEnemy &&
                      events
                        .filter((evt) => evt.studentId === student.id)
                    .map((evt) => {
                      const skill =
                        evt.skillType === "ex"
                          ? student.ex.find((item) => item.id === evt.skillId)
                          : student.ns && student.ns.id === evt.skillId
                            ? student.ns
                            : null;
                      if (!skill) return null;
                      const left = (evt.start / timelineSeconds) * 100;
                      const width = (evt.duration / timelineSeconds) * 100;
                      const top = evt.skillType === "ns" ? NS_ROW_TOP : EX_ROW_TOP;
                      return (
                        <button
                          key={evt.id}
                          type="button"
                          className={`timeline-block${
                            selectedEventId === evt.id ? " selected" : ""
                          }${evt.skillType === "ns" ? " ns" : ""}${
                            evt.skillType === "ex" ? " ex" : ""
                          }`}
                          style={{ left: `${left}%`, width: `${width}%`, top: `${top}px` }}
                          onClick={() => {
                            if (dragMovedRef.current) {
                              dragMovedRef.current = false;
                              return;
                            }
                            setSelectedEventId(evt.id);
                            setSelectedBuffRef(null);
                          }}
                          onMouseDown={(event) => handleBlockMouseDown(event, evt)}
                          title={`${skill.name} @ ${formatTime(evt.start)}`}
                        >
                          {skill.name}
                          <span
                            className="resize-handle"
                            onMouseDown={(event) => handleResizeMouseDown(event, evt)}
                          />
                        </button>
                          );
                        })}
                    {buffInstances
                      .filter((item) => item.studentId === student.id)
                      .map((buff) => {
                        const lane =
                          buffLanesByStudent[student.id].laneMap[buff.id] ?? 0;
                        const left = (buff.start / timelineSeconds) * 100;
                        const width =
                          ((buff.end - buff.start) / timelineSeconds) * 100;
                        const valueLabel =
                          buff.kind === "attack"
                            ? `x${buff.value.toFixed(2)}`
                            : `${buff.kind === "debuff" ? "-" : "+"}${(
                                buff.value * 100
                              ).toFixed(0)}%`;
                        const statLabel =
                          buff.kind === "attack" ? "攻撃" : statLabels[buff.stat];
                        return (
                        <div
                          key={buff.id}
                          className={`buff-bar inline ${buff.source} ${buff.kind}`}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            top: `${BUFF_TOP_OFFSET + lane * (BUFF_HEIGHT + BUFF_GAP)}px`,
                            height: `${BUFF_HEIGHT}px`,
                          }}
                          data-tooltip={`${buff.name} (${statLabel}) ${valueLabel}\n${buff.source.toUpperCase()} | ${formatTime(
                            buff.start
                          )}-${formatTime(buff.end)}`}
                          role={buff.source === "ex" ? "button" : undefined}
                          tabIndex={buff.source === "ex" ? 0 : undefined}
                          onClick={() => {
                            if (buff.source !== "ex" || !buff.sourceEventId) return;
                            setSelectedEventId(buff.sourceEventId);
                            setSelectedBuffRef({
                              eventId: buff.sourceEventId,
                              buffId: buff.sourceBuffId,
                            });
                          }}
                        />
                        );
                      })}
                    <div
                      className="timeline-cursor"
                      style={{ left: `${(inspectTime / timelineSeconds) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
            </div>
          </div>
          <div className="ex-palette">
            <h3>スキルパレット</h3>
            {students.map((student) => (
              <div key={student.id} className="palette-row">
                <span className="palette-name">{student.name}</span>
                <div className="palette-chips">
                  {student.ex.map((ex) => (
                    <button
                      key={ex.id}
                      type="button"
                      className="chip chip-ex"
                      draggable
                      onDragStart={(event) =>
                        handleDragStart(event, student.id, "ex", ex.id)
                      }
                    >
                      <span className="chip-label">EX</span>
                      {ex.name}
                    </button>
                  ))}
                  {student.ns && (
                    <button
                      key={student.ns.id}
                      type="button"
                      className="chip chip-ns"
                      draggable
                      onDragStart={(event) =>
                        handleDragStart(event, student.id, "ns", student.ns!.id)
                      }
                    >
                      <span className="chip-label">NS</span>
                      {student.ns.name}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {selectedEvent && (
            <div className="event-editor">
              <div>
                <strong>選択中:</strong>{" "}
                {students.find((student) => student.id === selectedEvent.studentId)
                  ?.name}
              </div>
              <label>
                対象
                  <select
                    value={selectedEvent.target}
                    onChange={(event) => {
                      const nextTarget = event.target.value as ExEvent["target"];
                      updateEvent(selectedEvent.id, {
                        target: nextTarget,
                        targetStudentIds:
                          nextTarget === "student"
                            ? selectedEvent.targetStudentIds?.length
                              ? selectedEvent.targetStudentIds
                              : [selectedEvent.studentId]
                            : undefined,
                      });
                    }}
                  >
                  <option value="self">自分</option>
                  <option value="student">指定生徒/敵</option>
                  <option value="all">全員</option>
                  <option value="enemy">敵のみ</option>
                </select>
              </label>
              {selectedEvent.target === "student" && (
                <div className="target-list">
                  <span>対象</span>
                  <div className="target-grid">
                    {allTargets.map((student) => (
                      <label key={student.id} className="target-item">
                        <input
                          type="checkbox"
                          checked={
                            selectedEvent.targetStudentIds?.includes(student.id) ??
                            student.id === selectedEvent.studentId
                          }
                          onChange={() =>
                            updateEvent(selectedEvent.id, {
                              targetStudentIds: toggleId(
                                selectedEvent.targetStudentIds ?? [
                                  selectedEvent.studentId,
                                ],
                                student.id
                              ),
                            })
                          }
                        />
                        <span>{student.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label>
                開始秒数
                  <input
                    type="number"
                    step={timeStep}
                    min={0}
                    max={timelineSeconds - timeStep}
                    value={selectedEvent.start}
                    onFocus={selectAllOnFocus}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      const nextStart = clamp(
                        Math.round(value / timeStep) * timeStep,
                        0,
                      timelineSeconds - selectedEvent.duration
                    );
                    updateEvent(selectedEvent.id, { start: nextStart });
                  }}
                />
              </label>
              <label>
                継続時間
                  <input
                    type="number"
                    step={timeStep}
                    min={timeStep}
                    max={timelineSeconds}
                    value={selectedEvent.duration}
                    className={
                      selectedEvent.duration <= 0 ? "input-warning" : undefined
                    }
                    onFocus={selectAllOnFocus}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      const nextDuration = clamp(
                        Math.round(value / timeStep) * timeStep,
                        timeStep,
                      timelineSeconds - selectedEvent.start
                    );
                    updateEvent(selectedEvent.id, { duration: nextDuration });
                  }}
                />
                {selectedEvent.duration <= 0 && (
                  <span className="field-warning">
                    0より大きい値を入力してください
                  </span>
                )}
              </label>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  setEvents((current) =>
                    current.filter((item) => item.id !== selectedEvent.id)
                  )
                }
              >
                このスキルを削除
              </button>
              {(() => {
                const owner = students.find(
                  (student) => student.id === selectedEvent.studentId
                );
                const skill =
                  selectedEvent.skillType === "ex"
                    ? owner?.ex.find((item) => item.id === selectedEvent.skillId)
                    : owner?.ns && owner.ns.id === selectedEvent.skillId
                      ? owner.ns
                      : null;
                if (!skill) return null;
                return (
                  <div className="target-list">
                    <span>効果ごとの対象</span>
                    <div className="target-grid">
                      {skill.buffs.map((buff) => {
                        const override = selectedEvent.buffTargets?.[buff.id];
                        const effectiveTarget =
                          override?.target ?? buff.target ?? selectedEvent.target;
                        const effectiveIds =
                          override?.targetStudentIds ??
                          selectedEvent.targetStudentIds ??
                          [selectedEvent.studentId];
                        return (
                          <label key={buff.id} className="target-item">
                            <span>{buff.name}</span>
                              <select
                                value={effectiveTarget}
                                onChange={(event) => {
                                  const nextTarget = event.target.value as TargetMode;
                                  updateEventBuffTarget(
                                    selectedEvent.id,
                                    buff.id,
                                    nextTarget,
                                    nextTarget === "student"
                                      ? effectiveIds
                                      : undefined
                                  );
                                }}
                              >
                              <option value="self">自分</option>
                              <option value="student">指定生徒/敵</option>
                              <option value="all">全員</option>
                              <option value="enemy">敵のみ</option>
                            </select>
                            {effectiveTarget === "student" && (
                              <details className="target-disclosure">
                                <summary>
                                  対象:{" "}
                                  {effectiveIds.length
                                    ? effectiveIds
                                        .map((id) => studentNameById[id] ?? id)
                                        .join(", ")
                                    : "未選択"}
                                </summary>
                                <div className="target-grid compact">
                                  {allTargets.map((student) => (
                                    <label key={student.id} className="target-item">
                                      <input
                                        type="checkbox"
                                        checked={effectiveIds.includes(student.id)}
                                        onChange={() =>
                                          updateEventBuffTarget(
                                            selectedEvent.id,
                                            buff.id,
                                            "student",
                                            toggleId(effectiveIds, student.id)
                                          )
                                        }
                                      />
                                      <span>{student.name}</span>
                                    </label>
                                  ))}
                                </div>
                              </details>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {selectedBuff && (
            <div className="event-editor">
              <div>
                <strong>選択中の効果:</strong> {selectedBuff.buff.name} /{" "}
                {selectedBuff.skill.name}
              </div>
              <>
                <label>
                  効果対象(この配置のみ)
                  <select
                    value={
                      selectedBuff.event.buffTargets?.[selectedBuff.buff.id]?.target ??
                      selectedBuff.buff.target ??
                      selectedBuff.event.target
                    }
                    onChange={(event) => {
                      const nextTarget = event.target.value as TargetMode;
                      updateEventBuffTarget(
                        selectedBuff.event.id,
                        selectedBuff.buff.id,
                        nextTarget,
                        nextTarget === "student"
                          ? selectedBuff.event.buffTargets?.[
                              selectedBuff.buff.id
                            ]?.targetStudentIds ??
                            selectedBuff.event.targetStudentIds ??
                            [selectedBuff.event.studentId]
                          : undefined
                      );
                    }}
                  >
                    <option value="self">自分</option>
                    <option value="student">指定生徒/敵</option>
                    <option value="all">全員</option>
                    <option value="enemy">敵のみ</option>
                  </select>
                </label>
                {(selectedBuff.event.buffTargets?.[selectedBuff.buff.id]?.target ??
                  selectedBuff.buff.target ??
                  selectedBuff.event.target) === "student" && (
                  <div className="target-list">
                    <span>対象</span>
                    <div className="target-grid">
                      {allTargets.map((student) => (
                        <label key={student.id} className="target-item">
                          <input
                            type="checkbox"
                            checked={
                              selectedBuff.event.buffTargets?.[selectedBuff.buff.id]
                                ?.targetStudentIds?.includes(student.id) ??
                              selectedBuff.event.targetStudentIds?.includes(
                                student.id
                              ) ??
                              student.id === selectedBuff.event.studentId
                            }
                            onChange={() => {
                              const currentList =
                                selectedBuff.event.buffTargets?.[selectedBuff.buff.id]
                                  ?.targetStudentIds ??
                                selectedBuff.event.targetStudentIds ?? [
                                  selectedBuff.event.studentId,
                                ];
                              updateEventBuffTarget(
                                selectedBuff.event.id,
                                selectedBuff.buff.id,
                                "student",
                                toggleId(currentList, student.id)
                              );
                            }}
                          />
                          <span>{student.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            </div>
          )}
        </section>
          <section className="panel intro">
            <h2>生徒編集</h2>
            <p className="hint">
              ここで編集した能力値はURL共有に含まれます。
            </p>
            <div className="settings-row">
              <label>
                時間解像度(秒)
                <input
                  type="number"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={timeStepInput}
                  onChange={(event) => setTimeStepInput(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => {
                    const value = Number(timeStepInput);
                    if (Number.isFinite(value)) {
                      updateTimeStep(value);
                    } else {
                      setTimeStepInput(String(timeStep));
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      const value = Number(timeStepInput);
                      if (Number.isFinite(value)) {
                        updateTimeStep(value);
                      } else {
                        setTimeStepInput(String(timeStep));
                      }
                      event.currentTarget.blur();
                    }
                  }}
                />
              </label>
              <label>
                戦闘時間(秒)
                <input
                  type="number"
                  min={10}
                  max={600}
                  step={5}
                  value={timelineSecondsInput}
                  onChange={(event) => setTimelineSecondsInput(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => {
                    const value = Number(timelineSecondsInput);
                    if (Number.isFinite(value)) {
                      updateTimelineSeconds(value);
                    } else {
                      setTimelineSecondsInput(String(timelineSeconds));
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      const value = Number(timelineSecondsInput);
                      if (Number.isFinite(value)) {
                        updateTimelineSeconds(value);
                      } else {
                        setTimelineSecondsInput(String(timelineSeconds));
                      }
                      event.currentTarget.blur();
                    }
                  }}
                />
              </label>
              <div className="actions">
                <button type="button" className="ghost" onClick={addStudent}>
                  生徒を追加
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => selectedStudent && removeStudent(selectedStudent.id)}
                  disabled={!selectedStudent}
                >
                  選択生徒を削除
                </button>
              </div>
            </div>
            <div className="student-form">
              <div className="student-tabs">
                {students.map((student) => (
                  <button
                    key={student.id}
                    type="button"
                    className={`tab${
                      selectedStudentId === student.id ? " active" : ""
                    }`}
                    onClick={() => setSelectedStudentId(student.id)}
                  >
                    {student.name}
                  </button>
                ))}
              </div>
              {selectedStudent ? (
                <div className="student-fields">
                  <label>
                    名前
                  <input
                    type="text"
                    value={selectedStudent.name}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) =>
                      updateStudent(selectedStudent.id, (current) => ({
                        ...current,
                        name: event.target.value,
                        }))
                      }
                    />
                  </label>
                <label>
                  NS名
                  <input
                    type="text"
                    value={selectedStudent.ns?.name ?? ""}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) =>
                      selectedStudent.ns &&
                      updateNsSkill(selectedStudent.id, (ns) => ({
                        ...ns,
                          name: event.target.value,
                        }))
                      }
                    />
                </label>
                  <label>
                    攻撃力
                    <input
                      type="number"
                      value={selectedStudent.stats.atk}
                      onFocus={selectAllOnFocus}
                      onChange={(event) =>
                        updateStudent(selectedStudent.id, (current) => ({
                          ...current,
                          stats: {
                            ...current.stats,
                            atk: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    会心
                    <input
                      type="number"
                      value={selectedStudent.stats.crit}
                      onFocus={selectAllOnFocus}
                      onChange={(event) =>
                        updateStudent(selectedStudent.id, (current) => ({
                          ...current,
                          stats: {
                            ...current.stats,
                            crit: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                <label>
                  会心ダメージ
                    <input
                      type="number"
                      value={selectedStudent.stats.critDmg}
                      onFocus={selectAllOnFocus}
                      onChange={(event) =>
                        updateStudent(selectedStudent.id, (current) => ({
                          ...current,
                          stats: {
                            ...current.stats,
                          critDmg: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
                </div>
              ) : (
                <p className="muted">生徒を選択してください。</p>
              )}
              {selectedStudent?.ns && (
                <div className="skill-editor">
                  <div className="skill-head">
                  <h4>NS効果</h4>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => addNsBuff(selectedStudent.id)}
                  >
                    NS効果を追加
                  </button>
                  </div>
                {selectedStudent.ns.buffs.length === 0 ? (
                  <p className="muted">NS効果はまだありません。</p>
                ) : (
                  selectedStudent.ns.buffs.map((buff) => {
                    const buffKind = buff.kind ?? "buff";
                    return (
                      <div key={buff.id} className="buff-editor">
                        <select
                          value={buffKind}
                          onChange={(event) => {
                            const nextKind = event.target.value as EffectKind;
                            updateNsBuff(selectedStudent.id, buff.id, (current) => ({
                              ...current,
                              kind: nextKind,
                              name: getBuffName(nextKind, current.stat),
                              target: nextKind === "buff" ? "self" : "enemy",
                              targetStudentIds:
                                nextKind === "buff"
                                  ? current.targetStudentIds
                                  : undefined,
                            }));
                          }}
                        >
                          <option value="buff">バフ</option>
                          <option value="debuff">デバフ</option>
                          <option value="attack">攻撃</option>
                        </select>
                        {buffKind !== "attack" && (
                          <label className="mini-field">
                            <span>影響ステータス</span>
                            <select
                              value={buff.stat}
                              onChange={(event) =>
                                updateNsBuff(
                                  selectedStudent.id,
                                  buff.id,
                                  (current) => {
                                    const nextStat =
                                      event.target.value as BuffStat;
                                    return {
                                      ...current,
                                      stat: nextStat,
                                      name: getBuffName(
                                        current.kind ?? "buff",
                                        nextStat
                                      ),
                                    };
                                  }
                                )
                              }
                            >
                              <option value="atk">攻撃力</option>
                              <option value="crit">会心</option>
                              <option value="critDmg">会心ダメ</option>
                            </select>
                          </label>
                        )}
                        <label className="mini-field">
                          <span>効果の数値</span>
                          <input
                            type="number"
                            step={0.01}
                            value={buff.value}
                            className={buff.value <= 0 ? "input-warning" : undefined}
                            onFocus={selectAllOnFocus}
                            onChange={(event) =>
                              updateNsBuff(
                                selectedStudent.id,
                                buff.id,
                                (current) => ({
                                  ...current,
                                  value: Number(event.target.value),
                                })
                              )
                            }
                          />
                          {buff.value <= 0 && (
                            <span className="field-warning">
                              0より大きい値を推奨
                            </span>
                          )}
                        </label>
                        <label className="mini-field">
                          <span>継続時間</span>
                          <input
                            type="number"
                            step={0.1}
                            value={buff.duration}
                            className={buff.duration <= 0 ? "input-warning" : undefined}
                            onFocus={selectAllOnFocus}
                            onChange={(event) =>
                              updateNsBuff(
                                selectedStudent.id,
                                buff.id,
                                (current) => ({
                                  ...current,
                                  duration: Number(event.target.value),
                                })
                              )
                            }
                          />
                          {buff.duration <= 0 && (
                            <span className="field-warning">
                              0より大きい値を入力してください
                            </span>
                          )}
                        </label>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => removeNsBuff(selectedStudent.id, buff.id)}
                        >
                          削除
                        </button>
                      </div>
                    );
                  })
                )}
                </div>
              )}
              {selectedStudent && (
                <div className="skill-editor">
                  <div className="skill-head">
                    <h4>EXスキル</h4>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => addExSkill(selectedStudent.id)}
                    >
                      EXを追加
                    </button>
                  </div>
                  {selectedStudent.ex.length === 0 ? (
                    <p className="muted">EXスキルがありません。</p>
                  ) : (
                    selectedStudent.ex.map((ex) => (
                      <div key={ex.id} className="ex-editor">
                        <div className="ex-head">
                          <input
                            type="text"
                            value={ex.name}
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) =>
                              updateExSkill(
                                selectedStudent.id,
                                ex.id,
                                (current) => ({
                                  ...current,
                                  name: event.target.value,
                                })
                              )
                            }
                          />
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => removeExSkill(selectedStudent.id, ex.id)}
                          >
                            EX削除
                          </button>
                        </div>
                        <div className="skill-head">
                        <h5>EX効果</h5>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => addExBuff(selectedStudent.id, ex.id)}
                        >
                          EX効果を追加
                        </button>
                      </div>
                      {ex.buffs.length === 0 ? (
                        <p className="muted">EX効果がありません。</p>
                      ) : (
                        ex.buffs.map((buff) => {
                          const buffKind = buff.kind ?? "buff";
                          return (
                            <div key={buff.id} className="buff-editor">
                                <select
                                  value={buffKind}
                                  onChange={(event) => {
                                    const nextKind = event.target.value as EffectKind;
                                    updateExBuff(
                                      selectedStudent.id,
                                      ex.id,
                                      buff.id,
                                      (current) => ({
                                        ...current,
                                        kind: nextKind,
                                        name: getBuffName(nextKind, current.stat),
                                        target:
                                          nextKind === "buff" ? "self" : "enemy",
                                        targetStudentIds:
                                          nextKind === "buff"
                                            ? current.targetStudentIds
                                            : undefined,
                                      })
                                    );
                                  }}
                                >
                                  <option value="buff">バフ</option>
                                  <option value="debuff">デバフ</option>
                                  <option value="attack">攻撃</option>
                                </select>
                                {buffKind !== "attack" && (
                                  <label className="mini-field">
                                    <span>影響ステータス</span>
                                    <select
                                      value={buff.stat}
                                      onChange={(event) =>
                                        updateExBuff(
                                          selectedStudent.id,
                                          ex.id,
                                          buff.id,
                                          (current) => {
                                            const nextStat =
                                              event.target.value as BuffStat;
                                            return {
                                              ...current,
                                              stat: nextStat,
                                              name: getBuffName(
                                                current.kind ?? "buff",
                                                nextStat
                                              ),
                                            };
                                          }
                                        )
                                      }
                                    >
                                      <option value="atk">攻撃力</option>
                                      <option value="crit">会心</option>
                                      <option value="critDmg">会心ダメ</option>
                                    </select>
                                  </label>
                                )}
                                <label className="mini-field">
                                  <span>効果の数値</span>
                                  <input
                                    type="number"
                                    step={0.01}
                                    value={buff.value}
                                    className={buff.value <= 0 ? "input-warning" : undefined}
                                    onFocus={selectAllOnFocus}
                                    onChange={(event) =>
                                      updateExBuff(
                                        selectedStudent.id,
                                        ex.id,
                                        buff.id,
                                        (current) => ({
                                          ...current,
                                          value: Number(event.target.value),
                                        })
                                      )
                                    }
                                  />
                                  {buff.value <= 0 && (
                                    <span className="field-warning">
                                      0より大きい値を推奨
                                    </span>
                                  )}
                                </label>
                                <label className="mini-field">
                                  <span>継続時間</span>
                                  <input
                                    type="number"
                                    step={0.1}
                                    value={buff.duration}
                                    className={
                                      buff.duration <= 0 ? "input-warning" : undefined
                                    }
                                    onFocus={selectAllOnFocus}
                                    onChange={(event) =>
                                      updateExBuff(
                                        selectedStudent.id,
                                        ex.id,
                                        buff.id,
                                        (current) => ({
                                          ...current,
                                          duration: Number(event.target.value),
                                        })
                                      )
                                    }
                                  />
                                  {buff.duration <= 0 && (
                                    <span className="field-warning">
                                      0より大きい値を入力してください
                                    </span>
                                  )}
                                </label>
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() =>
                                    removeExBuff(
                                      selectedStudent.id,
                                      ex.id,
                                      buff.id
                                    )
                                  }
                                >
                                  削除
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
              <div className="enemy-editor">
                <h4>敵ステータス</h4>
                <div className="student-fields">
                  <label>
                    名前
                    <input
                      type="text"
                      value={enemy.name}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) =>
                        setEnemy((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    攻撃力
                    <input
                      type="number"
                      value={enemy.stats.atk}
                      onFocus={selectAllOnFocus}
                      onChange={(event) =>
                        setEnemy((current) => ({
                          ...current,
                          stats: {
                            ...current.stats,
                            atk: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    会心
                    <input
                      type="number"
                      value={enemy.stats.crit}
                      onFocus={selectAllOnFocus}
                      onChange={(event) =>
                        setEnemy((current) => ({
                          ...current,
                          stats: {
                            ...current.stats,
                            crit: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    会心ダメージ
                    <input
                      type="number"
                      value={enemy.stats.critDmg}
                      onFocus={selectAllOnFocus}
                      onChange={(event) =>
                        setEnemy((current) => ({
                          ...current,
                          stats: {
                            ...current.stats,
                            critDmg: Number(event.target.value),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="actions share-actions">
              <button type="button" onClick={handleShare}>
                共有URLを作成
              </button>
            </div>
            {shareMessage && <p className="note">{shareMessage}</p>}
            <p className="hint">
              URL共有は状態・生徒データを含むため、データ量が多い場合はURLが長くなります。
            </p>
          </section>
        </div>

        <div className="layout-row">
          <section className="panel inspector">
          <h2>時刻ステータス</h2>
          <div className="inspector-controls">
            <select
              value={selectedStudentId}
              onChange={(event) => setSelectedStudentId(event.target.value)}
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name}
                </option>
              ))}
              <option value={enemy.id}>{enemy.name}</option>
            </select>
            <span className="time-tag">{formatTime(inspectTime)}</span>
          </div>
          {selectedTarget && inspectStats ? (
            <div className="inspector-grid">
              <div className="card">
                <h3>基礎ステータス</h3>
                <ul>
                  <li>攻撃力: {selectedTarget.stats.atk}</li>
                  <li>会心: {selectedTarget.stats.crit}</li>
                  <li>会心ダメージ: {selectedTarget.stats.critDmg}</li>
                </ul>
              </div>
              <div className="card">
                <h3>効果込み</h3>
                <ul>
                  <li>攻撃力: {inspectStats.computed.atk.toFixed(0)}</li>
                  <li>会心: {inspectStats.computed.crit.toFixed(0)}</li>
                  <li>
                    会心ダメージ: {inspectStats.computed.critDmg.toFixed(0)}
                  </li>
                </ul>
              </div>
              <div className="card">
                <h3>有効効果</h3>
                {inspectStats.active.length === 0 ? (
                  <p className="muted">この時刻の効果はありません。</p>
                ) : (
                  <ul>
                    {inspectStats.active.map((buff) => (
                      <li key={buff.id}>
                        {buff.name} (
                        {buff.kind === "attack"
                          ? "攻撃"
                          : statLabels[buff.stat]}
                        ){" "}
                        {buff.kind === "attack"
                          ? `x${buff.value.toFixed(2)}`
                          : `${buff.kind === "debuff" ? "-" : "+"}${(
                              buff.value * 100
                            ).toFixed(0)}%`}{" "}
                        [{buff.stackGroup}]
                        {buff.sourceStudentId !== buff.studentId
                          ? ` / ${studentNameById[buff.sourceStudentId]}→${
                              studentNameById[buff.studentId]
                            }`
                          : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p className="muted">生徒を選択してください。</p>
          )}
        </section>
        </div>

        <section className="panel gantt">
          <h2>効果一覧</h2>
          <p className="hint">
            効果はタイムライン内に重ねて表示されています。ここでは一覧で確認できます。
          </p>
          <div className="buff-list">
            {buffInstances.length === 0 ? (
              <p className="muted">現在アクティブな効果はありません。</p>
            ) : (
              buffInstances.map((buff) => (
                <div key={buff.id} className={`buff-row ${buff.source} ${buff.kind}`}>
                  <strong>{buff.name}</strong>
                  <span>
                    {buff.kind === "attack"
                      ? "攻撃"
                      : `${statLabels[buff.stat]} (${kindLabels[buff.kind]})`}
                  </span>
                  <span>
                    {buff.kind === "attack"
                      ? `x${buff.value.toFixed(2)}`
                      : `${buff.kind === "debuff" ? "-" : "+"}${(
                          buff.value * 100
                        ).toFixed(0)}%`}
                  </span>
                  <span>
                    {studentNameById[buff.sourceStudentId]}→
                    {studentNameById[buff.studentId]} / {formatTime(buff.start)}-
                    {formatTime(buff.end)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

      </main>
    </div>
  );
}
