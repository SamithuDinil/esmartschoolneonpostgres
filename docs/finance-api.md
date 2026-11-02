# Finance API notes

The finance route is tenant-scoped at `schools/{activeSchoolId}` and requires the session cookie plus the CSRF token for every write.

- `GET /api/finance` requires `finance.read` and returns the school fee types, students, invoices, payments, expenses, and dashboard metrics from the active school only, including monthly revenue, overdue balances and net figures.
- `POST /api/finance` requires `finance.manage` for fee types, invoices, cash/bank-transfer payments, and expenses. Expense forms can optionally attach a private PDF/JPEG/PNG/WebP receipt via `POST /api/finance/expenses/{expenseId}/receipt`; upload access requires `finance.manage`, file-signature validation and a 10 MB size limit. `GET` on the same resource requires `finance.read` and returns a five-minute signed download URL for one attachment.
- Expense decisions additionally require `finance.expenses.approve`; decisions are audited and can only be made once.
- Invoice numbers are allocated by an atomic RTDB-backed transaction on `schools/{schoolId}/counters/invoices`.
- Payment and receipt documents are created in one transaction with the invoice balance/status update. Receipts and payments have no update API and are marked immutable.

## Online payment verification

A browser cannot submit `action: "payment", method: "online_verified"`; the route rejects that request because a browser-provided confirmation is not trusted. A server-side payment provider webhook or an internal, protected admin service must call the same route with:

```http
POST /api/finance
x-csrf-token: <valid session CSRF token>
x-finance-verification-token: <FINANCE_ONLINE_VERIFICATION_TOKEN>
Content-Type: application/json
```

The authenticated service user must have both `finance.manage` and `finance.payments.verify`. The body is:

```json
{
  "action": "verify_online_payment",
  "invoiceId": "<school-invoice-id>",
  "amount": 12500,
  "providerReference": "<provider-settlement-reference>",
  "notes": "Provider settlement verified"
}
```

`FINANCE_ONLINE_VERIFICATION_TOKEN` must be configured as a server-only environment variable and must never be exposed to client code. The API adds the server-generated `verifiedMarker: "server_verified"`, provider reference, verifier, and verification time to the immutable payment/receipt records. A failed or missing marker, token, permission, invoice, or balance check is rejected.


## Receipts

Each cash, bank-transfer, or server-verified online payment creates an immutable receipt record transactionally with the invoice balance update. Authorized finance users can print receipts from the Finance overview. Expense receipt files are stored under the school-scoped finance path, direct Storage access remains denied, and the API returns only short-lived signed download URLs after checking school and permission scope.
