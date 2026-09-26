// Browser pass with the locally installed Chrome: real clicks, real rendering, screenshots.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3100";
const OUT = path.resolve("docs/screenshots");
const FIX = path.resolve("tests/fixtures");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const docs = (await (await fetch(`${BASE}/api/documents`)).json()).documents;
const id = (n) => docs.find((d) => d.name === n).id;

// Library
await page.goto(BASE);
await page.getByText("long_msa.pdf").waitFor();
check("library lists documents", (await page.getByRole("link", { name: "long_msa.pdf" }).count()) === 1);
await page.getByLabel("Select msa_v1.docx").click();
await page.getByLabel("Select msa_v2.docx").click();
check("selection bar enables Compare for exactly two", await page.getByRole("button", { name: "Compare" }).isEnabled());
await page.screenshot({ path: `${OUT}/01-library.png` });
await page.getByLabel("Select msa_v1.docx").click();
await page.getByLabel("Select msa_v2.docx").click();

// Upload rejection through the UI
await page.locator('input[type="file"]').setInputFiles(path.join(FIX, "notes.txt"));
await page.getByText("isn't a PDF or Word").waitFor({ timeout: 10000 });
check("uploading a .txt shows the rejection inline", true);

// PDF workspace: ask, verify chip, click → highlight
await page.goto(`${BASE}/documents/${id("long_msa.pdf")}`);
await page.locator('[data-page="1"] canvas').first().waitFor({ timeout: 30000 });
check("PDF renders in the viewer (pdf.js worker loads)", true);
await page.getByLabel("Ask a question about the document").fill("Which law governs the agreement?");
await page.getByRole("button", { name: "Send (Enter)" }).click();
const chip = page.getByRole("button", { name: /^Source 1: verified quote/ });
await chip.waitFor({ timeout: 60000 });
await page.getByText(/quotes? verified/).first().waitFor({ timeout: 60000 });
check("answer shows a verified citation chip and coverage badge", (await page.getByText(/Based on \d+% of the document/).count()) > 0);
await chip.click();
const hl = page.locator('[data-page="142"] .citation-flash');
await hl.first().waitFor({ timeout: 20000 });
check("clicking the citation highlights the passage on page 142", (await hl.count()) > 0, `${await hl.count()} rect(s)`);
await page.mouse.move(700, 450);
await page.waitForTimeout(1200);
const inView = await page.evaluate(() => {
  const r = document.querySelector('[data-page="142"] .citation-flash')?.getBoundingClientRect();
  return !!r && r.top >= 0 && r.bottom <= window.innerHeight;
});
check("the viewer scrolls the highlighted passage into view", inView, `page box: ${await page.locator("#page-jump").getAttribute("placeholder")}`);
await page.screenshot({ path: `${OUT}/02-chat-highlight-p142.png` });

// Cross-page quote: ask about business continuity, click, expect rects on two pages
await page.getByLabel("Ask a question about the document").fill("How often must business continuity arrangements be tested?");
await page.getByRole("button", { name: "Send (Enter)" }).click();
await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Source 1: verified quote"]').length >= 2, null, { timeout: 60000 });
await page.getByRole("button", { name: /^Source 1: verified quote/ }).last().click();
await page.mouse.move(700, 450);
await page.waitForTimeout(1500);
const pagesWithHl = await page.$$eval(".citation-flash", (els) => [...new Set(els.map((e) => e.closest("[data-page]")?.getAttribute("data-page")))]);
check("a quote across a page break highlights on both pages", pagesWithHl.length >= 2, `pages ${pagesWithHl.join(",")}`);
await page.screenshot({ path: `${OUT}/03-highlight-page-break.png` });

