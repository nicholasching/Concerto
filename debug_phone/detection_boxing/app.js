const form = document.querySelector("#boxing-form");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const summary = document.querySelector("#summary");
const output = document.querySelector("#output");
const download = document.querySelector("#download");

function showStatus(message, error = false) {
  status.hidden = false;
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function waitForJob(jobId) {
  for (;;) {
    const response = await fetch(`/api/boxing/jobs/${jobId}`, { cache: "no-store" });
    const job = await response.json();
    if (!response.ok || job.status === "failed") throw new Error(job.error ?? "Boxing failed.");
    if (job.status === "complete") return job;
    await new Promise(resolve => setTimeout(resolve, 750));
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  result.hidden = true;
  showStatus("Uploading clip and tracking screens…");
  try {
    const response = await fetch("/api/boxing/jobs", { method: "POST", body: new FormData(form) });
    const started = await response.json();
    if (!response.ok) throw new Error(started.error ?? "Could not start boxing.");
    showStatus("Tracking screens and drawing boxes…");
    const job = await waitForJob(started.jobId);
    const videoUrl = `/api/boxing/jobs/${started.jobId}/video`;
    output.src = videoUrl;
    download.href = videoUrl;
    const details = job.summary ?? {};
    summary.textContent = `${details.qualifiedTrackCount ?? 0} red/blue-qualified tracks, ${details.boxesDrawn ?? 0} green boxes across ${details.frameCount ?? 0} frames.`;
    result.hidden = false;
    showStatus("Boxed video ready.");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Boxing failed.", true);
  } finally {
    button.disabled = false;
  }
});
