import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "@/lib/firebase/rtdb-transforms";
import { z } from "zod";
import { getAdminServices } from "@/lib/firebase/admin";
import { getSchoolContext } from "@/server/context";
import { hasPermission } from "@/server/permissions";
import { hasValidCsrf } from "@/server/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bookFields = {
  isbn: z.string().trim().max(32).optional().or(z.literal("")),
  title: z.string().trim().min(1).max(180),
  author: z.string().trim().min(1).max(140),
  categories: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  totalCopies: z.number().int().min(1).max(100000),
};

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register_book"), ...bookFields }),
  z.object({ action: z.literal("bulk_register_books"), books: z.array(z.object(bookFields)).min(1).max(400) }),
  z.object({
    action: z.literal("update_book"),
    id: z.string().trim().min(1).max(128),
    ...bookFields,
  }),
  z.object({
    action: z.literal("issue_book"),
    bookId: z.string().trim().min(1).max(128),
    borrowerType: z.enum(["student", "staff"]),
    borrowerId: z.string().trim().min(1).max(128),
    dueDate: z.string().date(),
  }),
  z.object({ action: z.literal("return_book"), loanId: z.string().trim().min(1).max(128) }),
  z.object({
    action: z.literal("pay_fine"),
    fineId: z.string().trim().min(1).max(128),
    amount: z.number().positive().max(100000000),
    note: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal("update_settings"),
    finePerDay: z.number().nonnegative().max(1000000),
  }),
]);

function deny(message = "Library access is restricted") {
  return NextResponse.json({ error: message }, { status: 403 });
}

function serialise(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  )
    return (value as { toDate: () => Date }).toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialise);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialise(item)]));
  return value;
}

