export type AiSnapshot = {
  attendanceToday: {
    sessions: number;
    absent: number;
    present: number;
    late: number;
    excused: number;
    percentage: number;
  };
  lowAttendance: Array<{ label: string; percentage: number; sessions: number }>;
  examination: { publishedExams: number; marks: number; average: number };
  overdueInvoices: { count: number; balance: number };
  eventsThisWeek: Array<{ title: string; startAt: string; category: string }>;
  administration: {
    activeStudents: number;
    teachers: number;
    inventoryAssets: number;
    documents: number;
  };
};

export function deterministicAnswer(question: string, snapshot: AiSnapshot, currency = "LKR") {
  const q = question.toLowerCase();
  if (q.includes("absent") || q.includes("absence"))
    return `Today’s authorized attendance summary shows ${snapshot.attendanceToday.absent} absent students across ${snapshot.attendanceToday.sessions} recorded session${snapshot.attendanceToday.sessions === 1 ? "" : "s"}. Overall attendance is ${snapshot.attendanceToday.percentage}%.`;
  if (q.includes("low attendance") || q.includes("attendance low"))
    return snapshot.lowAttendance.length
      ? `The lowest attendance groups are ${snapshot.lowAttendance.map((row) => `${row.label} (${row.percentage}%)`).join(", ")}. The review threshold is 80% in this assistant summary.`
      : "No class-level attendance group is below the 80% review threshold in today’s available records.";
  if (q.includes("average") || q.includes("performance") || q.includes("exam"))
    return `Published examination records contain ${snapshot.examination.marks} marks across ${snapshot.examination.publishedExams} published examination record${snapshot.examination.publishedExams === 1 ? "" : "s"}. The average mark is ${snapshot.examination.average}.`;
  if (q.includes("overdue") || q.includes("invoice"))
    return `There are ${snapshot.overdueInvoices.count} overdue invoices with a combined outstanding balance of ${currency} ${snapshot.overdueInvoices.balance.toLocaleString()}.`;
  if (q.includes("event") || q.includes("scheduled") || q.includes("week"))
    return snapshot.eventsThisWeek.length
      ? `This week has ${snapshot.eventsThisWeek.length} published event${snapshot.eventsThisWeek.length === 1 ? "" : "s"}: ${snapshot.eventsThisWeek.map((event) => event.title).join(", ")}.`
      : "There are no published events in the next seven days in the records you are authorized to review.";
  if (q.includes("student") || q.includes("directory"))
    return "Open Students to review the tenant-scoped student directory.";
  if (q.includes("setting") || q.includes("configure"))
    return "Open System settings to review persistent school, academic, security and notification configuration.";
  return "I can summarize attendance, examination performance, overdue invoices, events and administrative records that your role is authorized to review. Try one of the suggested questions.";
}