// Reported issues: double-click Send, message order, "Ask again", vague question → overview.
await page.goto(`${BASE}/documents/${id("long_msa.pdf")}`);
await page.getByRole("button", { name: "New chat" }).click().catch(() => {});
await page.goto(`${BASE}/documents/${id("long_msa.pdf")}`);
const before = (await (await fetch(`${BASE}/api/conversations?documentId=${id("long_msa.pdf")}`)).json()).conversations.length;
await page.getByLabel("Ask a question about the document").fill("tell me abou ti");
// A real double-click: the second click lands where Send was (now Stop) and must change nothing.
await page.getByRole("button", { name: "Send (Enter)" }).dblclick();
check("Send turns into Stop immediately (question shown at once)", (await page.getByText("tell me abou ti").count()) > 0 && (await page.getByRole("button", { name: /Stop generating/ }).count()) === 1);
await page.getByText(/quotes? verified|No quotes/).last().waitFor({ timeout: 90000 });
const after = (await (await fetch(`${BASE}/api/conversations?documentId=${id("long_msa.pdf")}`)).json()).conversations;
check("a double-click on Send creates exactly one chat and doesn't stop it", after.length === before + 1 && !/Stopped/.test(await page.locator("article").last().innerText()), `${before} → ${after.length}`);
const overviewText = await page.locator("article").last().innerText();
check("a vague question gets an overview, not 'found no provision'", !/found no provision|found nothing that answers/i.test(overviewText) && /Overview/i.test(overviewText), overviewText.slice(0, 80).replace(/s+/g, " "));
await page.reload();
await page.locator('[data-testid="messages"]').waitFor({ timeout: 20000 });
const order = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[data-testid="messages"] > li')];
  return items.map((li) => (li.querySelector("article") ? "answer" : "question"));
});
check("after reload the question is above its answer", order.join(",") === "question,answer", order.join(","));
await page.getByRole("button", { name: "Ask again" }).last().click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid="messages"] > li > article').length >= 2, null, { timeout: 90000 });
check("'Ask again' re-asks the question", true);

// Unverified quote (debug toggle), DOCX viewer highlight
await page.goto(`${BASE}/documents/${id("msa_v1.docx")}?debugInjectFakeQuote=1`);
await page.locator(".docx-body [data-o]").first().waitFor({ timeout: 20000 });
await page.getByLabel("Ask a question about the document").fill("What is the liability cap?");
await page.getByRole("button", { name: "Send (Enter)" }).click();
await page.getByRole("note", { name: /Unverified quote/ }).first().waitFor({ timeout: 60000 });
check("an invented quote renders as 'unverified', not as a source", (await page.getByRole("note", { name: /Unverified quote/ }).count()) >= 1);
await page.getByRole("button", { name: /^Source 1: verified quote/ }).first().click();
await page.waitForTimeout(800);
const docxHl = await page.evaluate(() => ("highlights" in CSS ? CSS.highlights.has("citation") : document.querySelectorAll("mark.citation-mark").length > 0));
check("DOCX citation highlight applied", docxHl);
await page.screenshot({ path: `${OUT}/04-docx-verified-and-unverified.png` });

// Agent mode timeline
await page.getByRole("radio", { name: "Research agent" }).click();
await page.getByLabel("Ask a question about the document").fill("What are the termination rights?");
await page.getByRole("button", { name: "Send (Enter)" }).click();
await page.getByText(/Researched in \d+ steps?/).waitFor({ timeout: 60000 });
check("agent timeline collapses to a summary", true);
await page.getByText(/Researched in \d+ steps?/).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/05-agent-timeline.png` });

// Multi-document chat
const conv = await (await fetch(`${BASE}/api/conversations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentIds: [id("msa_v1.docx"), id("msa_v2.docx")] }) })).json();
await page.goto(`${BASE}/chat/${conv.conversation.id}`);
await page.getByLabel("Ask a question about the document").fill("Compare the liability cap");
await page.getByRole("button", { name: "Send (Enter)" }).click();
await page.getByRole("button", { name: /Source 2: verified quote/ }).waitFor({ timeout: 60000 });
await page.getByRole("button", { name: /Source 2: verified quote/ }).click();
await page.waitForTimeout(800);
const activeTab = await page.getByRole("tab", { selected: true }).innerText();
check("clicking a D2 citation switches the viewer to D2", /D2/.test(activeTab), activeTab.replace(/\s+/g, " "));
await page.screenshot({ path: `${OUT}/06-multi-document.png` });

// Comparison
const cmp = await (await fetch(`${BASE}/api/comparisons`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docAId: id("msa_v1.docx"), docBId: id("msa_v2.docx") }) })).json();
await page.goto(`${BASE}/compare/${cmp.comparison.id}`);
await page.getByText("Executive summary").waitFor({ timeout: 60000 });
check("comparison shows critical changes", (await page.getByText(/AED 1,000,000/).count()) > 0);
await page.screenshot({ path: `${OUT}/07-comparison.png`, fullPage: false });

// Mobile layout
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/documents/${id("msa_v1.docx")}`);
await page.getByRole("button", { name: "View document" }).waitFor();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check("mobile: chat full-screen with a 'View document' sheet, no horizontal scroll", !overflow);

check("no uncaught page errors", errors.filter((e) => !/favicon|Download the React DevTools|status of 415/.test(e)).length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`);
if (results.some((x) => !x)) process.exitCode = 1;
