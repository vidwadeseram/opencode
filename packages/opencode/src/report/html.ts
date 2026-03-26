import fs from "fs/promises"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { ReportManifest } from "@/report/manifest"
import { ReportRun } from "@/report/run"
import { ReportTemplate } from "@/report/template"

interface AIOTest {
  id: string
  name: string
  status: string
  note?: string
  error?: string
  description?: string
  blocker?: string
}

interface AIOTestResult {
  test_id: string
  path: string
  description?: string
}

interface AIOManifest {
  run_id: string
  created_at: string
  status: string
  summary?: {
    total: number
    passed: number
    failed: number
    skipped: number
    blocked: number
    status?: string
  }
  tests?: AIOTest[]
  screenshots?: AIOTestResult[]
  video?: { path: string }
  blocker?: string
}

async function walk(base: string, dir: string): Promise<string[]> {
  const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const out = await Promise.all(
    list.map(async (x) => {
      const full = path.join(dir, x.name)
      if (x.isDirectory()) return walk(base, full)
      return [path.relative(base, full).split(path.sep).join("/")]
    }),
  )
  return out.flat()
}

function esc(v: string) {
  return ReportTemplate.esc(v)
}

function statusBadge(status: string) {
  const s = status.toLowerCase()
  if (s === "passed" || s === "pass") return `<span class="badge status-pass">passed</span>`
  if (s === "failed" || s === "fail") return `<span class="badge status-fail">failed</span>`
  if (s === "skipped") return `<span class="badge status-partial">skipped</span>`
  if (s === "blocked") return `<span class="badge status-fail">blocked</span>`
  if (s === "running") return `<span class="badge status-running">running</span>`
  return `<span class="badge status-partial">${esc(status)}</span>`
}

function testRow(t: AIOTest, shotPath?: string) {
  const note = t.note || t.error || t.description || t.blocker || ""
  const shot = shotPath ? `<a href="${esc(shotPath)}" target="_blank" rel="noreferrer">📷</a>` : ""
  return `<tr>
    <td><code>${esc(t.id)}</code></td>
    <td>${esc(t.name)}</td>
    <td>${statusBadge(t.status)}</td>
    <td class="muted">${note ? esc(note) : "—"}</td>
    <td>${shot}</td>
  </tr>`
}

