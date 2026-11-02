"use client";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import styles from "./LibraryPanel.module.css";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Book = {
  id: string;
  isbn?: string;
  title: string;
  author: string;
  categories: string[];
  totalCopies: number;
  availableCopies: number;
  borrowedCopies: number;
  status?: string;
};
type Loan = {
  id: string;
  loanNumber: string;
  bookId: string;
  bookTitle: string;
  borrowerType: "student" | "staff";
  borrowerId: string;
  borrowerName: string;
  borrowerReference?: string;
  issueDate: string;
  dueDate: string;
  returnedDate?: string;
  status: "active" | "returned";
  overdueDays?: number;
  fineAmount?: number;
  finePaid?: number;
  outstandingFine?: number;
};
type Transaction = {
  id: string;
  type: string;
  bookTitle?: string;
  borrowerName?: string;
  amount?: number;
  occurredAt?: string;
  loanNumber?: string;
};
type Fine = {
  id: string;
  loanId: string;
  loanNumber?: string;
  borrowerName?: string;
  bookId?: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
};
type Borrower = {
  id: string;
  type: "student" | "staff";
  name: string;
  reference: string;
  grade?: string;
  className?: string;
  status: string;
};
type QrDetector = { detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>> };
type QrDetectorConstructor = new (options?: { formats?: string[] }) => QrDetector;
type Dashboard = {
  totalBooks: number;
  availableBooks: number;
  borrowedBooks: number;
  overdueBooks: number;
  outstandingFines: number;
  popularBooks: { bookId: string; title: string; issueCount: number }[];
};
type LibraryResponse = {
  books: Book[];
  loans: Loan[];
  transactions: Transaction[];
  fines: Fine[];
  borrowers: Borrower[];
  dashboard: Dashboard;
  settings: { finePerDay: number };
};
type BookForm = {
  isbn: string;
  title: string;
  author: string;
  categories: string;
  totalCopies: string;
};
const emptyBook: BookForm = { isbn: "", title: "", author: "", categories: "", totalCopies: "1" };
const tabs = ["Overview", "Catalogue", "Circulation", "Fines & activity"] as const;
type Tab = (typeof tabs)[number];
function money(value: number) {
  return `Rs. ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function dateLabel(value?: string) {
  return value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString() : "—";
}
function timestampLabel(value?: string) {
  return value ? new Date(value).toLocaleString() : "—";
}
function localDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
function dateAfterDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDate(value);
}

export function LibraryPanel({ canManage = true }: { canManage?: boolean }) {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookForm, setBookForm] = useState<BookForm>(emptyBook);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [issue, setIssue] = useState({
    bookId: "",
    borrowerType: "student" as "student" | "staff",
    borrowerId: "",
    dueDate: dateAfterDays(localDate(), 14),
  });
  const [borrowerSearch, setBorrowerSearch] = useState("");
  const [borrowerQuery, setBorrowerQuery] = useState("");
  const [selectedBorrower, setSelectedBorrower] = useState<Borrower | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [borrowerGrade, setBorrowerGrade] = useState("");
  const [borrowerClass, setBorrowerClass] = useState("");
  const [finePerDay, setFinePerDay] = useState("0");
  const [payment, setPayment] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");

  const load = useCallback(async () => {
    try {
      setError("");
      const params = new URLSearchParams();
      if (borrowerQuery.trim()) params.set("borrowerQ", borrowerQuery.trim());
      const response = await fetch(`/api/library?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as LibraryResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Library records could not be loaded");
      setData(body);
      setFinePerDay(String(body.settings?.finePerDay ?? 0));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Library records could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [borrowerQuery]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => setBorrowerQuery(borrowerSearch), 300);
    return () => window.clearTimeout(timer);
  }, [borrowerSearch]);

  const acceptQrAdmissionId = useCallback(async (value: string) => {
    const admissionId = value.trim();
    if (!admissionId || admissionId.length > 100 || admissionId.includes("/")) {
      setError("The QR code does not contain a valid admission ID.");
      return;
    }
    try {
      const params = new URLSearchParams({ lookupAdmissionId: admissionId });
      const response = await fetch(`/api/library?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as { borrowers?: Borrower[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Student lookup failed.");
      const matches = (body.borrowers ?? []).filter(
        (item) =>
          item.type === "student" &&
          (item.id.toLowerCase() === admissionId.toLowerCase() ||
            item.reference.toLowerCase() === admissionId.toLowerCase()),
      );
      if (matches.length > 1) {
        setError(
          `Admission ID ${admissionId} matches multiple student records. Ask an administrator to correct the duplicate IDs.`,
        );
        return;
      }
      const borrower = matches[0];
      if (!borrower) {
        setIssue((current) => ({ ...current, borrowerType: "student", borrowerId: "" }));
        setSelectedBorrower(null);
        setBorrowerSearch(admissionId);
        setBorrowerQuery(admissionId);
        setNotice(
          `Scanned admission ID ${admissionId}; no active student record matched. Check the ID or search manually.`,
        );
        return;
      }
      setIssue((current) => ({ ...current, borrowerType: "student", borrowerId: borrower.id }));
      setSelectedBorrower(borrower);
      setBorrowerSearch(borrower.name);
      setBorrowerQuery(borrower.name);
      setBorrowerGrade("");
      setBorrowerClass("");
      setScanError("");
      setNotice(`Student found: ${borrower.name} · ${borrower.reference}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Student lookup failed.");
    }
  }, []);

  useEffect(() => {
    if (!scannerOpen) return;
    let active = true;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    let detecting = false;
    const Detector = (window as Window & { BarcodeDetector?: QrDetectorConstructor })
      .BarcodeDetector;
    const video = videoRef.current;
    if (!Detector) {
      setScanError(
        "Camera QR scanning is not supported in this browser. You can still type the admission ID or use a USB QR scanner in the search field.",
      );
      return () => {
        active = false;
      };
    }
    if (!navigator.mediaDevices?.getUserMedia || !video) {
      setScanError(
        "Camera access is unavailable. Use HTTPS or type the admission ID in the search field.",
      );
      return () => {
        active = false;
      };
    }
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        timer = window.setInterval(() => {
          if (!active || detecting || video.readyState < 2) return;
          detecting = true;
          void detector
            .detect(video)
            .then((codes) => {
              const value = codes.find((code) => code.rawValue?.trim())?.rawValue?.trim();
              if (value && active) {
                active = false;
                setScannerOpen(false);
                void acceptQrAdmissionId(value);
              }
            })
            .catch(() => undefined)
            .finally(() => {
              detecting = false;
            });
        }, 350);
      } catch {
        if (active)
          setScanError(
            "Camera permission was denied or the camera is unavailable. Type the admission ID or use a USB QR scanner instead.",
          );
      }
    })();
    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (video) video.srcObject = null;
    };
  }, [scannerOpen, acceptQrAdmissionId]);

  async function send(payload: object, successMessage: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const csrfToken = await fetchCsrfToken();
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Library change could not be saved");
      setNotice(successMessage);
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Library change could not be saved");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function submitBook(event: FormEvent) {
    event.preventDefault();
    void send(
      {
        action: editingId ? "update_book" : "register_book",
        ...(editingId ? { id: editingId } : {}),
        isbn: bookForm.isbn,
        title: bookForm.title,
        author: bookForm.author,
        categories: bookForm.categories
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        totalCopies: Number(bookForm.totalCopies),
      },
      editingId ? "Book details updated." : "Book registered.",
    ).then((ok) => {
      if (ok) {
        setBookForm(emptyBook);
        setEditingId(null);
      }
    });
  }
  function downloadBookTemplate() {
    const csv = 'ISBN,Title,Author,Categories,Total Copies\n9780000000001,Example book,Example Author,"Science; Reference",5\n';
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "library-books-template.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  function parseCsv(text: string): string[][] {
    const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[i + 1] === "\n") i++;
        row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
      } else cell += char;
    }
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    return rows;
  }
  async function importBooks() {
    if (!bulkFile) return;
    try {
      const rows = parseCsv(await bulkFile.text());
      const headers = rows.shift()?.map((x) => x.toLowerCase().replaceAll(" ", "")) ?? [];
      const index = (name: string) => headers.indexOf(name);
      const required = ["title", "author", "totalcopies"];
      if (required.some((name) => index(name) < 0)) throw new Error("Template columns are required: ISBN, Title, Author, Categories, Total Copies.");
      if (!rows.length || rows.length > 400) throw new Error("Upload between 1 and 400 book rows per file.");
      const books = rows.map((row, i) => {
        const title = row[index("title")] ?? "", author = row[index("author")] ?? "";
        const copies = Number(row[index("totalcopies")]);
        if (!title || !author || !Number.isInteger(copies) || copies < 1) throw new Error(`Row ${i + 2}: title, author and a positive whole-number copy count are required.`);
        return { isbn: row[index("isbn")] ?? "", title, author,
          categories: (row[index("categories")] ?? "").split(";").map((x) => x.trim()).filter(Boolean), totalCopies: copies };
      });
      const ok = await send({ action: "bulk_register_books", books }, `${books.length} books imported successfully.`);
      if (ok) setBulkFile(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read this CSV file."); }
  }
  function beginEdit(book: Book) {
    setEditingId(book.id);
    setBookForm({
      isbn: book.isbn ?? "",
      title: book.title,
      author: book.author,
      categories: book.categories.join(", "),
      totalCopies: String(book.totalCopies),
    });
    setTab("Catalogue");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function submitIssue(event: FormEvent) {
    event.preventDefault();
    void send({ action: "issue_book", ...issue }, "Loan issued and inventory updated.").then(
      (ok) => {
        if (ok) {
          setIssue({
            bookId: "",
            borrowerType: "student",
            borrowerId: "",
            dueDate: dateAfterDays(localDate(), 14),
          });
          setBorrowerSearch("");
          setBorrowerQuery("");
          setSelectedBorrower(null);
          setBorrowerGrade("");
          setBorrowerClass("");
        }
      },
    );
  }
  function exportCsv() {
    if (!data) return;
    const rows = [
      [
        "Type",
        "Loan number",
        "Book",
        "Borrower",
        "Status",
        "Issue date",
        "Due/return date",
        "Fine",
      ],
      ...data.loans.map((loan) => [
        "Loan",
        loan.loanNumber,
        loan.bookTitle,
        loan.borrowerName,
        loan.status,
        loan.issueDate,
        loan.returnedDate ?? loan.dueDate,
        String(loan.fineAmount ?? 0),
      ]),
      ...data.transactions.map((item) => [
        item.type,
        item.loanNumber ?? "",
        item.bookTitle ?? "",
        item.borrowerName ?? "",
        "Transaction",
        timestampLabel(item.occurredAt),
        "",
        String(item.amount ?? 0),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `library-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  const categories = useMemo(
    () => [...new Set((data?.books ?? []).flatMap((book) => book.categories))].sort(),
    [data?.books],
  );
  const filteredBooks = (data?.books ?? []).filter((book) => {
    const normalized = query.trim().toLowerCase();
    const matchesQuery =
      !normalized ||
      [book.title, book.author, book.isbn ?? "", ...book.categories]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    const matchesCategory =
      !category || book.categories.some((item) => item.toLowerCase() === category.toLowerCase());
    const matchesAvailability =
      !status || (status === "available" ? book.availableCopies > 0 : book.availableCopies === 0);
    return matchesQuery && matchesCategory && matchesAvailability;
  });
  const activeLoans = data?.loans.filter((loan) => loan.status === "active") ?? [];
  const staff = data?.borrowers.filter((borrower) => borrower.type === "staff") ?? [];
  const allStudents = data?.borrowers.filter((borrower) => borrower.type === "student") ?? [];
  const students = allStudents.filter(
    (borrower) =>
      (!borrowerGrade || borrower.grade === borrowerGrade) &&
      (!borrowerClass || borrower.className === borrowerClass),
  );
  const activeBorrowers = issue.borrowerType === "student" ? students : staff;
  const normalizedBorrowerSearch = borrowerSearch.trim().toLowerCase();
  const borrowerSuggestions = normalizedBorrowerSearch
    ? activeBorrowers
        .filter((borrower) =>
          `${borrower.name} ${borrower.reference} ${borrower.grade ?? ""} ${borrower.className ?? ""}`
            .toLowerCase()
            .includes(normalizedBorrowerSearch),
        )
        .slice(0, 8)
    : [];
  const grades = [
    ...new Set(
      allStudents
        .map((borrower) => borrower.grade)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const classes = [
    ...new Set(
      allStudents
        .filter((borrower) => !borrowerGrade || borrower.grade === borrowerGrade)
        .map((borrower) => borrower.className)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const issueDate = new Date().toISOString().slice(0, 10);
  const metrics = data
    ? ([
        ["Catalogue titles", data.dashboard.totalBooks, "In the collection"],
        ["Available copies", data.dashboard.availableBooks, "Ready to issue"],
        ["On loan", data.dashboard.borrowedBooks, "Currently borrowed"],
        ["Overdue", data.dashboard.overdueBooks, "Needs follow-up"],
      ] as const)
    : [];
  const Panel = ({
    children,
    className = "",
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <section className={`${styles.panel} ${className}`}>{children}</section>;
  const Empty = ({ children }: { children: React.ReactNode }) => (
    <div className={styles.empty}>{children}</div>
  );
  const loanRows = (rows: Loan[]) =>
    rows.map((loan) => {
      const overdue = loan.dueDate < issueDate;
      return (
        <tr key={loan.id}>
          <td data-label="Loan">
            <strong>{loan.loanNumber}</strong>
          </td>
          <td data-label="Book / borrower">
            <strong>{loan.bookTitle}</strong>
            <br />
            <span className={styles.muted}>
              {loan.borrowerName} · {loan.borrowerType}
            </span>
          </td>
          <td data-label="Dates">
            Issued {dateLabel(loan.issueDate)}
            <br />
            <span className={styles.muted}>
              {loan.status === "returned"
                ? `Returned ${dateLabel(loan.returnedDate)}`
                : `Due ${dateLabel(loan.dueDate)}`}
            </span>
          </td>
          <td data-label="Status">
            <span
              className={`${styles.badge} ${overdue && loan.status === "active" ? styles.danger : styles.success}`}
            >
              {loan.status === "returned" ? "Returned" : overdue ? "Overdue" : "On loan"}
            </span>
          </td>
          {loan.status === "active" && (
            <td data-label="Action">
              <button
                className="btn-secondary"
                disabled={!canManage || busy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Return “${loan.bookTitle}” for ${loan.borrowerName} today? The system will calculate any overdue fine using today's library policy.`,
                    )
                  )
                    void send(
                      { action: "return_book", loanId: loan.id },
                      "Book returned and inventory updated.",
                    );
                }}
              >
                Return
              </button>
            </td>
          )}
        </tr>
      );
    });

  return (
    <main className={`page-content ${styles.library}`}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>School workspace · Library</div>
          <h1>Library</h1>
          <p>
            {canManage
              ? "A clear view of your collection, circulation and activity."
              : "Review library records and export reports."}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button className="btn-secondary" onClick={exportCsv} disabled={!data}>
            Export report
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            Refresh
          </button>
        </div>
      </header>
      {error && (
        <div className={styles.alertError} role="alert">
          <strong>Something needs attention</strong>
          <span>{error}</span>
          <button
            className="text-button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {notice && (
        <div className={styles.alertSuccess} role="status">
          {notice}
        </div>
      )}
      <nav className={styles.tabs} aria-label="Library sections" role="tablist">
        {tabs.map((item) => (
          <button
            key={item}
            id={`library-tab-${tabs.indexOf(item)}`}
            className={`${styles.tab} ${tab === item ? styles.activeTab : ""}`}
            role="tab"
            aria-selected={tab === item}
            aria-controls={`library-panel-${tabs.indexOf(item)}`}
            onClick={() => setTab(item)}
          >
            {item}
            {item === "Circulation" && activeLoans.length > 0 && (
              <span className={styles.count}>{activeLoans.length}</span>
            )}
          </button>
        ))}
      </nav>
      {loading && !data ? (
        <Panel>
          <div className={styles.loading} role="status">
            Loading library records…
          </div>
        </Panel>
      ) : !data ? (
        <Panel>
          <Empty>
            <h2>Library records unavailable</h2>
            <p>We couldn’t load the catalogue just now. Your records haven’t been changed.</p>
            <button
              className="btn-primary"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              Retry
            </button>
          </Empty>
        </Panel>
      ) : (
        <div
          role="tabpanel"
          id={`library-panel-${tabs.indexOf(tab)}`}
          aria-labelledby={`library-tab-${tabs.indexOf(tab)}`}
        >
          {tab === "Overview" && (
            <>
              <section className={styles.metrics} aria-label="Library overview">
                {metrics.map(([label, value, hint]) => (
                  <div className={styles.metric} key={label}>
                    <span>{label}</span>
                    <strong>{value.toLocaleString()}</strong>
                    <small>{hint}</small>
                  </div>
                ))}
              </section>
              <div className={styles.overviewGrid}>
                <Panel>
                  <div className={styles.panelHead}>
                    <div>
                      <h2>Quick actions</h2>
                      <p>Pick up where you need to.</p>
                    </div>
                  </div>
                  <div className={styles.quickActions}>
                    {canManage && (
                      <>
                        <button className="btn-primary" onClick={() => setTab("Catalogue")}>
                          ＋ Register a book
                        </button>
                        <button className="btn-secondary" onClick={() => setTab("Circulation")}>
                          Issue a book
                        </button>
                      </>
                    )}
                    <button className="btn-secondary" onClick={() => setTab("Fines & activity")}>
                      Review fines & activity
                    </button>
                  </div>
                  {!canManage && (
                    <p className={styles.muted}>You have read-only access to library records.</p>
                  )}
                </Panel>
                <Panel>
                  <div className={styles.panelHead}>
                    <div>
                      <h2>Popular books</h2>
                      <p>Most-issued titles from the available report data.</p>
                    </div>
                  </div>
                  {data.dashboard.popularBooks.length ? (
                    <ol className={styles.popular}>
                      {data.dashboard.popularBooks.slice(0, 5).map((item) => (
                        <li key={item.bookId}>
                          <span>{item.title}</span>
                          <strong>{item.issueCount} issues</strong>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <Empty>
                      <p>Issue history will appear here.</p>
                    </Empty>
                  )}
                </Panel>
              </div>
              <Panel className={styles.recent}>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Current loans</h2>
                    <p>A quick look at books that haven’t been returned yet.</p>
                  </div>
                  <button className="text-button" onClick={() => setTab("Circulation")}>
                    View circulation →
                  </button>
                </div>
                {activeLoans.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Loan</th>
                          <th>Book / borrower</th>
                          <th>Due date</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeLoans.slice(0, 5).map((loan) => (
                          <tr key={loan.id}>
                            <td>{loan.loanNumber}</td>
                            <td>
                              <strong>{loan.bookTitle}</strong>
                              <br />
                              <span className={styles.muted}>{loan.borrowerName}</span>
                            </td>
                            <td>{dateLabel(loan.dueDate)}</td>
                            <td>
                              <span
                                className={`${styles.badge} ${loan.dueDate < issueDate ? styles.danger : styles.success}`}
                              >
                                {loan.dueDate < issueDate ? "Overdue" : "On loan"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    <p>No active loans. New loans will show up here.</p>
                  </Empty>
                )}
              </Panel>
            </>
          )}
          {tab === "Catalogue" && (
            <div className={styles.stack}>
              <Panel>
                <div className={styles.panelHead}>
                  <div>
                    <h2>{editingId ? "Edit book details" : "Add to your catalogue"}</h2>
                    <p>
                      {editingId
                        ? "Update the selected book record."
                        : "Register a title and its physical copies."}
                    </p>
                  </div>
                  {editingId && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setEditingId(null);
                        setBookForm(emptyBook);
                      }}
                    >
                      Cancel edit
                    </button>
                  )}
                </div>
                <form onSubmit={submitBook} className={styles.formGrid}>
                  <label className="field">
                    Title
                    <input
                      id="book-title"
                      required
                      value={bookForm.title}
                      onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Author
                    <input
                      required
                      value={bookForm.author}
                      onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    ISBN <span className={styles.muted}>(optional)</span>
                    <input
                      value={bookForm.isbn}
                      onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Categories
                    <input
                      value={bookForm.categories}
                      onChange={(e) => setBookForm({ ...bookForm, categories: e.target.value })}
                      placeholder="Science; Reference"
                    />
                  </label>
                  <label className="field">
                    Total copies
                    <input
                      required
                      min="1"
                      type="number"
                      value={bookForm.totalCopies}
                      onChange={(e) => setBookForm({ ...bookForm, totalCopies: e.target.value })}
                    />
                  </label>
                  <div className={styles.formAction}>
                    <button className="btn-primary" disabled={!canManage || busy}>
                      {busy ? "Saving…" : editingId ? "Save changes" : "Register book"}
                    </button>
                  </div>
                </form>
              </Panel>
              {canManage && <Panel>
                <div className={styles.panelHead}>
                  <div><h2>Import books in bulk</h2><p>Download the Excel-compatible CSV template, fill one book per row, then upload it. Use semicolons between categories.</p></div>
                </div>
                <div className={styles.formGrid}>
                  <button type="button" className="btn-secondary" onClick={downloadBookTemplate}>Download sample file</button>
                  <label className="field">Choose completed CSV<input type="file" accept=".csv,text/csv" onChange={(e) => setBulkFile(e.target.files?.[0] ?? null)} /></label>
                  <div className={styles.formAction}><button type="button" className="btn-primary" disabled={!bulkFile || busy} onClick={() => void importBooks()}>{busy ? "Importing…" : `Import${bulkFile ? ` ${bulkFile.name}` : " books"}`}</button></div>
                </div>
                <p className={styles.muted}>Up to 400 rows per upload. Columns: ISBN, Title, Author, Categories, Total Copies.</p>
              </Panel>}
              <Panel>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Catalogue</h2>
                    <p>
                      {filteredBooks.length} title{filteredBooks.length === 1 ? "" : "s"} · Search
                      and filter your collection.
                    </p>
                  </div>
                </div>
                <div className={styles.filters}>
                  <label className="field">
                    Search catalogue
                    <input
                      placeholder="Title, author or ISBN"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Category
                    <select value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="">All categories</option>
                      {categories.map((item) => (
                        <option value={item} key={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Availability
                    <select value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="">All availability</option>
                      <option value="available">Available</option>
                      <option value="unavailable">Unavailable</option>
                    </select>
                  </label>
                </div>
                {filteredBooks.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Book</th>
                          <th>ISBN</th>
                          <th>Categories</th>
                          <th>Copies</th>
                          <th>Availability</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredBooks.map((book) => (
                          <tr key={book.id}>
                            <td data-label="Book">
                              <strong>{book.title}</strong>
                              <br />
                              <span className={styles.muted}>{book.author}</span>
                            </td>
                            <td data-label="ISBN">{book.isbn || "—"}</td>
                            <td data-label="Categories">{book.categories.join(", ") || "—"}</td>
                            <td data-label="Copies">{book.totalCopies}</td>
                            <td data-label="Availability">
                              <strong>{book.availableCopies} available</strong>
                              <br />
                              <span className={styles.muted}>{book.borrowedCopies} on loan</span>
                            </td>
                            <td data-label="Action">
                              <button
                                className="text-button"
                                disabled={!canManage}
                                onClick={() => beginEdit(book)}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    <h3>
                      {query || category || status
                        ? "No matching books"
                        : "Your catalogue is ready to start"}
                    </h3>
                    <p>
                      {query || category || status
                        ? "Try adjusting or clearing your search and filters."
                        : "Add a book to begin building your collection."}
                    </p>
                    {!query && !category && !status && canManage && (
                      <button
                        className="btn-primary"
                        onClick={() => document.getElementById("book-title")?.focus()}
                      >
                        Register your first book
                      </button>
                    )}
                  </Empty>
                )}
              </Panel>
            </div>
          )}
          {tab === "Circulation" && (
            <div className={styles.stack}>
              <Panel>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Issue a book</h2>
                    <p>
                      Choose an available copy and match it to a current student or staff record.
                    </p>
                  </div>
                </div>
                <form onSubmit={submitIssue} className={styles.formGrid}>
                  <label className={`${styles.wide} field`}>
                    Book
                    <select
                      required
                      value={issue.bookId}
                      onChange={(e) => setIssue({ ...issue, bookId: e.target.value })}
                    >
                      <option value="">Select an available book</option>
                      {data.books
                        .filter((book) => book.availableCopies > 0)
                        .map((book) => (
                          <option value={book.id} key={book.id}>
                            {book.title} · {book.availableCopies} available
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    Borrower type
                    <select
                      value={issue.borrowerType}
                      onChange={(e) => {
                        setIssue({
                          ...issue,
                          borrowerType: e.target.value as "student" | "staff",
                          borrowerId: "",
                        });
                        setBorrowerSearch("");
                        setBorrowerQuery("");
                        setSelectedBorrower(null);
                        setBorrowerGrade("");
                        setBorrowerClass("");
                      }}
                    >
                      <option value="student">Student</option>
                      <option value="staff">Staff</option>
                    </select>
                  </label>
                  <div className={`${styles.wide} field`}>
                    <label htmlFor="library-borrower-search">
                      Find {issue.borrowerType === "student" ? "student" : "staff"}
                    </label>
                    <div className={styles.searchInputWrap}>
                      <input
                        id="library-borrower-search"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={!selectedBorrower && borrowerSearch.trim().length > 0}
                        aria-controls="library-borrower-suggestions"
                        autoComplete="off"
                        value={borrowerSearch}
                        onChange={(e) => {
                          setBorrowerSearch(e.target.value);
                          setSelectedBorrower(null);
                          setIssue({ ...issue, borrowerId: "" });
                        }}
                        placeholder={
                          issue.borrowerType === "student"
                            ? "Type an admission ID or student name"
                            : "Type a staff name or number"
                        }
                      />
                      {!selectedBorrower && borrowerSearch.trim() && (
                        <div
                          id="library-borrower-suggestions"
                          className={styles.suggestions}
                          role="listbox"
                          aria-label="Matching borrowers"
                        >
                          {borrowerSuggestions.length ? (
                            borrowerSuggestions.map((borrower) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected={false}
                                className={styles.suggestion}
                                key={`${borrower.type}-${borrower.id}`}
                                onClick={() => {
                                  setSelectedBorrower(borrower);
                                  setIssue({ ...issue, borrowerId: borrower.id });
                                  setBorrowerSearch(borrower.name);
                                }}
                              >
                                <span>
                                  <strong>{borrower.name}</strong>
                                  <small>
                                    {borrower.type === "student"
                                      ? `${borrower.reference} · ${borrower.grade || "Grade not set"}${borrower.className ? ` · Class ${borrower.className}` : ""}`
                                      : borrower.reference}
                                  </small>
                                </span>
                                <span aria-hidden="true">Select</span>
                              </button>
                            ))
                          ) : (
                            <div className={styles.noSuggestions}>
                              {issue.borrowerType === "student"
                                ? "No student found. Try an admission ID or another part of the name."
                                : "No matching staff record found."}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {issue.borrowerType === "student" && (
                      <button
                        type="button"
                        className={`btn-secondary ${styles.scanButton}`}
                        onClick={() => {
                          setError("");
                          setScanError("");
                          setScannerOpen(true);
                        }}
                      >
                        <Camera size={15} />
                        Scan student ID QR
                      </button>
                    )}
                    {scannerOpen && issue.borrowerType === "student" && (
                      <div
                        className={styles.scannerPanel}
                        role="dialog"
                        aria-label="Scan student ID QR"
                      >
                        <div className={styles.scannerHeader}>
                          <strong>Scan student ID</strong>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => {
                              setScannerOpen(false);
                              setScanError("");
                            }}
                          >
                            <X size={15} />
                            Close
                          </button>
                        </div>
                        <video
                          ref={videoRef}
                          className={styles.scannerVideo}
                          muted
                          playsInline
                          autoPlay
                          aria-label="Camera view for scanning the student QR code"
                        />
                        {scanError ? (
                          <p className={styles.scanError} role="alert">
                            {scanError}
                          </p>
                        ) : (
                          <p className={styles.scanHint}>
                            Point the camera at the QR code on the student ID card.
                          </p>
                        )}
                      </div>
                    )}
                    {selectedBorrower && (
                      <div className={styles.selectedBorrower} role="status">
                        <span>
                          <strong>{selectedBorrower.name}</strong>
                          <small>
                            {selectedBorrower.type === "student"
                              ? `Admission ID ${selectedBorrower.reference}${selectedBorrower.grade ? ` · Grade ${selectedBorrower.grade}` : ""}${selectedBorrower.className ? ` · Class ${selectedBorrower.className}` : ""}`
                              : selectedBorrower.reference}
                          </small>
                        </span>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            setSelectedBorrower(null);
                            setIssue({ ...issue, borrowerId: "" });
                            setBorrowerSearch("");
                          }}
                        >
                          Change
                        </button>
                      </div>
                    )}
                  </div>
                  {issue.borrowerType === "student" && (
                    <>
                      <label className="field">
                        Grade
                        <select
                          value={borrowerGrade}
                          onChange={(e) => {
                            setBorrowerGrade(e.target.value);
                            setBorrowerClass("");
                            setSelectedBorrower(null);
                            setIssue({ ...issue, borrowerId: "" });
                          }}
                        >
                          <option value="">All grades</option>
                          {grades.map((grade) => (
                            <option key={grade}>{grade}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Class
                        <select
                          value={borrowerClass}
                          onChange={(e) => {
                            setBorrowerClass(e.target.value);
                            setSelectedBorrower(null);
                            setIssue({ ...issue, borrowerId: "" });
                          }}
                        >
                          <option value="">All classes</option>
                          {classes.map((name) => (
                            <option key={name}>{name}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  <label className="field">
                    Issue date (automatic)
                    <input type="date" value={issueDate} readOnly />
                  </label>
                  <label className="field">
                    Custom due date
                    <input
                      required
                      type="date"
                      value={issue.dueDate}
                      min={issueDate}
                      onChange={(e) => setIssue({ ...issue, dueDate: e.target.value })}
                    />
                  </label>
                  <fieldset className={`${styles.wide} ${styles.presets}`}>
                    <legend>Quick due-date presets</legend>
                    {[7, 14, 21, 28].map((days) => (
                      <button
                        key={days}
                        type="button"
                        className={
                          issue.dueDate === dateAfterDays(issueDate, days)
                            ? "btn-primary"
                            : "btn-secondary"
                        }
                        aria-pressed={issue.dueDate === dateAfterDays(issueDate, days)}
                        onClick={() =>
                          setIssue({ ...issue, dueDate: dateAfterDays(issueDate, days) })
                        }
                      >
                        {days} days
                      </button>
                    ))}
                  </fieldset>
                  <div className={styles.formAction}>
                    <button
                      className="btn-primary"
                      disabled={
                        !canManage ||
                        busy ||
                        !data.books.some(
                          (book) => book.id === issue.bookId && book.availableCopies > 0,
                        ) ||
                        !issue.borrowerId
                      }
                    >
                      {busy ? "Issuing…" : "Issue book"}
                    </button>
                  </div>
                </form>
                {!data.books.some((book) => book.availableCopies > 0) && (
                  <p className={styles.muted}>No books are currently available to issue.</p>
                )}
              </Panel>
              <Panel>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Active loans</h2>
                    <p>Return a book to restore availability and record any applicable fine.</p>
                  </div>
                  <span className={styles.count}>{activeLoans.length}</span>
                </div>
                {activeLoans.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Loan</th>
                          <th>Book / borrower</th>
                          <th>Dates</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>{loanRows(activeLoans)}</tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    <h3>All caught up</h3>
                    <p>There are no active loans to return.</p>
                  </Empty>
                )}
              </Panel>
              <Panel>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Loan history</h2>
                    <p>Returned and active circulation records.</p>
                  </div>
                </div>
                {data.loans.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Loan</th>
                          <th>Book / borrower</th>
                          <th>Dates</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.loans.map((loan) => (
                          <tr key={loan.id}>
                            <td data-label="Loan">{loan.loanNumber}</td>
                            <td data-label="Book / borrower">
                              <strong>{loan.bookTitle}</strong>
                              <br />
                              <span className={styles.muted}>
                                {loan.borrowerName} · {loan.borrowerType}
                              </span>
                            </td>
                            <td data-label="Dates">
                              Issued {dateLabel(loan.issueDate)}
                              <br />
                              <span className={styles.muted}>
                                {loan.status === "returned"
                                  ? `Returned ${dateLabel(loan.returnedDate)}`
                                  : `Due ${dateLabel(loan.dueDate)}`}
                              </span>
                            </td>
                            <td data-label="Status">
                              {loan.status === "returned"
                                ? "Returned"
                                : loan.dueDate < issueDate
                                  ? "Overdue"
                                  : "On loan"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    <p>No loan records yet.</p>
                  </Empty>
                )}
              </Panel>
            </div>
          )}
          {tab === "Fines & activity" && (
            <div className={styles.stack}>
              <Panel>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Fine policy</h2>
                    <p>Fine is calculated per overdue day when a book is returned.</p>
                  </div>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(
                      { action: "update_settings", finePerDay: Number(finePerDay) },
                      "Fine policy updated.",
                    );
                  }}
                  className={styles.policyForm}
                >
                  <label className="field">
                    Fine per overdue day
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={finePerDay}
                      onChange={(e) => setFinePerDay(e.target.value)}
                    />
                  </label>
                  <button className="btn-primary" disabled={!canManage || busy}>
                    {busy ? "Saving…" : "Save policy"}
                  </button>
                </form>
              </Panel>
              <Panel>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Outstanding fines</h2>
                    <p>Record a payment up to the outstanding balance shown.</p>
                  </div>
                  <strong>{money(data.dashboard.outstandingFines)} total</strong>
                </div>
                {data.fines.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Borrower</th>
                          <th>Loan</th>
                          <th>Total fine</th>
                          <th>Outstanding</th>
                          <th>Record payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.fines.map((fine) => (
                          <tr key={fine.id}>
                            <td data-label="Borrower">{fine.borrowerName ?? "—"}</td>
                            <td data-label="Loan">{fine.loanNumber ?? fine.loanId}</td>
                            <td data-label="Total fine">
                              {money(fine.totalAmount)}
                              <br />
                              <span className={styles.muted}>Paid {money(fine.paidAmount)}</span>
                            </td>
                            <td data-label="Outstanding">
                              <strong>{money(fine.outstandingAmount)}</strong>
                            </td>
                            <td data-label="Record payment">
                              <div className={styles.payment}>
                                <label className={styles.srOnly} htmlFor={`payment-${fine.id}`}>
                                  Payment amount for {fine.borrowerName ?? fine.id}
                                </label>
                                <input
                                  id={`payment-${fine.id}`}
                                  type="number"
                                  min="0.01"
                                  max={fine.outstandingAmount}
                                  step="0.01"
                                  placeholder="Amount"
                                  value={payment[fine.id] ?? ""}
                                  onChange={(e) =>
                                    setPayment({ ...payment, [fine.id]: e.target.value })
                                  }
                                />
                                <button
                                  className="btn-secondary"
                                  disabled={
                                    !canManage ||
                                    busy ||
                                    !payment[fine.id] ||
                                    Number(payment[fine.id]) > fine.outstandingAmount ||
                                    Number(payment[fine.id]) <= 0
                                  }
                                  onClick={() =>
                                    void send(
                                      {
                                        action: "pay_fine",
                                        fineId: fine.id,
                                        amount: Number(payment[fine.id]),
                                      },
                                      "Fine payment recorded.",
                                    ).then((ok) => {
                                      if (ok) setPayment({ ...payment, [fine.id]: "" });
                                    })
                                  }
                                >
                                  Record
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    <h3>No outstanding fines</h3>
                    <p>When fines are recorded, balances and payment actions will appear here.</p>
                  </Empty>
                )}
              </Panel>
              <Panel>
                <div className={styles.panelHead}>
                  <div>
                    <h2>Recent activity</h2>
                    <p>Circulation and payment history recorded for this school.</p>
                  </div>
                  <button className="btn-secondary" onClick={exportCsv}>
                    Export report
                  </button>
                </div>
                {data.transactions.length ? (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Type</th>
                          <th>Book</th>
                          <th>Borrower</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.transactions.slice(0, 20).map((item) => (
                          <tr key={item.id}>
                            <td data-label="Time">{timestampLabel(item.occurredAt)}</td>
                            <td data-label="Type">
                              <span className={styles.badge}>{item.type.replaceAll("_", " ")}</span>
                            </td>
                            <td data-label="Book">{item.bookTitle ?? "—"}</td>
                            <td data-label="Borrower">{item.borrowerName ?? "—"}</td>
                            <td data-label="Amount">{money(Number(item.amount ?? 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>
                    <p>No activity recorded yet.</p>
                  </Empty>
                )}
              </Panel>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