function daysLate(dueDate: string, returnedDate: string): number {
  const due = new Date(`${dueDate}T00:00:00.000Z`).getTime();
  const returned = new Date(`${returnedDate}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.floor((returned - due) / 86400000));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function cleanCategories(categories: string[]): string[] {
  return [...new Set(categories.map((category) => category.trim()).filter(Boolean))];
}

async function getBorrower(
  root: FirebaseFirestore.DocumentReference,
  type: "student" | "staff",
  id: string,
) {
  const candidates = type === "student" ? ["students"] : ["employees", "staff", "teachers"];
  for (const collection of candidates) {
    const collectionRef = root.collection(collection);
    const direct = await collectionRef.doc(id).get();
    const snap = direct.exists
      ? direct
      : (await collectionRef.where("uid", "==", id).limit(1).get()).docs[0];
    if (snap?.exists) {
      const data = snap.data();
      if (["inactive", "archived", "disabled"].includes(String(data?.status ?? ""))) return null;
      const name =
        typeof data?.fullName === "string"
          ? data.fullName
          : typeof data?.name === "string"
            ? data.name
            : "";
      if (!name) return null;
      return {
        id: snap.id,
        name,
        reference: String(
          data?.admissionNumber ?? data?.employeeNumber ?? data?.staffNumber ?? snap.id,
        ),
        collection,
      };
    }
  }
  return null;
}

function listDoc(snap: {
  docs: ReadonlyArray<{ id: string; data: () => Record<string, unknown> }>;
}): Array<Record<string, unknown> & { id: string }> {
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...(serialise(doc.data()) as Record<string, unknown>),
  }));
}

export async function GET(request: NextRequest) {
  const context = await getSchoolContext();
  if (!context) return deny("School access is required");
  if (
    !hasPermission(context.permissions, "library.manage") &&
    !hasPermission(context.permissions, "library.reports.read")
  )
    return deny();

  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  try {
    const lookupAdmissionId = request.nextUrl.searchParams.get("lookupAdmissionId")?.trim() ?? "";
    if (lookupAdmissionId) {
      if (lookupAdmissionId.length > 100 || lookupAdmissionId.includes("/"))
        return NextResponse.json({ error: "Invalid admission ID." }, { status: 400 });
      const studentCollection = root.collection("students");
      const [byDocumentId, byAdmissionNumber] = await Promise.all([
        studentCollection.doc(lookupAdmissionId).get(),
        studentCollection
          .where("admissionNumber", "==", lookupAdmissionId.toUpperCase())
          .limit(5)
          .get(),
      ]);
      const matches = new Map<string, FirebaseFirestore.DocumentSnapshot>();
      if (byDocumentId.exists) matches.set(byDocumentId.id, byDocumentId);
      for (const doc of byAdmissionNumber.docs) matches.set(doc.id, doc);
      const borrowers = [...matches.values()]
        .map((doc) => ({
          id: doc.id,
          type: "student",
          name: String(doc.get("fullName") ?? doc.get("name") ?? ""),
          reference: String(doc.get("admissionNumber") ?? doc.id),
          grade: String(doc.get("grade") ?? ""),
          className: String(doc.get("className") ?? ""),
          status: String(doc.get("status") ?? "active"),
        }))
        .filter(
          (student) =>
            student.name &&
            !["inactive", "archived", "disabled"].includes(student.status.toLowerCase()),
        );
      return NextResponse.json(
        { borrowers },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const search = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const category = request.nextUrl.searchParams.get("category")?.trim().toLowerCase() ?? "";
    const status = request.nextUrl.searchParams.get("status")?.trim().toLowerCase() ?? "";
    const borrowerQuery = request.nextUrl.searchParams.get("borrowerQ")?.trim().slice(0, 80) ?? "";
    const studentCollection = root.collection("students");
    const studentsPromise = borrowerQuery
      ? Promise.all([
          studentCollection
            .doc(borrowerQuery)
            .get()
            .catch(() => null),
          studentCollection
            .where("admissionNumber", "==", borrowerQuery.toUpperCase())
            .limit(30)
            .get(),
          studentCollection
            .where("normalizedName", ">=", borrowerQuery.toLowerCase())
            .where("normalizedName", "<=", `${borrowerQuery.toLowerCase()}\uf8ff`)
            .limit(50)
            .get(),
        ])
          .then(([byId, byAdmission, byName]) => {
            const unique = new Map<string, FirebaseFirestore.DocumentSnapshot>();
            if (byId?.exists) unique.set(byId.id, byId);
            for (const doc of byAdmission.docs) unique.set(doc.id, doc);
            for (const doc of byName.docs) unique.set(doc.id, doc);
            return { docs: [...unique.values()] };
          })
          .catch(() => ({ docs: [] as FirebaseFirestore.DocumentSnapshot[] }))
      : studentCollection
          .orderBy("fullName")
          .limit(1000)
          .get()
          .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }));
    const [
      bookSnap,
      loanSnap,
      transactionSnap,
      fineSnap,
      settingsSnap,
      studentsSnap,
      employeesSnap,
      teachersSnap,
    ] = await Promise.all([
      root.collection("libraryBooks").orderBy("title").limit(1000).get(),
      root.collection("libraryLoans").orderBy("createdAt", "desc").limit(1000).get(),
      root.collection("libraryTransactions").orderBy("createdAt", "desc").limit(300).get(),
      root
        .collection("libraryFines")
        .where("status", "in", ["open", "partially_paid"])
        .limit(500)
        .get()
        .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
      root.collection("librarySettings").doc("default").get(),
      studentsPromise,
      root
        .collection("employees")
        .orderBy("fullName")
        .limit(500)
        .get()
        .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
      root
        .collection("teachers")
        .orderBy("fullName")
        .limit(500)
        .get()
        .catch(() => ({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] })),
    ]);
    const allBooks = listDoc(bookSnap);
    const books = allBooks.filter((book) => {
      const haystack = [
        book.title,
        book.author,
        book.isbn,
        ...(Array.isArray(book.categories) ? book.categories : []),
      ]
        .join(" ")
        .toLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      const matchesCategory =
        !category ||
        (Array.isArray(book.categories) &&
          book.categories.some((item) => String(item).toLowerCase() === category));
      const matchesStatus =
        !status ||
        (status === "available"
          ? Number(book.availableCopies ?? 0) > 0
          : status === "unavailable"
            ? Number(book.availableCopies ?? 0) === 0
            : String(book.status ?? "active") === status);
      return matchesSearch && matchesCategory && matchesStatus;
    });
    const loans = listDoc(loanSnap);
    const transactions = listDoc(transactionSnap);
    const openFines = listDoc(fineSnap);
    const settings = settingsSnap.exists
      ? { finePerDay: Number(settingsSnap.get("finePerDay") ?? 0) }
      : { finePerDay: 0 };
    const now = today();
    const activeLoans = loans.filter((loan) => loan.status === "active");
    const overdueLoans = activeLoans.filter(
      (loan) => typeof loan.dueDate === "string" && loan.dueDate < now,
    );
    const popularCounts = new Map<string, number>();
    for (const transaction of transactions)
      if (transaction.type === "issue" && typeof transaction.bookId === "string")
        popularCounts.set(transaction.bookId, (popularCounts.get(transaction.bookId) ?? 0) + 1);
    const popularBooks = [...popularCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([bookId, issueCount]) => ({
        bookId,
        issueCount,
        title: String(
          bookSnap.docs.find((doc) => doc.id === bookId)?.get("title") ?? "Unknown book",
        ),
      }));
    const borrowers = [
      ...studentsSnap.docs.map((doc) => ({
        id: doc.id,
        type: "student",
        name: String(doc.get("fullName") ?? doc.get("name") ?? ""),
        reference: String(doc.get("admissionNumber") ?? doc.id),
        grade: String(doc.get("grade") ?? ""),
        className: String(doc.get("className") ?? ""),
        status: String(doc.get("status") ?? "active"),
      })),
      ...employeesSnap.docs.map((doc) => ({
        id: doc.id,
        type: "staff",
        name: String(doc.get("fullName") ?? doc.get("name") ?? ""),
        reference: String(doc.get("employeeNumber") ?? doc.get("staffNumber") ?? doc.id),
        status: String(doc.get("status") ?? "active"),
      })),
      ...teachersSnap.docs.map((doc) => ({
        id: doc.id,
        type: "staff",
        name: String(doc.get("fullName") ?? doc.get("name") ?? ""),
        reference: String(doc.get("employeeNumber") ?? doc.get("staffNumber") ?? doc.id),
        status: String(doc.get("status") ?? "active"),
      })),
    ].filter(
      (borrower) =>
        borrower.name && !["inactive", "archived", "disabled"].includes(borrower.status),
    );
    return NextResponse.json(
      {
        settings,
        books,
        loans,
        transactions,
        fines: openFines,
        borrowers,
        dashboard: {
          totalBooks: allBooks.reduce((sum, book) => sum + Number(book.totalCopies ?? 0), 0),
          availableBooks: allBooks.reduce(
            (sum, book) => sum + Number(book.availableCopies ?? 0),
            0,
          ),
          borrowedBooks: activeLoans.length,
          overdueBooks: overdueLoans.length,
          outstandingFines: openFines.reduce(
            (sum, fine) => sum + Number(fine.outstandingAmount ?? 0),
            0,
          ),
          popularBooks,
        },
        report: {
          loans,
          transactions,
          books,
          generatedAt: new Date().toISOString(),
          finePerDay: settings.finePerDay,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (cause) {
    console.error("library GET", cause);
    return NextResponse.json({ error: "Library records could not be loaded" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!hasValidCsrf(request))
    return NextResponse.json({ error: "Invalid request token" }, { status: 403 });
  const context = await getSchoolContext();
  if (!context) return deny("School access is required");
  if (!hasPermission(context.permissions, "library.manage"))
    return deny("Library management permission is required");
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid library request", fields: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );

  const { db } = getAdminServices();
  const root = db.collection("schools").doc(context.schoolId);
  try {
    const data = parsed.data;
    if (data.action === "bulk_register_books") {
      const batch = db.batch();
      const auditRef = root.collection("auditLogs").doc();
      for (const book of data.books) {
        const ref = root.collection("libraryBooks").doc();
        batch.create(ref, {
          isbn: book.isbn ?? "", title: book.title, author: book.author,
          categories: cleanCategories(book.categories), totalCopies: book.totalCopies,
          availableCopies: book.totalCopies, borrowedCopies: 0, status: "active",
          schoolId: context.schoolId, createdAt: FieldValue.serverTimestamp(), createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(), updatedBy: context.uid,
        });
      }
      batch.create(auditRef, { schoolId: context.schoolId, actorUid: context.uid,
        action: "library.books.bulk_created", recordType: "libraryBook", recordCount: data.books.length,
        occurredAt: FieldValue.serverTimestamp() });
      await batch.commit();
      return NextResponse.json({ ok: true, count: data.books.length }, { status: 201 });
    }
    if (data.action === "register_book") {
      const ref = root.collection("libraryBooks").doc();
      const auditRef = root.collection("auditLogs").doc();
      await db.runTransaction(async (tx) => {
        tx.create(ref, {
          isbn: data.isbn ?? "",
          title: data.title,
          author: data.author,
          categories: cleanCategories(data.categories),
          totalCopies: data.totalCopies,
          availableCopies: data.totalCopies,
          borrowedCopies: 0,
          status: "active",
          schoolId: context.schoolId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
        tx.create(auditRef, {
          schoolId: context.schoolId,
          actorUid: context.uid,
          action: "library.book.created",
          recordType: "libraryBook",
          recordId: ref.id,
          changedFields: ["isbn", "title", "author", "categories", "totalCopies"],
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true, id: ref.id }, { status: 201 });
    }
    if (data.action === "update_book") {
      const ref = root.collection("libraryBooks").doc(data.id);
      const auditRef = root.collection("auditLogs").doc();
      await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (!current.exists) throw new Error("BOOK_NOT_FOUND");
        const borrowedCopies = Number(current.get("borrowedCopies") ?? 0);
        if (data.totalCopies < borrowedCopies) throw new Error("COPIES_BELOW_BORROWED");
        tx.update(ref, {
          isbn: data.isbn ?? "",
          title: data.title,
          author: data.author,
          categories: cleanCategories(data.categories),
          totalCopies: data.totalCopies,
          availableCopies: data.totalCopies - borrowedCopies,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
        tx.create(auditRef, {
          schoolId: context.schoolId,
          actorUid: context.uid,
          action: "library.book.updated",
          recordType: "libraryBook",
          recordId: ref.id,
          changedFields: ["isbn", "title", "author", "categories", "totalCopies"],
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true });
    }
    if (data.action === "update_settings") {
      const ref = root.collection("librarySettings").doc("default");
      const auditRef = root.collection("auditLogs").doc();
      await db.runTransaction(async (tx) => {
        tx.set(
          ref,
          {
            finePerDay: data.finePerDay,
            schoolId: context.schoolId,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: context.uid,
          },
          { merge: true },
        );
        tx.create(auditRef, {
          schoolId: context.schoolId,
          actorUid: context.uid,
          action: "library.settings.updated",
          recordType: "librarySettings",
          recordId: ref.id,
          changedFields: ["finePerDay"],
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true });
    }
    if (data.action === "issue_book") {
      if (data.dueDate < today())
        return NextResponse.json({ error: "Due date cannot be before today" }, { status: 400 });
      const [book, borrower] = await Promise.all([
        root.collection("libraryBooks").doc(data.bookId).get(),
        getBorrower(root, data.borrowerType, data.borrowerId),
      ]);
      if (!book.exists) return NextResponse.json({ error: "Book not found" }, { status: 404 });
      if (!borrower)
        return NextResponse.json(
          { error: "The selected borrower is not an active school record" },
          { status: 400 },
        );
      if (Number(book.get("availableCopies") ?? 0) < 1)
        return NextResponse.json({ error: "No available copies of this book" }, { status: 409 });
      const duplicate = await root
        .collection("libraryLoans")
        .where("borrowerId", "==", borrower.id)
        .limit(100)
        .get();
      if (
        duplicate.docs.some(
          (doc) =>
            doc.get("bookId") === data.bookId &&
            doc.get("borrowerType") === data.borrowerType &&
            doc.get("status") === "active",
        )
      )
        return NextResponse.json(
          { error: "This borrower already has an active loan for this book" },
          { status: 409 },
        );
      const loanRef = root.collection("libraryLoans").doc();
      const transactionRef = root.collection("libraryTransactions").doc();
      const auditRef = root.collection("auditLogs").doc();
      const counterRef = root.collection("counters").doc("library_loans");
      let loanNumber = "";
      await db.runTransaction(async (tx) => {
        const freshBook = await tx.get(book.ref);
        const counter = await tx.get(counterRef);
        if (!freshBook.exists || Number(freshBook.get("availableCopies") ?? 0) < 1)
          throw new Error("NO_AVAILABLE_COPY");
        const next = Number(counter.get("value") ?? 0) + 1;
        loanNumber = `LIB-${new Date().getUTCFullYear()}-${String(next).padStart(6, "0")}`;
        tx.set(
          counterRef,
          { value: next, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
        tx.create(loanRef, {
          loanNumber,
          bookId: data.bookId,
          bookTitle: String(freshBook.get("title") ?? ""),
          borrowerType: data.borrowerType,
          borrowerId: borrower.id,
          borrowerName: borrower.name,
          borrowerReference: borrower.reference,
          issueDate: today(),
          dueDate: data.dueDate,
          status: "active",
          fineAmount: 0,
          finePaid: 0,
          outstandingFine: 0,
          schoolId: context.schoolId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
        tx.update(book.ref, {
          availableCopies: Number(freshBook.get("availableCopies") ?? 0) - 1,
          borrowedCopies: Number(freshBook.get("borrowedCopies") ?? 0) + 1,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
        tx.create(transactionRef, {
          type: "issue",
          loanId: loanRef.id,
          loanNumber,
          bookId: data.bookId,
          bookTitle: String(freshBook.get("title") ?? ""),
          borrowerType: data.borrowerType,
          borrowerId: borrower.id,
          borrowerName: borrower.name,
          amount: 0,
          occurredAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          schoolId: context.schoolId,
        });
        tx.create(auditRef, {
          schoolId: context.schoolId,
          actorUid: context.uid,
          action: "library.loan.issued",
          recordType: "libraryLoan",
          recordId: loanRef.id,
          loanNumber,
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true, id: loanRef.id, loanNumber }, { status: 201 });
    }
    if (data.action === "return_book") {
      const loanRef = root.collection("libraryLoans").doc(data.loanId);
      const returnedDate = today();
      const transactionRef = root.collection("libraryTransactions").doc();
      const auditRef = root.collection("auditLogs").doc();
      const fineRef = root.collection("libraryFines").doc();
      const settingsRef = root.collection("librarySettings").doc("default");
      let fineAmount = 0;
      let overdueDays = 0;
      await db.runTransaction(async (tx) => {
        const [loan, settings] = await Promise.all([tx.get(loanRef), tx.get(settingsRef)]);
        if (!loan.exists) throw new Error("LOAN_NOT_FOUND");
        if (loan.get("status") !== "active") throw new Error("LOAN_ALREADY_RETURNED");
        const bookRef = root.collection("libraryBooks").doc(String(loan.get("bookId")));
        const book = await tx.get(bookRef);
        if (!book.exists) throw new Error("BOOK_NOT_FOUND");
        overdueDays = daysLate(String(loan.get("dueDate")), returnedDate);
        fineAmount = overdueDays * Number(settings.get("finePerDay") ?? 0);
        tx.update(loanRef, {
          status: "returned",
          returnedDate,
          returnedAt: FieldValue.serverTimestamp(),
          overdueDays,
          fineAmount,
          finePaid: 0,
          outstandingFine: fineAmount,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
        tx.update(bookRef, {
          availableCopies: Math.min(
            Number(book.get("totalCopies") ?? 0),
            Number(book.get("availableCopies") ?? 0) + 1,
          ),
          borrowedCopies: Math.max(0, Number(book.get("borrowedCopies") ?? 0) - 1),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
        if (fineAmount > 0)
          tx.create(fineRef, {
            loanId: loanRef.id,
            loanNumber: loan.get("loanNumber"),
            borrowerId: loan.get("borrowerId"),
            borrowerName: loan.get("borrowerName"),
            bookId: loan.get("bookId"),
            totalAmount: fineAmount,
            paidAmount: 0,
            outstandingAmount: fineAmount,
            status: "open",
            schoolId: context.schoolId,
            createdAt: FieldValue.serverTimestamp(),
            createdBy: context.uid,
          });
        tx.create(transactionRef, {
          type: "return",
          loanId: loanRef.id,
          loanNumber: loan.get("loanNumber"),
          bookId: loan.get("bookId"),
          bookTitle: loan.get("bookTitle"),
          borrowerType: loan.get("borrowerType"),
          borrowerId: loan.get("borrowerId"),
          borrowerName: loan.get("borrowerName"),
          returnedDate,
          overdueDays,
          amount: fineAmount,
          occurredAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          schoolId: context.schoolId,
        });
        tx.create(auditRef, {
          schoolId: context.schoolId,
          actorUid: context.uid,
          action: "library.loan.returned",
          recordType: "libraryLoan",
          recordId: loanRef.id,
          loanNumber: loan.get("loanNumber"),
          overdueDays,
          fineAmount,
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true, overdueDays, fineAmount });
    }
    if (data.action === "pay_fine") {
      const fineRef = root.collection("libraryFines").doc(data.fineId);
      const paymentRef = root.collection("libraryTransactions").doc();
      const auditRef = root.collection("auditLogs").doc();
      let outstanding = 0;
      await db.runTransaction(async (tx) => {
        const fine = await tx.get(fineRef);
        if (!fine.exists) throw new Error("FINE_NOT_FOUND");
        const currentOutstanding = Number(fine.get("outstandingAmount") ?? 0);
        if (currentOutstanding <= 0) throw new Error("FINE_SETTLED");
        if (data.amount > currentOutstanding + 0.000001) throw new Error("PAYMENT_EXCEEDS_FINE");
        const paidAmount = Number(fine.get("paidAmount") ?? 0) + data.amount;
        outstanding = Math.max(0, currentOutstanding - data.amount);
        const loanRef = root.collection("libraryLoans").doc(String(fine.get("loanId")));
        tx.update(fineRef, {
          paidAmount,
          outstandingAmount: outstanding,
          status: outstanding === 0 ? "paid" : "partially_paid",
          lastPaymentAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
        tx.update(loanRef, {
          finePaid: paidAmount,
          outstandingFine: outstanding,
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: context.uid,
        });
        tx.create(paymentRef, {
          type: "fine_payment",
          fineId: fineRef.id,
          loanId: fine.get("loanId"),
          loanNumber: fine.get("loanNumber"),
          bookId: fine.get("bookId"),
          borrowerId: fine.get("borrowerId"),
          borrowerName: fine.get("borrowerName"),
          amount: data.amount,
          note: data.note ?? "",
          occurredAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
          createdBy: context.uid,
          schoolId: context.schoolId,
        });
        tx.create(auditRef, {
          schoolId: context.schoolId,
          actorUid: context.uid,
          action: "library.fine.paid",
          recordType: "libraryFine",
          recordId: fineRef.id,
          amount: data.amount,
          occurredAt: FieldValue.serverTimestamp(),
        });
      });
      return NextResponse.json({ ok: true, outstandingAmount: outstanding });
    }
    return NextResponse.json({ error: "Unsupported library operation" }, { status: 400 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    const errors: Record<string, [string, number]> = {
      BOOK_NOT_FOUND: ["Book not found", 404],
      COPIES_BELOW_BORROWED: ["Total copies cannot be below the number currently on loan", 409],
      NO_AVAILABLE_COPY: ["No available copy remains for this book", 409],
      LOAN_NOT_FOUND: ["Loan not found", 404],
      LOAN_ALREADY_RETURNED: ["This loan has already been returned", 409],
      FINE_NOT_FOUND: ["Fine not found", 404],
      FINE_SETTLED: ["This fine is already settled", 409],
      PAYMENT_EXCEEDS_FINE: ["Payment cannot exceed the outstanding fine", 400],
    };
    if (errors[message])
      return NextResponse.json({ error: errors[message][0] }, { status: errors[message][1] });
    console.error("library mutation", cause);
    return NextResponse.json({ error: "Library change could not be saved" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  return POST(request);
}
