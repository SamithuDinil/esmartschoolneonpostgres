"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
type Year = { id: string; name: string; status: string };
type Slot = { day: number; period: number; start: string; end: string; isBreak: boolean };
type Entry = { id: string; grade: string; className: string; subject: string; teacherUid: string; teacherName?: string; classroomId: string; day: number; period: number; status: string };
type Teacher = { uid: string; fullName: string; status?: string };
type Assignment = { teacherUid: string; grade: string; className: string; subject: string };
type AcademicClass = { id: string; grade: string; className: string };
const days = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function standardSlots(): Slot[] {
  const slots: Slot[] = [];
  for (let day = 1; day <= 5; day++) {
    let minute = 8 * 60;
    for (let period = 1; period <= 8; period++) {
      if (period === 5) minute += 15;
      const start = `${String(Math.floor(minute / 60)).padStart(2,"0")}:${String(minute % 60).padStart(2,"0")}`;
      minute += 45;
      const end = `${String(Math.floor(minute / 60)).padStart(2,"0")}:${String(minute % 60).padStart(2,"0")}`;
      slots.push({ day, period, start, end, isBreak: false });
    }
  }
  return slots;
}
export function TimetablePanel({ canManage = false }: { canManage?: boolean }) {
  const [years, setYears] = useState<Year[]>([]), [year, setYear] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]), [teachers, setTeachers] = useState<Teacher[]>([]), [assignments, setAssignments] = useState<Assignment[]>([]), [academicClasses, setAcademicClasses] = useState<AcademicClass[]>([]);
  const [periods, setPeriods] = useState<Slot[]>(standardSlots());
  const [grade, setGrade] = useState(""), [className, setClassName] = useState(""), [subject, setSubject] = useState(""), [teacherUid, setTeacherUid] = useState(""), [room, setRoom] = useState("");
  const [day, setDay] = useState("1"), [period, setPeriod] = useState("1"), [filter, setFilter] = useState("all"), [viewMode, setViewMode] = useState("class");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/api/administration?group=academicYears", { cache: "no-store" }).then(async r => { if (r.ok) { const d=await r.json(); setYears(d.items??[]); setYear((old:string)=>old||d.items?.find((x:Year)=>x.status==="active")?.id||d.items?.[0]?.id||""); } }); }, []);
  const load = useCallback(async () => { if (!year) return; try { const r=await fetch(`/api/timetable?academicYearId=${encodeURIComponent(year)}`,{cache:"no-store"}); const d=await r.json(); if(!r.ok) throw Error(d.error); setEntries(d.entries??[]); setTeachers(d.teachers??[]); setAssignments(d.assignments??[]); setAcademicClasses(d.classes??[]); if(d.periods?.length) setPeriods(d.periods); } catch(e) { setError(e instanceof Error?e.message:"Timetable unavailable"); } },[year]);
  useEffect(()=>{void load();},[load]);
  const classOptions = useMemo(()=>[...new Map([...academicClasses, ...assignments].map(a=>[`${a.grade}|${a.className}`,{grade:a.grade,className:a.className}])).values()].sort((a,b)=>a.grade.localeCompare(b.grade)||a.className.localeCompare(b.className)),[academicClasses,assignments]);
  const subjects = useMemo(()=>[...new Set(assignments.filter(a=>a.grade===grade&&a.className===className).map(a=>a.subject))].sort(),[assignments,grade,className]);
  const subjectTeachers = useMemo(()=>assignments.filter(a=>a.grade===grade&&a.className===className&&a.subject===subject).map(a=>a.teacherUid),[assignments,grade,className,subject]);
  const suggestedTeachers = teachers.filter(t=>subjectTeachers.includes(t.uid)&&t.status!=="inactive");
  async function send(payload: object) { setBusy(true); setError("");setNotice(""); try {const token=await fetchCsrfToken();const r=await fetch("/api/timetable",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":token},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok)throw Error(d.error);setNotice("Timetable updated successfully.");await load();return true;}catch(e){setError(e instanceof Error?e.message:"Timetable action failed");return false;}finally{setBusy(false);} }
  async function ensureStandardPeriods(){const ok=await send({action:"configure",academicYearId:year,periods});if(ok)setNotice("Standard school day saved: 8 periods, with a 15-minute break after period 4.");}
  async function addLesson(e:React.FormEvent){e.preventDefault(); if(!grade||!className||!subject||!teacherUid){setError("Choose a class, subject and suggested teacher first.");return;} const d=Number(day),p=Number(period); const clash=entries.find(x=>x.day===d&&x.period===p&&((x.grade===grade&&x.className===className)||x.teacherUid===teacherUid||(room&&x.classroomId===room))); if(clash){setError(`Conflict: ${clash.grade} ${clash.className} already has ${clash.subject} in this period, or the selected teacher/room is busy.`);return;} const ok=await send({action:"save",academicYearId:year,entry:{grade,className,subject,teacherUid,classroomId:room||`${grade} ${className}`,day:d,period:p,academicYearId:year}}); if(ok){setSubject("");setTeacherUid("");}}
  const classes = [...new Set(entries.map(x=>`${x.grade} ${x.className}`))];
  const shown=entries.filter(x=>filter==="all"||(viewMode==="class"?`${x.grade} ${x.className}`===filter:viewMode==="teacher"?x.teacherUid===filter:x.classroomId===filter));
  const teacherOptions=[...new Map(entries.map(x=>[x.teacherUid,x.teacherName??x.teacherUid]))];
  return <main className="page-content">
    <div className="page-heading"><div><div className="eyebrow">Academic planning · Scheduling</div><h1>Timetable</h1><p>Choose a class, pick a subject, and select a suggested teacher. Clashes are checked before saving.</p></div>{canManage&&<button className="btn-primary" disabled={busy||!year} onClick={()=>void send({action:"publish",academicYearId:year})}>Publish timetable</button>}</div>
    {error&&<div className="login-error" role="alert">{error}</div>}{notice&&<div className="login-success" role="status">{notice}</div>}
    <section className="panel"><div className="form-grid"><label className="field">Academic year<select value={year} onChange={e=>setYear(e.target.value)}>{years.map(y=><option key={y.id} value={y.id}>{y.name} · {y.status}</option>)}</select></label><div className="field"><span>School day</span><strong>8 periods · 45 minutes each</strong><small>15-minute interval after period 4</small></div>{canManage&&<div className="field"><span>Schedule setup</span><button className="btn-secondary" disabled={busy||!year} onClick={()=>void ensureStandardPeriods()}>Use standard 8-period day</button></div>}</div></section>
    {canManage&&<section className="panel" style={{marginTop:14}}><div className="panel-title">Build timetable for a class</div><p className="panel-subtitle">Start with the class. Subjects and teachers are suggested from active teacher assignments.</p><form onSubmit={addLesson} className="form-grid" style={{marginTop:12}}>
      <label className="field">Grade &amp; class<select required value={grade&&className?`${grade}|${className}`:""} onChange={e=>{const [g,c]=e.target.value.split("|");setGrade(g??"");setClassName(c??"");setSubject("");setTeacherUid("");}}><option value="">Choose class…</option>{classOptions.map(c=><option key={`${c.grade}|${c.className}`} value={`${c.grade}|${c.className}`}>{c.grade} – {c.className}</option>)}</select></label>
      <label className="field">Subject<select required disabled={!className} value={subject} onChange={e=>{setSubject(e.target.value);setTeacherUid("");}}><option value="">Choose subject…</option>{subjects.map(x=><option key={x}>{x}</option>)}</select></label>
      <label className="field">Teacher<select required disabled={!subject} value={teacherUid} onChange={e=>setTeacherUid(e.target.value)}><option value="">Suggested teachers…</option>{suggestedTeachers.map(t=><option key={t.uid} value={t.uid}>{t.fullName}</option>)}</select></label>
      <label className="field">Day<select value={day} onChange={e=>setDay(e.target.value)}>{days.slice(1,6).map((x,i)=><option key={x} value={i+1}>{x}</option>)}</select></label>
      <label className="field">Period<select value={period} onChange={e=>setPeriod(e.target.value)}>{periods.filter(x=>x.day===Number(day)&&!x.isBreak).map(x=><option key={x.period} value={x.period}>Period {x.period} · {x.start}–{x.end}</option>)}</select></label>
      <label className="field">Room <span className="panel-subtitle">(optional)</span><input value={room} onChange={e=>setRoom(e.target.value)} placeholder="Default: class room" /></label>
      <button className="btn-primary" disabled={busy||!year||!subjects.length}>{busy?"Saving…":"Add lesson"}</button>
    </form>{classOptions.length===0&&<p className="panel-subtitle">No active teacher assignments are available yet. Set up teacher subject assignments first.</p>}</section>}
    <section className="panel" style={{marginTop:14}}><div className="panel-header"><div><div className="panel-title">Weekly timetable</div><div className="panel-subtitle">Each class has one lesson per period; teachers and rooms cannot be double-booked.</div></div><div className="form-grid"><label className="field">View<select value={viewMode} onChange={e=>{setViewMode(e.target.value);setFilter("all");}}><option value="class">Class</option><option value="teacher">Teacher</option><option value="classroom">Room</option></select></label><label className="field">{viewMode==="class"?"Class":viewMode==="teacher"?"Teacher":"Room"}<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All {viewMode}s</option>{(viewMode==="class"?classes:viewMode==="teacher"?teacherOptions.map(x=>String(x[0])):[...new Set(entries.map(x=>x.classroomId))]).map(x=><option key={x} value={viewMode==="teacher"?entries.find(e=>(e.teacherName??e.teacherUid)===x)?.teacherUid??x:x}>{x}</option>)}</select></label></div></div>
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Day</th><th>Period</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Room</th><th>Status</th></tr></thead><tbody>{shown.sort((a,b)=>a.day-b.day||a.period-b.period).map(x=><tr key={x.id}><td>{days[x.day]}</td><td>{x.period}</td><td>{x.grade} {x.className}</td><td>{x.subject}</td><td>{x.teacherName??"Unknown teacher"}</td><td>{x.classroomId}</td><td>{x.status}</td></tr>)}</tbody></table>{!shown.length&&<div className="empty-state"><div><h3>No lessons scheduled</h3><p>Choose a class above to add its first lesson.</p></div></div>}</div></section>
  </main>;
}
