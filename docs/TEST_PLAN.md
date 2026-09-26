# Manual test plan

Use the files in `tests/fixtures/`. The expected answers below come from their contents. The AI's wording will vary, but the **facts, sources, pages and behaviour** should match. Run the whole plan on the deployed app too, not only locally.

**How to read a result**
- **①②** are verified sources. Click one, or its row under **Sources**, and the document scrolls to the passage and highlights it in yellow.
- **⚠ unverified** means the AI wrote a quote that isn't in the document. It must never appear as a numbered source.
- **The pill at the top of each answer** ("Based on N% of the document") shows how much was read. Click it for sections and pages.

## 1. Upload and library

| # | Do | Expect |
|---|---|---|
| 1.1 | Upload `notes.txt` | Rejected immediately: *"notes.txt" isn't a PDF or Word (.docx) file…* |
| 1.2 | Upload `legacy.doc` | Rejected: *…legacy Word .doc… Save it as .docx…* |
| 1.3 | Upload `encrypted.pdf` | Rejected: *This PDF is password-protected…* |
| 1.4 | Upload `corrupted.pdf` | Rejected: *This file appears to be damaged…* |
| 1.5 | Upload `long_msa.pdf` (149 pages) | Row shows live stages ("Extracting text: page N of 149" → "Preparing search index" → Ready), a progress bar and a timer. Ready in seconds, **149 pages**. |
| 1.6 | Upload `scanned.pdf` | Ends as **failed**: *…no selectable text — it looks like a scanned image…*. No Retry button (retrying can't help). |
| 1.7 | Upload `partial_scan.pdf` | Ready, with a ⚠ warning: *Pages 3–4 have no readable text…* |
| 1.8 | Upload `msa_v1.docx` and `msa_v2.docx` | Both ready |
| 1.9 | Click **Chat** on a row, then go back and click **Delete** on another | Chat opens the workspace. Delete asks for confirmation (and says what else goes with it), then removes the row. |

## 2. Chat: `msa_v1.docx` (small, read in full)

| # | Ask | Expected answer | Expected behaviour |
|---|---|---|---|
| 2.1 | What is the liability cap? | **AED 100,000**, clause **6.1** | Pill: *Based on 100%*. Clicking ① highlights 6.1. |
| 2.2 | How long is the agreement and does it renew? | **3 years**, then **automatic 1-year renewals** unless notice of non-renewal (2.1, 2.2) | Two verified sources |
| 2.3 | What are the fees? | Service desk **AED 25,000**/month, infrastructure management **AED 40,000**/month; invoices paid within **30 days** (4.1–4.2) | |
| 2.4 | How can the agreement be terminated? | For convenience on **30 days'** written notice (7.1); immediately for material breach not remedied within **14 days** (7.2) | |
| 2.5 | Which law governs the agreement? | **Emirate of Dubai**, Dubai courts (10.1) | |
| 2.6 | Is there a non-compete clause? | **No.** *"I read the entire document and found nothing that answers this…"* | Must not invent one |
| 2.7 | tell me about it | A short overview (parties, services, fees, liability, termination, law), each point sourced | Fast. Never "no provision addressing…" |

## 3. Chat: `long_msa.pdf` (149 pages; tests the large-document strategy)

| # | Ask | Expected answer | Expected behaviour |
|---|---|---|---|
| 3.1 | Which law governs the agreement? | **Laws of the Emirate of Dubai**, clause **40.16**, **page 142** | Pill ≈ *Based on 15–30%*. Clicking ① jumps to **page 142** and highlights it. |
| 3.2 | What is the Liability Cap? | **AED 100,000 in any Contract Year**, definition 1.10, **page 3** (may also cite 20.1 on p. 54) | |
| 3.3 | What is the notice period for termination for convenience? | **Not less than 30 days' written notice**, clause 26.1, **page 71** | |
| 3.4 | How often must business continuity arrangements be tested? | **At least annually**, with a written summary within **ten Business Days** (22.1) | The quote crosses the page break: highlights on **pp. 59 and 60**, header and footer not highlighted |
| 3.5 | What survives termination? | Mentions of *"This clause shall survive termination or expiry of this Agreement."* | The source says *appears N×*. The viewer shows **Occurrence 1 of N** with ‹ › arrows. |
| 3.6 | Is there an arbitration clause? | Either what the dispute-resolution article says, or a clear "not found" | Must read the **whole** document (status "Reading pages x–y (n of N)…", pill *Checked 100%*). **Never** "no" based on a few sections. |
| 3.7 | Same question with **Whole document** mode | Same facts | Always a full scan (about 10–30 s) |
| 3.8 | Summarize this contract | Overview: Master Services Agreement between **Acme Holdings LLC** (Customer) and **Northwind Services FZ-LLC** (Supplier), with liability, termination, force majeure… | Fast (about 5–10 s), all sources verified |
| 3.9 | Ask a long question, then press **Stop** after a few words | *Stopped — partial answer kept* | Reload the page: the partial answer is still there. **History** lists the chat. |
| 3.10 | Double-click **Send** | One question, one answer, one chat | Send turns into Stop instantly |

## 4. Verification and "not found"

| # | Do | Expect |
|---|---|---|
| 4.1 | With `ENABLE_DEBUG_TOGGLES=true`, open a document with `?debugInjectFakeQuote=1` in the URL and ask anything | The invented quote ("…unlimited free support…") shows as **⚠ unverified** and appears under **Not verified**, not under Sources. Footer: *1 of 2 quotes verified*. |
| 4.2 | Ask `partial_scan.pdf`: Does the contract mention insurance? | Must say pages **3–4 are scanned and weren't read**, and must not claim a definite absence |

## 5. Multi-document (`msa_v1.docx` + `msa_v2.docx`)

In the library, tick both files → **Ask across documents**.

| # | Ask | Expected answer |
|---|---|---|
| 5.1 | Compare the liability caps | **D1: AED 100,000** vs **D2: AED 1,000,000**, each quote tagged and verified against its own document. A "Difference" line saying the cap rose tenfold. |
| 5.2 | Which law governs each agreement? | **D1: Dubai** vs **D2: England and Wales** (London courts) |
| 5.3 | Does either contain a non-compete? | **Only D2** (clause 9.1: 12 months after the term, in the UAE). D1: not found. |
| 5.4 | Click a **D2** source | The viewer switches to the D2 tab and highlights the passage |

## 6. Comparison

**Compare** → Original `msa_v1.docx`, Revised `msa_v2.docx`.

| Expect | Rating |
|---|---|
| Liability cap AED 100,000 → **AED 1,000,000** (×10), §6.1 → §5.1 | **Critical** |
| Governing law Dubai → **England and Wales** | **Critical** |
| Termination notice **30 → 60 days** | Major |
| "shall deliver" → "**may** deliver" a performance report (3.2) | Major |
| **Non-Compete added** (§9) | Major |
| Audit Rights removed | Minor (or higher) |
| Confidentiality moved §5 → §8, wording unchanged | Minor |
| Oxford comma added in "Business Day" (1.3) | Cosmetic (hidden until you tick Cosmetic) |
| Reworded sentence in 3.3 ("ensure… personnel" → "make sure… staff") | Minor or cosmetic, never critical |

Also check:
- the executive summary's **C12**-style links jump to the change;
- filtering by significance and type works, as do sorting and search;
- **View in original / revised** opens both documents, side by side, with the clause highlighted.

## 7. Research agent

Choose **Research agent** in the composer.

| # | Ask | Expect |
|---|---|---|
| 7.1 | What is the notice period for termination for convenience, and does anything limit it? | A live timeline ("Reviewing the contract's structure…", "Searching for…", "Reading §26…"), then **30 days**, sourced from **page 71**. It then collapses to *Researched in N steps*. |
| 7.2 | What does clause 99 say? | The agent handles the bad section number (the step shows a "did you mean" hint) and answers honestly that there is no clause 99 |
| 7.3 | Is there a non-compete anywhere? | Either uses *Reading the entire document…* before saying no, or says which sections it checked. Never a flat "no" after a few searches. |

## 8. Mobile (phone, or the browser's device mode at about 390 px wide)

- Library: rows readable, and Chat and Delete buttons easy to tap.
- The workspace opens as a full-screen chat with a **View document** button.
- Tapping a source opens the document in a sheet, scrolled to the passage and highlighted.
- The coverage pill opens its details on tap.
- The mode picker fits on one line (Standard / Whole doc / Agent).
- No sideways scrolling on any page, including Compare.

## 9. Resilience

- Kill the server while `long_msa.pdf` is processing, then start it again. The document finishes on its own, about 2 minutes later, when the job's lease expires.
- Refresh the page while an answer is streaming. The partial answer is kept and marked *Interrupted*.