function page(input: {
  id: string
  created: string
  shots: string[]
  videos: string[]
  warnings: string[]
  tests?: AIOTest[]
  summary?: { total: number; passed: number; failed: number; skipped: number; blocked: number }
  blocker?: string
}) {
  const shots =
    input.shots.length === 0
      ? '<p class="warn" data-warning="screenshots">No screenshots found.</p>'
      : `<ul class="clean grid">${input.shots
          .map(
            (x) =>
              `<li class="card"><figure><a href="${esc(x)}"><img loading="lazy" src="${esc(x)}" alt="${esc(x)}" /></a><figcaption><a href="${esc(x)}">${esc(x)}</a></figcaption></figure></li>`,
          )
          .join("")}</ul>`
  const videos =
    input.videos.length === 0
      ? '<p class="warn" data-warning="video">No video found.</p>'
      : `<ul class="clean grid">${input.videos
          .map(
            (x) =>
              `<li class="card"><figure><video controls preload="metadata" src="${esc(x)}"></video><figcaption><a href="${esc(x)}">${esc(x)}</a></figcaption></figure></li>`,
          )
          .join("")}</ul>`
  const warn =
    input.warnings.length === 0
      ? ""
      : `<section class="card"><div class="line"><h2>Warnings</h2><span class="badge status-partial">attention</span></div><ul class="clean">${input.warnings
          .map((x) => `<li class="warn">${esc(x)}</li>`)
          .join("")}</ul></section>`

  let testsSection = ""
  if (input.tests && input.tests.length > 0) {
    const shotByTest: Record<string, string> = {}
    for (const s of input.shots) {
      const name = path.basename(s, path.extname(s))
      shotByTest[name] = s
    }

    const rows = input.tests.map((t) => {
      const shotKey = t.id.toLowerCase()
      const shot = shotByTest[shotKey] || shotByTest[shotKey.replace(/-/g, "")] || undefined
      return testRow(t, shot)
    })

    const total = input.summary?.total ?? input.tests.length
    const passed = input.summary?.passed ?? input.tests.filter((t) => t.status === "passed").length
    const failed = input.summary?.failed ?? input.tests.filter((t) => t.status === "failed").length
    const skipped = input.summary?.skipped ?? input.tests.filter((t) => t.status === "skipped").length
    const blocked = input.summary?.blocked ?? input.tests.filter((t) => t.status === "blocked").length
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0"

    let summaryStrip = ""
    if (input.summary) {
      summaryStrip = `<div class="line" style="margin-bottom:12px">
        <span class="badge status-pass">${passed} passed</span>
        <span class="badge status-fail">${failed} failed</span>
        <span class="badge status-partial">${skipped} skipped</span>
        ${blocked > 0 ? `<span class="badge status-fail">${blocked} blocked</span>` : ""}
        <span class="muted">${passRate}% pass rate</span>
      </div>`
    }

    testsSection = `<section class="card">
      <h2>Test Results <span class="muted">(${total} total)</span></h2>
      ${summaryStrip}
      ${input.blocker ? `<p class="warn" style="margin-bottom:12px"><strong>Blocker:</strong> ${esc(input.blocker)}</p>` : ""}
      <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:2px solid var(--line)">
            <th style="text-align:left;padding:6px 8px">ID</th>
            <th style="text-align:left;padding:6px 8px">Name</th>
            <th style="text-align:left;padding:6px 8px">Status</th>
            <th style="text-align:left;padding:6px 8px">Details</th>
            <th style="text-align:left;padding:6px 8px">Shot</th>
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
      </div>
    </section>`
  }

  return ReportTemplate.doc({
    title: `Regression Run ${input.id}`,
    body: [
      "<header>",
      `<div><h1>Regression Run <code>${esc(input.id)}</code></h1><p>Created at <code>${esc(input.created)}</code></p></div>`,
      '<a class="btn" href="/reports">Back to reports</a>',
      "</header>",
      '<div class="stack">',
      warn,
      testsSection,
      '<section class="card"><h2>Screenshots <span class="muted">(' + input.shots.length + ')</span></h2>',
      shots,
      "</section>",
      '<section class="card"><h2>Video</h2>',
      videos,
      "</section>",
      "</div>",
    ].join("\n"),
  })
}

export namespace ReportHTML {
  export async function generate(input: { root: string; id: string }) {
    const id = ReportRun.validate(input.id)
    const root = path.resolve(input.root)
    const dir = path.join(root, id)
    const index = path.join(dir, "index.html")
    const file = path.join(dir, "manifest.json")

    const all = await walk(dir, dir)
    const shots = all.filter((x) => /\.(png|jpg|jpeg|webp)$/i.test(x))
    const videos = all.filter((x) => /\.(mp4|webm)$/i.test(x))
    const warnings: string[] = []

    // Try allinonepos manifest format first (tests[], screenshots[], video.path)
    const raw = await Filesystem.readJson<AIOManifest>(file).catch(() => null)
    if (raw?.tests) {
      const s = raw.summary
      await Filesystem.write(
        index,
        page({
          id,
          created: raw.created_at || new Date().toISOString(),
          shots,
          videos,
          warnings,
          tests: raw.tests,
          summary: s
            ? {
                total: s.total ?? raw.tests.length,
                passed: s.passed ?? 0,
                failed: s.failed ?? 0,
                skipped: s.skipped ?? 0,
                blocked: s.blocked ?? 0,
              }
            : {
                total: raw.tests.length,
                passed: raw.tests.filter((t) => t.status === "passed").length,
                failed: raw.tests.filter((t) => t.status === "failed").length,
                skipped: raw.tests.filter((t) => t.status === "skipped").length,
                blocked: raw.tests.filter((t) => t.status === "blocked").length,
              },
          blocker: raw.blocker,
        }),
      )
      return { index, shots, videos, warnings }
    }

    // Fall back to opencode manifest format
    const data = await ReportManifest.read(file).catch(() =>
      ReportManifest.from({
        run_id: id,
        created_at: new Date().toISOString(),
      }),
    )
    if (shots.length === 0) warnings.push("Missing screenshots")
    if (videos.length === 0) warnings.push("Missing video")
    await Filesystem.write(index, page({ id, created: data.created_at, shots, videos, warnings }))
    return { index, shots, videos, warnings }
  }
}
